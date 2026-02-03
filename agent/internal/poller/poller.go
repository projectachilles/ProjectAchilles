package poller

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"math/rand"
	"net/http"
	"os"
	"os/signal"
	"runtime"
	"sync"
	"syscall"
	"time"

	"github.com/f0rt1ka/achilles-agent/internal/config"
	"github.com/f0rt1ka/achilles-agent/internal/executor"
	"github.com/f0rt1ka/achilles-agent/internal/httpclient"
	"github.com/f0rt1ka/achilles-agent/internal/reporter"
	"github.com/f0rt1ka/achilles-agent/internal/store"
	"github.com/f0rt1ka/achilles-agent/internal/sysinfo"
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

// serverTaskResponse wraps the server's JSON envelope for a task.
type serverTaskResponse struct {
	Success bool          `json:"success"`
	Data    executor.Task `json:"data"`
}

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

	// Send an initial heartbeat immediately.
	sendHeartbeat(ctx, client, st, version)

	for {
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-heartbeatTicker.C:
			sendHeartbeat(ctx, client, st, version)
		case <-pollTicker.C:
			pollTasks(ctx, client, st, cfg)
		}
	}
}

// sendHeartbeat posts agent status to the server.
func sendHeartbeat(ctx context.Context, client *httpclient.Client, st *store.Store, version string) {
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
	resp.Body.Close()

	now := time.Now()
	_ = st.Update(func(s *store.State) {
		s.LastHeartbeat = &now
	})

	log.Println("heartbeat sent")
}

// pollTasks checks the server for pending tasks. If a task is received,
// it executes the binary and reports the result.
func pollTasks(ctx context.Context, client *httpclient.Client, st *store.Store, cfg *config.Config) {
	log.Println("polling for tasks")

	resp, err := client.Do(ctx, http.MethodGet, "/api/agent/tasks", nil)
	if err != nil {
		log.Printf("poll error: %v", err)
		return
	}
	defer resp.Body.Close()

	if resp.StatusCode == http.StatusNoContent {
		return
	}

	if resp.StatusCode != http.StatusOK {
		log.Printf("unexpected poll response: %d", resp.StatusCode)
		return
	}

	var envelope serverTaskResponse
	if err := json.NewDecoder(resp.Body).Decode(&envelope); err != nil {
		log.Printf("decode task error: %v", err)
		return
	}

	if !envelope.Success || envelope.Data.ID == "" {
		log.Println("no valid task in response")
		return
	}

	task := envelope.Data
	log.Printf("task received: %s (type=%s, test=%s)", task.ID, task.Type, task.Payload.TestName)

	// Only handle execute_test tasks for now.
	if task.Type != "execute_test" {
		log.Printf("unsupported task type %q, skipping", task.Type)
		return
	}

	// Track current task for heartbeat reporting.
	taskID := task.ID
	setCurrentTask(&taskID)
	defer setCurrentTask(nil)

	// Execute the task.
	result, err := executor.Execute(ctx, client, task, cfg)
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
}

// patchTaskFailed sends a PATCH to mark a task as failed when execution errors occur
// before the executor has had a chance to set a status.
func patchTaskFailed(ctx context.Context, client *httpclient.Client, taskID string) error {
	resp, err := client.Do(ctx, http.MethodPatch,
		fmt.Sprintf("/api/agent/tasks/%s/status", taskID),
		map[string]string{"status": "failed"},
	)
	if err != nil {
		return err
	}
	resp.Body.Close()
	return nil
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

// init seeds the random number generator (for Go < 1.20 compatibility).
func init() {
	rand.Seed(time.Now().UnixNano())
}

