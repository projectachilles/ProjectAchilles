package poller

import (
	"context"
	"crypto/tls"
	"crypto/x509"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"math/rand"
	"net"
	"net/http"
	"os"
	"os/signal"
	"runtime"
	"strings"
	"sync"
	"sync/atomic"
	"syscall"
	"time"

	"github.com/f0rt1ka/achilles-agent/internal/config"
	"github.com/f0rt1ka/achilles-agent/internal/executor"
	"github.com/f0rt1ka/achilles-agent/internal/httpclient"
	"github.com/f0rt1ka/achilles-agent/internal/queue"
	"github.com/f0rt1ka/achilles-agent/internal/reporter"
	"github.com/f0rt1ka/achilles-agent/internal/store"
	"github.com/f0rt1ka/achilles-agent/internal/sysinfo"
	"github.com/f0rt1ka/achilles-agent/internal/uninstaller"
	"github.com/f0rt1ka/achilles-agent/internal/updater"
)

// systemInfo holds basic host information sent with heartbeats.
type systemInfo struct {
	Hostname          string `json:"hostname"`
	OS                string `json:"os"`
	Arch              string `json:"arch"`
	UptimeSeconds     int64  `json:"uptime_seconds"`
	CPUPercent        int    `json:"cpu_percent"`
	MemoryMB          int    `json:"memory_mb"`
	TotalMemoryMB     int    `json:"total_memory_mb"`
	DiskFreeMB        int    `json:"disk_free_mb"`
	ProcessCPUPercent int    `json:"process_cpu_percent"`
	ProcessMemoryMB   int    `json:"process_memory_mb"`
}

// heartbeatPayload is the JSON body sent on each heartbeat.
type heartbeatPayload struct {
	Timestamp         time.Time          `json:"timestamp"`
	Status            string             `json:"status"`
	CurrentTask       *string            `json:"current_task"`
	System            systemInfo         `json:"system"`
	AgentVersion      string             `json:"agent_version"`
	LastTaskCompleted *string            `json:"last_task_completed"`
	ReconnectReason   string             `json:"reconnect_reason,omitempty"`
	ProcessStartTime  string             `json:"process_start_time,omitempty"`
	ReconnectContext  *reconnectContext  `json:"reconnect_context,omitempty"`
}

// reconnectContext is the rich reconnection info sent after a connectivity gap.
type reconnectContext struct {
	Reason           string          `json:"reason"`
	Detail           string          `json:"detail,omitempty"`
	FirstFailureAt   string          `json:"first_failure_at,omitempty"`
	OfflineDuration  int             `json:"offline_duration_seconds"`
	FailureCount     int             `json:"failure_count"`
	NetworkState     string          `json:"network_state,omitempty"`
	SystemAtFailure  *systemSnapshot `json:"system_at_failure,omitempty"`
	ProcessStartTime string          `json:"process_start_time,omitempty"`
}

// systemSnapshot captures resource metrics at the moment of first failure.
type systemSnapshot struct {
	DiskFreeMB    int `json:"disk_free_mb"`
	MemoryMB      int `json:"memory_mb"`
	TotalMemoryMB int `json:"total_memory_mb"`
	CPUPercent    int `json:"cpu_percent"`
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

// ErrUninstallInitiated is returned from Run when a remote uninstall has been
// initiated. The agent should exit and not restart.
var ErrUninstallInitiated = errors.New("uninstall initiated, agent exiting")

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

// ── Adaptive Backoff ────────────────────────────────────────────────────────

// backoffState tracks consecutive heartbeat failures for adaptive interval control.
type backoffState struct {
	consecutiveFailures int
}

// interval returns the adaptive heartbeat/poll interval based on failure count.
// Normal for ≤5 failures, then gradually increases to reduce noise during outages.
func (b *backoffState) interval(base time.Duration) time.Duration {
	switch {
	case b.consecutiveFailures <= 5:
		return base
	case b.consecutiveFailures <= 10:
		return 5 * time.Minute
	case b.consecutiveFailures <= 20:
		return 15 * time.Minute
	default:
		return 30 * time.Minute
	}
}

// ── Disconnect Context Tracking ─────────────────────────────────────────────

// processStartTime records when this process started (set once at package init).
var processStartTime = time.Now()

// disconnectContext tracks failure state in real-time during connectivity gaps.
// On each heartbeat failure, it records the error type, network adapter state,
// and system metrics. On reconnection, this context is used to derive the
// disconnect reason and sent to the backend as a reconnectContext.
type disconnectContext struct {
	inGap          bool
	firstFailureAt time.Time
	failureCount   int
	firstError     string          // classified HTTP error
	firstErrorMsg  string          // raw error message for detail
	networkState   string          // adapter state at first failure
	systemSnapshot *systemSnapshot // metrics at first failure
}

func (dc *disconnectContext) reset() {
	dc.inGap = false
	dc.firstFailureAt = time.Time{}
	dc.failureCount = 0
	dc.firstError = ""
	dc.firstErrorMsg = ""
	dc.networkState = ""
	dc.systemSnapshot = nil
}

// classifyHeartbeatError inspects the underlying error from an HTTP request
// and returns a classified error type string.
func classifyHeartbeatError(err error) string {
	if err == nil {
		return ""
	}

	var dnsErr *net.DNSError
	if errors.As(err, &dnsErr) {
		return "dns_failure"
	}

	var opErr *net.OpError
	if errors.As(err, &opErr) {
		if opErr.Op == "dial" {
			errMsg := opErr.Err.Error()
			if strings.Contains(errMsg, "connection refused") {
				return "connection_refused"
			}
			if strings.Contains(errMsg, "network is unreachable") || strings.Contains(errMsg, "no route to host") {
				return "network_unreachable"
			}
			return "connection_failed"
		}
		if opErr.Op == "read" {
			return "connection_reset"
		}
	}

	if errors.Is(err, context.DeadlineExceeded) || os.IsTimeout(err) {
		return "timeout"
	}

	// TLS errors
	var recordErr *tls.RecordHeaderError
	if errors.As(err, &recordErr) {
		return "tls_error"
	}
	var x509Err *x509.UnknownAuthorityError
	if errors.As(err, &x509Err) {
		return "tls_error"
	}
	var certErr *x509.CertificateInvalidError
	if errors.As(err, &certErr) {
		return "tls_error"
	}

	return "unknown_error"
}

// deriveDisconnectReason computes the disconnect reason from the failure context,
// process restart detection, and system state analysis.
func deriveDisconnectReason(dc *disconnectContext, st *store.Store, version string) string {
	state := st.Get()

	lastHB := state.LastSuccessfulHeartbeat
	if lastHB == nil {
		lastHB = state.LastHeartbeat
	}

	// Check if the process restarted during the gap.
	processRestarted := lastHB != nil && processStartTime.After(*lastHB)

	if processRestarted {
		// Version changed → update restart.
		if state.Version != "" && state.Version != version {
			return "update_restart"
		}
		// OS uptime shorter than offline duration → machine rebooted.
		if lastHB != nil {
			info := sysinfo.Collect()
			offlineDuration := time.Since(*lastHB)
			if info.UptimeSeconds > 0 && info.UptimeSeconds < int64(offlineDuration.Seconds()) {
				return "machine_reboot"
			}
		}
		// Check system snapshot for resource pressure at time of crash.
		if dc.systemSnapshot != nil {
			if dc.systemSnapshot.DiskFreeMB < 100 {
				return "disk_pressure_crash"
			}
			if dc.systemSnapshot.TotalMemoryMB > 0 {
				usedPct := float64(dc.systemSnapshot.MemoryMB) / float64(dc.systemSnapshot.TotalMemoryMB) * 100
				if usedPct > 90 {
					return "memory_pressure_crash"
				}
			}
		}
		return "service_restart"
	}

	// Process was running the whole time — use network/error context.
	if dc.networkState == "all_adapters_down" {
		return "network_adapter_disabled"
	}

	switch dc.firstError {
	case "dns_failure":
		return "dns_failure"
	case "connection_refused":
		return "server_unreachable"
	case "network_unreachable":
		return "network_unreachable"
	case "timeout":
		return "connection_timeout"
	case "tls_error":
		return "tls_error"
	case "connection_reset":
		return "connection_reset"
	default:
		return "network_recovery"
	}
}

// ── Main Loop ───────────────────────────────────────────────────────────────

// Run starts the agent's main loop with heartbeat and task polling timers.
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

	// Initialize the local result queue for resilient reporting.
	resultQueue, err := queue.New(cfg.WorkDir)
	if err != nil {
		log.Printf("warning: failed to create result queue: %v (results will not be queued)", err)
	}
	if resultQueue != nil {
		if qs := resultQueue.Size(); qs > 0 {
			log.Printf("[queue] %d queued result(s) from previous session", qs)
		}
	}

	// Adaptive timers replace fixed tickers — intervals grow during outages
	// and snap back to normal on recovery.
	var hbBackoff backoffState
	var dc disconnectContext

	// Pre-populate disconnect context if this is a process restart with a gap.
	// Without this, process restarts (service_restart, machine_reboot, update_restart)
	// would show "Unknown" because dc.inGap is never set — heartbeats don't fail
	// when the agent was down (the server was reachable, the agent just wasn't running).
	state := st.Get()
	lastHB := state.LastSuccessfulHeartbeat
	if lastHB == nil {
		lastHB = state.LastHeartbeat
	}
	if lastHB != nil && time.Since(*lastHB) > 2*cfg.HeartbeatInterval {
		dc.inGap = true
		dc.firstFailureAt = *lastHB
		dc.failureCount = 1
		dc.firstError = "process_not_running"
		dc.networkState = "adapters_ok"
		log.Printf("startup gap detected: last heartbeat %s ago, will report reconnect reason",
			time.Since(*lastHB).Round(time.Second))
	}

	// Timer(0) fires immediately on the first select iteration, providing
	// the initial heartbeat without a separate call.
	heartbeatTimer := time.NewTimer(0)
	defer heartbeatTimer.Stop()

	pollTimer := time.NewTimer(addJitter(cfg.PollInterval))
	defer pollTimer.Stop()

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
	uninstallCh := make(chan struct{}, 1)
	taskDoneCh := make(chan struct{}, 1) // signals when a goroutine finishes

	// Track whether initial update check has run (deferred until after first heartbeat).
	initialUpdateDone := false

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

		case <-heartbeatTimer.C:
			success, hbErr := sendHeartbeat(ctx, client, cfg, st, version, &dc)
			if success {
				if hbBackoff.consecutiveFailures > 5 {
					log.Printf("connectivity recovered after %d consecutive failures, resetting intervals",
						hbBackoff.consecutiveFailures)
				}
				hbBackoff.consecutiveFailures = 0

				// Drain any queued results now that the server is reachable.
				if resultQueue != nil {
					if drained := resultQueue.Drain(ctx, reporter.Report, client); drained > 0 {
						log.Printf("drained %d queued result(s)", drained)
					}
				}

				// Run initial update check after the first successful heartbeat.
				if !initialUpdateDone && updateC != nil {
					initialUpdateDone = true
					updated, err := updater.CheckAndUpdate(ctx, client, version, cfg)
					if err != nil {
						log.Printf("initial update check error: %v", err)
					} else if updated {
						log.Println("update applied on startup, exiting for restart")
						return ErrUpdateApplied
					}
				}
			} else {
				hbBackoff.consecutiveFailures++

				// Track disconnect context on first failure in a gap.
				if !dc.inGap {
					dc.inGap = true
					dc.firstFailureAt = time.Now()
					dc.firstError = classifyHeartbeatError(hbErr)
					if hbErr != nil {
						dc.firstErrorMsg = hbErr.Error()
					}
					dc.networkState = sysinfo.CheckNetworkState()
					info := sysinfo.Collect()
					dc.systemSnapshot = &systemSnapshot{
						DiskFreeMB:    info.DiskFreeMB,
						MemoryMB:      info.MemoryMB,
						TotalMemoryMB: info.TotalMemoryMB,
						CPUPercent:    info.CPUPercent,
					}
					log.Printf("connectivity gap started (error: %s, network: %s)",
						dc.firstError, dc.networkState)
				}
				dc.failureCount++

				if hbBackoff.consecutiveFailures == 6 {
					log.Printf("heartbeat backoff: increasing to 5m intervals after %d consecutive failures",
						hbBackoff.consecutiveFailures)
				}
			}
			heartbeatTimer.Reset(addJitter(hbBackoff.interval(cfg.HeartbeatInterval)))

		case <-pollTimer.C:
			// Skip polling during backoff — server is unreachable.
			if hbBackoff.consecutiveFailures > 5 {
				pollTimer.Reset(addJitter(hbBackoff.interval(cfg.PollInterval)))
				continue
			}
			if atomic.LoadInt32(&taskBusy) == 1 {
				pollTimer.Reset(addJitter(cfg.PollInterval))
				continue // skip poll while executing
			}
			task := fetchTask(ctx, client)
			if task == nil {
				pollTimer.Reset(addJitter(cfg.PollInterval))
				continue
			}
			if !atomic.CompareAndSwapInt32(&taskBusy, 0, 1) {
				pollTimer.Reset(addJitter(cfg.PollInterval))
				continue // race guard
			}
			go executeAndReport(ctx, client, st, cfg, version, task, &taskBusy,
				updateAppliedCh, uninstallCh, taskDoneCh, resultQueue)
			pollTimer.Reset(addJitter(cfg.PollInterval))

		case <-updateAppliedCh:
			log.Println("admin-triggered update applied, exiting for restart")
			return ErrUpdateApplied
		case <-uninstallCh:
			log.Println("remote uninstall initiated, exiting")
			return ErrUninstallInitiated
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
// Returns (true, nil) on success, (false, error) on failure. On success it
// updates the store's LastSuccessfulHeartbeat, handles key rotation, and
// resets the disconnect context after sending reconnection info.
func sendHeartbeat(ctx context.Context, client *httpclient.Client, cfg *config.Config, st *store.Store, version string, dc *disconnectContext) (bool, error) {
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
			Hostname:          hostname,
			OS:                runtime.GOOS,
			Arch:              runtime.GOARCH,
			UptimeSeconds:     info.UptimeSeconds,
			CPUPercent:        info.CPUPercent,
			MemoryMB:          info.MemoryMB,
			TotalMemoryMB:     info.TotalMemoryMB,
			DiskFreeMB:        info.DiskFreeMB,
			ProcessCPUPercent: info.ProcessCPUPercent,
			ProcessMemoryMB:   info.ProcessMemoryMB,
		},
		AgentVersion:      version,
		LastTaskCompleted: lastTask,
	}

	// Detect gaps caused by process suspension (macOS sleep, VM pause) where
	// no heartbeats failed because the process was frozen. The timer didn't fire
	// so dc.inGap was never set, but LastSuccessfulHeartbeat shows a real gap.
	if !dc.inGap {
		prevState := st.Get()
		prevHB := prevState.LastSuccessfulHeartbeat
		if prevHB == nil {
			prevHB = prevState.LastHeartbeat
		}
		if prevHB != nil && time.Since(*prevHB) > 2*cfg.HeartbeatInterval {
			dc.inGap = true
			dc.firstFailureAt = *prevHB
			dc.failureCount = 1
			dc.firstError = "process_suspended"
			dc.networkState = "adapters_ok"
		}
	}

	// Build reconnection context if we're recovering from a gap.
	if dc.inGap && dc.failureCount > 0 {
		reason := deriveDisconnectReason(dc, st, version)
		offlineDur := 0
		if !dc.firstFailureAt.IsZero() {
			offlineDur = int(time.Since(dc.firstFailureAt).Seconds())
		}

		payload.ReconnectContext = &reconnectContext{
			Reason:           reason,
			Detail:           dc.firstErrorMsg,
			FirstFailureAt:   dc.firstFailureAt.UTC().Format(time.RFC3339),
			OfflineDuration:  offlineDur,
			FailureCount:     dc.failureCount,
			NetworkState:     dc.networkState,
			SystemAtFailure:  dc.systemSnapshot,
			ProcessStartTime: processStartTime.UTC().Format(time.RFC3339),
		}

		// Backward compatibility: also set flat fields for older backends.
		payload.ReconnectReason = reason
		payload.ProcessStartTime = processStartTime.UTC().Format(time.RFC3339)

		log.Printf("reconnect reason: %s (offline %ds, %d failures, error: %s, network: %s)",
			reason, offlineDur, dc.failureCount, dc.firstError, dc.networkState)
	}

	resp, err := client.Do(ctx, http.MethodPost, "/api/agent/heartbeat", payload)
	if err != nil {
		log.Printf("heartbeat error: %v", err)
		return false, err
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

	// Mark heartbeat as successful and reset disconnect tracking.
	now := time.Now()
	_ = st.Update(func(s *store.State) {
		s.LastHeartbeat = &now
		s.LastSuccessfulHeartbeat = &now
	})
	dc.reset()

	log.Println("heartbeat sent")
	return true, nil
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
// If result reporting fails completely, the result is enqueued locally for later delivery.
func executeAndReport(
	ctx context.Context,
	client *httpclient.Client,
	st *store.Store,
	cfg *config.Config,
	version string,
	task *executor.Task,
	taskBusy *int32,
	updateAppliedCh chan<- struct{},
	uninstallCh chan<- struct{},
	taskDoneCh chan<- struct{},
	resultQueue *queue.Queue,
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
			if patchErr := patchTaskFailed(ctx, client, task.ID, updateErr.Error()); patchErr != nil {
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
	case "uninstall":
		if patchErr := patchTaskStatus(ctx, client, task.ID, "executing"); patchErr != nil {
			log.Printf("failed to mark task %s as executing: %v", task.ID, patchErr)
		}
		uninstallErr := uninstaller.Execute(ctx, client, *task, cfg)
		_ = st.Update(func(s *store.State) { s.LastTaskID = task.ID })
		if errors.Is(uninstallErr, uninstaller.ErrUninstallInitiated) {
			select {
			case uninstallCh <- struct{}{}:
			default:
			}
			return
		}
		if uninstallErr != nil {
			log.Printf("uninstall failed: %v", uninstallErr)
			if patchErr := patchTaskFailed(ctx, client, task.ID, uninstallErr.Error()); patchErr != nil {
				log.Printf("failed to mark task %s as failed: %v", task.ID, patchErr)
			}
		}
		return
	default:
		log.Printf("unsupported task type %q, skipping", task.Type)
		return
	}

	if err != nil {
		log.Printf("execution error for task %s: %v", task.ID, err)
		if patchErr := patchTaskFailed(ctx, client, task.ID, err.Error()); patchErr != nil {
			log.Printf("failed to mark task %s as failed: %v", task.ID, patchErr)
		}
		_ = st.Update(func(s *store.State) {
			s.LastTaskID = task.ID
		})
		return
	}

	// Report the result. If all retries fail, enqueue locally for later delivery.
	if err := reporter.Report(ctx, client, task.ID, result); err != nil {
		log.Printf("report error for task %s: %v", task.ID, err)
		if resultQueue != nil {
			if qErr := resultQueue.Enqueue(task.ID, result); qErr != nil {
				log.Printf("queue error for task %s: %v (result lost)", task.ID, qErr)
			}
		}
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

// patchTaskFailed sends a PATCH to mark a task as failed with an error reason.
// The reason is sent to the server so admins can see why the task failed in the UI.
func patchTaskFailed(ctx context.Context, client *httpclient.Client, taskID, reason string) error {
	body := map[string]string{"status": "failed"}
	if reason != "" {
		body["error"] = reason
	}
	resp, err := client.Do(ctx, http.MethodPatch,
		fmt.Sprintf("/api/agent/tasks/%s/status", taskID),
		body,
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
