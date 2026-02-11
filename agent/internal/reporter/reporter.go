package reporter

import (
	"context"
	"fmt"
	"net/http"
	"time"

	"github.com/f0rt1ka/achilles-agent/internal/executor"
	"github.com/f0rt1ka/achilles-agent/internal/httpclient"
)

// statusUpdate is the JSON body sent when patching task status.
type statusUpdate struct {
	Status string `json:"status"`
}

// Report sends the execution result to the backend and updates task status.
// It POSTs the result regardless of exit code (the exit code IS the result).
// On network/server errors it retries up to 3 times with exponential backoff
// (2s, 4s, 8s). If all retries fail it marks the task as "failed" via PATCH.
func Report(ctx context.Context, client *httpclient.Client, taskID string, result *executor.Result) error {
	resultPath := fmt.Sprintf("/api/agent/tasks/%s/result", taskID)

	const maxRetries = 3
	totalAttempts := 1 + maxRetries // 1 initial + 3 retries
	var lastErr error

	for attempt := 0; attempt < totalAttempts; attempt++ {
		if attempt > 0 {
			// Exponential backoff: 2s, 4s, 8s
			delay := time.Duration(1<<uint(attempt)) * time.Second
			select {
			case <-ctx.Done():
				return fmt.Errorf("context cancelled during retry: %w", ctx.Err())
			case <-time.After(delay):
			}
		}

		resp, err := client.Do(ctx, http.MethodPost, resultPath, result)
		if err != nil {
			lastErr = fmt.Errorf("POST result (attempt %d/%d): %w", attempt+1, totalAttempts, err)
			continue
		}
		resp.Body.Close()

		if resp.StatusCode >= 200 && resp.StatusCode < 300 {
			return nil
		}

		lastErr = fmt.Errorf("POST result (attempt %d/%d): status %d", attempt+1, totalAttempts, resp.StatusCode)
	}

	// All retries exhausted — mark the task as failed.
	statusPath := fmt.Sprintf("/api/agent/tasks/%s/status", taskID)
	patchResp, patchErr := client.Do(ctx, http.MethodPatch, statusPath, statusUpdate{Status: "failed"})
	if patchErr == nil {
		patchResp.Body.Close()
	}

	return fmt.Errorf("report failed after %d retries: %w", maxRetries, lastErr)
}
