package reporter

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"time"

	"github.com/f0rt1ka/achilles-agent/internal/executor"
	"github.com/f0rt1ka/achilles-agent/internal/httpclient"
)

// ErrPermanent is returned when the server rejects the result with a status
// that will never change on retry (currently HTTP 400 and 404). The caller —
// in particular queue.Drain — must DELETE the queued JSON file rather than
// retry it indefinitely. This was the root cause of the May-2026 backend
// resubmission storm: the queue treated 400 "task in terminal state" as a
// transient error and re-POSTed the same result every heartbeat forever.
//
// Wrap with fmt.Errorf("...: %w", ErrPermanent) so callers can use errors.Is
// to discriminate.
var ErrPermanent = errors.New("server rejected result permanently")

// ErrTransient is returned for network failures, timeouts, 5xx responses, and
// 4xx responses that may succeed on retry (notably 429). The caller should
// keep the queued file on disk and retry on the next drain pass.
var ErrTransient = errors.New("transient delivery failure")

// statusUpdate is the JSON body sent when patching task status.
type statusUpdate struct {
	Status string `json:"status"`
}

// isPermanent4xx returns true for HTTP statuses where retry will not help.
// 400 = malformed payload OR task in terminal state (the storm trigger).
// 404 = task was deleted server-side.
// 401/403/429 are deliberately NOT permanent — token rotation, permission
// changes, or rate-limit backoff can resolve them on retry.
func isPermanent4xx(status int) bool {
	return status == http.StatusBadRequest || status == http.StatusNotFound
}

// Report sends the execution result to the backend and updates task status.
// It POSTs the result regardless of exit code (the exit code IS the result).
//
// On a permanent rejection (400, 404), Report returns immediately wrapping
// ErrPermanent — no retry is attempted because none would help.
// On transient failures (network, 5xx, 401/403/429, other 4xx) it retries
// up to 3 times with exponential backoff (2s, 4s, 8s). If all retries fail
// it marks the task as "failed" via a best-effort PATCH and returns
// wrapping ErrTransient.
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

		// Short-circuit: permanent rejection means retry is pointless. The
		// queue must delete this entry to avoid an infinite drain loop.
		if isPermanent4xx(resp.StatusCode) {
			return fmt.Errorf("POST result (attempt %d/%d) status %d: %w",
				attempt+1, totalAttempts, resp.StatusCode, ErrPermanent)
		}

		lastErr = fmt.Errorf("POST result (attempt %d/%d): status %d", attempt+1, totalAttempts, resp.StatusCode)
	}

	// All retries exhausted on transient errors — mark the task as failed
	// best-effort and surface as ErrTransient so the queue retains the entry
	// for a future drain pass once the backend recovers.
	statusPath := fmt.Sprintf("/api/agent/tasks/%s/status", taskID)
	patchResp, patchErr := client.Do(ctx, http.MethodPatch, statusPath, statusUpdate{Status: "failed"})
	if patchErr == nil {
		patchResp.Body.Close()
	}

	return fmt.Errorf("report failed after %d retries: %w (last error: %v)", maxRetries, ErrTransient, lastErr)
}
