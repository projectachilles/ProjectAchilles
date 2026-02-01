package poller

import (
	"context"
	"encoding/json"
	"log"
	"math/rand"
	"net/http"
	"os"
	"os/signal"
	"runtime"
	"syscall"
	"time"

	"github.com/f0rt1ka/achilles-agent/internal/config"
	"github.com/f0rt1ka/achilles-agent/internal/httpclient"
	"github.com/f0rt1ka/achilles-agent/internal/store"
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

// taskResponse represents a minimal task received from the server.
type taskResponse struct {
	ID string `json:"id"`
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
			pollTasks(ctx, client, st)
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

	payload := heartbeatPayload{
		Timestamp:   time.Now().UTC(),
		Status:      "idle",
		CurrentTask: nil,
		System: systemInfo{
			Hostname:      hostname,
			OS:            runtime.GOOS,
			Arch:          runtime.GOARCH,
			UptimeSeconds: 0,
			CPUPercent:    0,
			MemoryMB:      0,
			DiskFreeMB:    0,
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

// pollTasks checks the server for pending tasks.
func pollTasks(ctx context.Context, client *httpclient.Client, st *store.Store) {
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

	if resp.StatusCode == http.StatusOK {
		var task taskResponse
		if err := json.NewDecoder(resp.Body).Decode(&task); err != nil {
			log.Printf("decode task error: %v", err)
			return
		}
		log.Printf("task received: %s", task.ID)
		// Actual execution will be handled by the executor module (Task 13).
		_ = st.Update(func(s *store.State) {
			s.LastTaskID = task.ID
		})
		return
	}

	log.Printf("unexpected poll response: %d", resp.StatusCode)
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

