// Package queue provides a file-backed result queue for resilient task reporting.
// When the backend is unreachable and reporter retries are exhausted, results are
// persisted locally as JSON files and drained on the next successful heartbeat.
package queue

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"sort"

	"github.com/f0rt1ka/achilles-agent/internal/executor"
	"github.com/f0rt1ka/achilles-agent/internal/httpclient"
	"github.com/f0rt1ka/achilles-agent/internal/reporter"
)

const maxQueueSize = 100

// ReportFunc is the signature for result reporting (matches reporter.Report).
type ReportFunc func(ctx context.Context, client *httpclient.Client, taskID string, result *executor.Result) error

// Queue manages a directory of queued task results for later delivery.
type Queue struct {
	dir string
}

// queuedResult is the on-disk representation of a queued task result.
type queuedResult struct {
	TaskID string          `json:"task_id"`
	Result *executor.Result `json:"result"`
}

// New creates a Queue backed by a queue/ subdirectory inside workDir.
func New(workDir string) (*Queue, error) {
	dir := filepath.Join(workDir, "queue")
	if err := os.MkdirAll(dir, 0700); err != nil {
		return nil, fmt.Errorf("create queue dir: %w", err)
	}
	return &Queue{dir: dir}, nil
}

// Enqueue persists a task result to disk for later delivery.
// Returns an error if the queue is full (maxQueueSize) or the write fails.
func (q *Queue) Enqueue(taskID string, result *executor.Result) error {
	entries, _ := os.ReadDir(q.dir)
	if len(entries) >= maxQueueSize {
		return fmt.Errorf("queue full (%d items), dropping result for task %s", len(entries), taskID)
	}

	data, err := json.MarshalIndent(queuedResult{TaskID: taskID, Result: result}, "", "  ")
	if err != nil {
		return fmt.Errorf("marshal queued result: %w", err)
	}

	path := filepath.Join(q.dir, taskID+".json")
	if err := os.WriteFile(path, data, 0600); err != nil {
		return fmt.Errorf("write queued result: %w", err)
	}

	log.Printf("[queue] Enqueued result for task %s (%d items in queue)", taskID, len(entries)+1)
	return nil
}

// Drain attempts to deliver all queued results using the provided report function.
// It processes files oldest-first.
//
// On reporter.ErrPermanent (HTTP 400/404 — server has decided this result will
// never be accepted), the queued file is DELETED and processing continues to
// the next file. This prevents the May-2026 resubmission storm where a single
// rejected result would be re-POSTed every heartbeat forever.
//
// On reporter.ErrTransient (network, 5xx, 4xx-after-retries) or any unrecognised
// error, processing breaks and the file is preserved for the next drain pass.
//
// Returns the number of successfully delivered results.
func (q *Queue) Drain(ctx context.Context, reportFn ReportFunc, client *httpclient.Client) int {
	entries, err := os.ReadDir(q.dir)
	if err != nil || len(entries) == 0 {
		return 0
	}

	// Sort alphabetically (task UUIDs are time-ordered enough for FIFO).
	sort.Slice(entries, func(i, j int) bool {
		return entries[i].Name() < entries[j].Name()
	})

	drained := 0
	for _, entry := range entries {
		if entry.IsDir() {
			continue
		}

		path := filepath.Join(q.dir, entry.Name())
		data, readErr := os.ReadFile(path)
		if readErr != nil {
			log.Printf("[queue] Failed to read %s: %v", entry.Name(), readErr)
			continue
		}

		var queued queuedResult
		if json.Unmarshal(data, &queued) != nil {
			log.Printf("[queue] Failed to unmarshal %s, removing corrupt file", entry.Name())
			os.Remove(path)
			continue
		}

		if err := reportFn(ctx, client, queued.TaskID, queued.Result); err != nil {
			if errors.Is(err, reporter.ErrPermanent) {
				// Server has a final answer for this task — likely the task
				// was already terminal server-side when our POST landed.
				// Deleting the queued file stops the retry loop; the result
				// is a write-off (server's outcome is authoritative).
				log.Printf("[queue] Permanent rejection for task %s, removing queued file: %v", queued.TaskID, err)
				os.Remove(path)
				continue
			}
			log.Printf("[queue] Drain failed for task %s: %v (stopping, file retained)", queued.TaskID, err)
			break // Transient — keep file for the next drain pass.
		}

		os.Remove(path)
		drained++
		log.Printf("[queue] Drained result for task %s", queued.TaskID)
	}

	return drained
}

// Size returns the number of queued result files.
func (q *Queue) Size() int {
	entries, err := os.ReadDir(q.dir)
	if err != nil {
		return 0
	}
	count := 0
	for _, e := range entries {
		if !e.IsDir() {
			count++
		}
	}
	return count
}
