package poller

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"math/rand"
	"net/http"
	"os"
	"os/signal"
	"runtime"
	"sync"
	"sync/atomic"
	"syscall"
	"time"

	"github.com/f0rt1ka/achilles-agent/internal/config"
	"github.com/f0rt1ka/achilles-agent/internal/executor"
	"github.com/f0rt1ka/achilles-agent/internal/httpclient"
	"github.com/f0rt1ka/achilles-agent/internal/reporter"
	"github.com/f0rt1ka/achilles-agent/internal/store"
	"github.com/f0rt1ka/achilles-agent/internal/sysinfo"
	"github.com/f0rt1ka/achilles-agent/internal/updater"
)

// systemInfo holds basic host information sent with heartbeats.
type systemInfo struct {
	Hostname      string `json:"hostname"`
	OS            string `json:"os"`
	Arch          string `json:"arch"`
	UptimeSeconds int64  `json:"uptime_seconds"`
	CPUPercent    int    `json:"cpu_percent"`
	MemoryMB      int    `json:"memory_mb"`
	DiskFreeMB    int    `json:"disk_free_mb"`
}

// heartbeatPayload is the JSON body sent on each heartbeat.
type heartbeatPayload struct {
	Timestamp         time.Time   `json:"timestamp"`
	Status            string      `json:"status"`
	CurrentTask       *string     `json:"current_task"`
	System            systemInfo  `json:"system"`
	AgentVersion      string      `json:"agent_version"`
	LastTaskCompleted *string     `json:"last_task_completed"`
}

// heartbeatResponse wraps the server's JSON envelope for heartbeat acknowledgement.
type heartbeatResponse struct {
	Success bool `json:"success"`
	Data    struct {
		Acknowledged bool   `json:"acknowledged"`
		ServerTime   string `json:"server_time"`
		NewAPIKey    string `json:"new_api_key,omitempty"`
	} `json:"data"`
}

// serverTaskResponse wraps the server's JSON envelope for a task.
type serverTaskResponse struct {
	Success bool          `json:"success"`
	Data    executor.Task `json:"data"`
}

// ErrUpdateApplied is returned from Run when a self-update has been applied
// and the agent should exit so the service manager (systemd/SCM) can restart it.
var ErrUpdateApplied = errors.New("update applied, restart required")

var (
	currentTaskMu sync.Mutex
	currentTaskID *string
)

func setCurrentTask(taskID *string) {
	currentTaskMu.Lock()
	defer currentTaskMu.Unlock()
	currentTaskID = taskID
}

func getCurrentTask() *string {
	currentTaskMu.Lock()
	defer currentTaskMu.Unlock()
	return currentTaskID
}

// Run starts the agent's main loop with heartbeat and task polling tickers.
// It blocks until the context is cancelled or a SIGINT/SIGTERM is received.
func Run(ctx context.Context, cfg *config.Config, st *store.Store, version string) error {
	ctx, cancel := context.WithCancel(ctx)
	defer cancel()

	// Listen for OS signals for graceful shutdown.
	sigCh := make(chan os.Signal, 1)
	signal.Notify(sigCh, syscall.SIGINT, syscall.SIGTERM)
	go func() {
		select {
		case <-sigCh:
			log.Println("shutting down")
			cancel()
		case <-ctx.Done():
		}
	}()

	client := httpclient.NewClient(cfg, version)

	heartbeatInterval := addJitter(cfg.HeartbeatInterval)
	pollInterval := addJitter(cfg.PollInterval)

	heartbeatTicker := time.NewTicker(heartbeatInterval)
	defer heartbeatTicker.Stop()

	pollTicker := time.NewTicker(pollInterval)
	defer pollTicker.Stop()

	// Update ticker: only created when UpdateInterval > 0 (zero = disabled).
	var updateC <-chan time.Time
	if cfg.UpdateInterval > 0 {
		updateTicker := time.NewTicker(addJitter(cfg.UpdateInterval))
		defer updateTicker.Stop()
		updateC = updateTicker.C
	}

	log.Printf("Poller started (heartbeat=%s, poll=%s, update=%s)",
		cfg.HeartbeatInterval, cfg.PollInterval, cfg.UpdateInterval)

	// Async execution state: only one task runs at a time.
	var taskBusy int32
	updateAppliedCh := make(chan struct{}, 1)
	taskDoneCh := make(chan struct{}, 1) // signals when a goroutine finishes

	// Send an initial heartbeat immediately.
	sendHeartbeat(ctx, client, cfg, st, version)

	// Run an initial update check immediately (don't wait for the first tick).
	if updateC != nil {
		updated, err := updater.CheckAndUpdate(ctx, client, version, cfg)
		if err != nil {
			log.Printf("initial update check error: %v", err)
		} else if updated {
			log.Println("update applied on startup, exiting for restart")
			return ErrUpdateApplied
		}
	}

	for {
		select {
		case <-ctx.Done():
			// Wait for in-flight task to finish (up to 30 seconds).
			if atomic.LoadInt32(&taskBusy) == 1 {
				log.Println("waiting for in-flight task to finish...")
				select {
				case <-taskDoneCh:
					log.Println("in-flight task finished")
				case <-time.After(30 * time.Second):
					log.Println("in-flight task did not finish within 30s, exiting anyway")
				}
			}
			return ctx.Err()
		case <-heartbeatTicker.C:
			sendHeartbeat(ctx, client, cfg, st, version)
		case <-pollTicker.C:
			if atomic.LoadInt32(&taskBusy) == 1 {
				continue // skip poll while executing
			}
			task := fetchTask(ctx, client)
			if task == nil {
				continue
			}
			if !atomic.CompareAndSwapInt32(&taskBusy, 0, 1) {
				continue // race guard
			}
			go executeAndReport(ctx, client, st, cfg, version, task, &taskBusy, updateAppliedCh, taskDoneCh)
		case <-updateAppliedCh:
			log.Println("admin-triggered update applied, exiting for restart")
			return ErrUpdateApplied
		case <-updateC:
			if atomic.LoadInt32(&taskBusy) == 1 {
				continue // skip periodic update check while a task is executing
			}
			updated, err := updater.CheckAndUpdate(ctx, client, version, cfg)
			if err != nil {
				log.Printf("update check error: %v", err)
			} else if updated {
				log.Println("update applied, exiting for restart")
				return ErrUpdateApplied
			}
		}
	}
}

// sendHeartbeat posts agent status to the server and processes the response.
// If the server includes a new_api_key field (key rotation), the agent updates
// its config in memory and persists to disk automatically.
func sendHeartbeat(ctx context.Context, client *httpclient.Client, cfg *config.Config, st *store.Store, version string) {
	hostname, _ := os.Hostname()

	state := st.Get()
	var lastTask *string
	if state.LastTaskID != "" {
		lt := state.LastTaskID
		lastTask = &lt
	}

	info := sysinfo.Collect()

	curTask := getCurrentTask()
	status := "idle"
	if curTask != nil {
		status = "executing"
	}

	payload := heartbeatPayload{
		Timestamp:   time.Now().UTC(),
		Status:      status,
		CurrentTask: curTask,
		System: systemInfo{
			Hostname:      hostname,
			OS:            runtime.GOOS,
			Arch:          runtime.GOARCH,
			UptimeSeconds: info.UptimeSeconds,
			CPUPercent:    info.CPUPercent,
			MemoryMB:      info.MemoryMB,
			DiskFreeMB:    info.DiskFreeMB,
		},
		AgentVersion:      version,
		LastTaskCompleted: lastTask,
	}

	resp, err := client.Do(ctx, http.MethodPost, "/api/agent/heartbeat", payload)
	if err != nil {
		log.Printf("heartbeat error: %v", err)
		return
	}
	defer resp.Body.Close()

	// Parse response to check for key rotation
	var hbResp heartbeatResponse
	if err := json.NewDecoder(resp.Body).Decode(&hbResp); err != nil {
		log.Printf("heartbeat response decode error: %v", err)
	} else if hbResp.Data.NewAPIKey != "" {
		// Server is delivering a rotated key — update in-memory and persist
		cfg.AgentKey = hbResp.Data.NewAPIKey
		if persistErr := cfg.Persist(); persistErr != nil {
			log.Printf("warning: failed to persist rotated key to config: %v", persistErr)
		} else {
			log.Println("API key rotated automatically via heartbeat")
		}
	}

	now := time.Now()
	_ = st.Update(func(s *store.State) {
		s.LastHeartbeat = &now
	})

	log.Println("heartbeat sent")
}

// fetchTask polls the server for a pending task and returns it, or nil if none available.
func fetchTask(ctx context.Context, client *httpclient.Client) *executor.Task {
	log.Println("polling for tasks")

	resp, err := client.Do(ctx, http.MethodGet, "/api/agent/tasks", nil)
	if err != nil {
		log.Printf("poll error: %v", err)
		return nil
	}
	defer resp.Body.Close()

	if resp.StatusCode == http.StatusNoContent {
		return nil
	}

	if resp.StatusCode != http.StatusOK {
		log.Printf("unexpected poll response: %d", resp.StatusCode)
		return nil
	}

	var envelope serverTaskResponse
	if err := json.NewDecoder(resp.Body).Decode(&envelope); err != nil {
		log.Printf("decode task error: %v", err)
		return nil
	}

	if !envelope.Success || envelope.Data.ID == "" {
		log.Println("no valid task in response")
		return nil
	}

	task := envelope.Data
	log.Printf("task received: %s (type=%s, test=%s)", task.ID, task.Type, task.Payload.TestName)
	return &task
}

// executeAndReport runs a task in a goroutine, reports the result, and clears the busy flag.
func executeAndReport(
	ctx context.Context,
	client *httpclient.Client,
	st *store.Store,
	cfg *config.Config,
	version string,
	task *executor.Task,
	taskBusy *int32,
	updateAppliedCh chan<- struct{},
	taskDoneCh chan<- struct{},
) {
	defer atomic.StoreInt32(taskBusy, 0)
	defer func() {
		select {
		case taskDoneCh <- struct{}{}:
		default:
		}
	}()

	// Track current task for heartbeat reporting.
	taskID := task.ID
	setCurrentTask(&taskID)
	defer setCurrentTask(nil)

	// Dispatch based on task type.
	var result *executor.Result
	var err error
	var updateApplied bool
	switch task.Type {
	case "execute_test":
		result, err = executor.Execute(ctx, client, *task, cfg)
	case "execute_command":
		result, err = executor.ExecuteCommand(ctx, client, *task, cfg)
	case "update_agent":
		if patchErr := patchTaskStatus(ctx, client, task.ID, "executing"); patchErr != nil {
			log.Printf("failed to mark task %s as executing: %v", task.ID, patchErr)
		}
		updated, updateErr := updater.CheckAndUpdate(ctx, client, version, cfg)
		if updateErr != nil {
			log.Printf("admin-triggered update failed: %v", updateErr)
			if patchErr := patchTaskFailed(ctx, client, task.ID); patchErr != nil {
				log.Printf("failed to mark task %s as failed: %v", task.ID, patchErr)
			}
			_ = st.Update(func(s *store.State) { s.LastTaskID = task.ID })
			return
		}
		updateApplied = updated
		result = &executor.Result{ExitCode: 0}
		if updated {
			result.Stdout = "update applied, restart pending"
		} else {
			result.Stdout = "already up to date"
		}
	default:
		log.Printf("unsupported task type %q, skipping", task.Type)
		return
	}

	if err != nil {
		log.Printf("execution error for task %s: %v", task.ID, err)
		if patchErr := patchTaskFailed(ctx, client, task.ID); patchErr != nil {
			log.Printf("failed to mark task %s as failed: %v", task.ID, patchErr)
		}
		_ = st.Update(func(s *store.State) {
			s.LastTaskID = task.ID
		})
		return
	}

	// Report the result.
	if err := reporter.Report(ctx, client, task.ID, result); err != nil {
		log.Printf("report error for task %s: %v", task.ID, err)
	} else {
		log.Printf("task %s completed (exit_code=%d, duration=%dms)", task.ID, result.ExitCode, result.ExecutionDurationMs)
	}

	_ = st.Update(func(s *store.State) {
		s.LastTaskID = task.ID
	})

	if updateApplied {
		select {
		case updateAppliedCh <- struct{}{}:
		default:
		}
	}
}

// patchTaskStatus sends a PATCH to update a task's status on the server.
func patchTaskStatus(ctx context.Context, client *httpclient.Client, taskID, status string) error {
	resp, err := client.Do(ctx, http.MethodPatch,
		fmt.Sprintf("/api/agent/tasks/%s/status", taskID),
		map[string]string{"status": status},
	)
	if err != nil {
		return err
	}
	resp.Body.Close()
	return nil
}

// patchTaskFailed sends a PATCH to mark a task as failed when execution errors occur
// before the executor has had a chance to set a status.
func patchTaskFailed(ctx context.Context, client *httpclient.Client, taskID string) error {
	return patchTaskStatus(ctx, client, taskID, "failed")
}

// addJitter adds a random offset of +/-5 seconds to the given interval.
func addJitter(interval time.Duration) time.Duration {
	jitter := time.Duration(rand.Intn(10001)-5000) * time.Millisecond
	result := interval + jitter
	if result <= 0 {
		return interval
	}
	return result
}


