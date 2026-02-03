# Wire Task Execution into Agent Polling Loop

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Connect the existing `executor.Execute()` and `reporter.Report()` modules to the agent's polling loop so that tasks created in the UI actually execute on the endpoint and report results back.

**Architecture:** The poller currently receives tasks but only stores the task ID. We need to: (1) decode the full task payload from the server's `{ success: true, data: task }` wrapper, (2) call `executor.Execute()` to download/verify/run the binary, (3) call `reporter.Report()` to send results back, and (4) update heartbeat status to reflect the current task. The poller remains single-threaded — one task at a time.

**Tech Stack:** Go 1.24, existing `executor`, `reporter`, `httpclient`, `config`, `store` packages. Backend is Express/TypeScript with SQLite (better-sqlite3).

---

### Task 1: Expand `taskResponse` to decode full task payload

**Files:**
- Modify: `agent/internal/poller/poller.go:42-45`

The server's `GET /api/agent/tasks` endpoint returns:

```json
{
  "success": true,
  "data": {
    "id": "...",
    "type": "execute_test",
    "payload": {
      "test_uuid": "...",
      "test_name": "...",
      "binary_name": "...",
      "binary_sha256": "...",
      "binary_size": 1234,
      "execution_timeout": 300,
      "arguments": []
    }
  }
}
```

The current `taskResponse` only has `ID string`. We need to decode the full task
so we can pass it to `executor.Execute()`.

**Step 1: Replace the `taskResponse` struct with a server response wrapper + full task**

In `agent/internal/poller/poller.go`, replace:

```go
// taskResponse represents a minimal task received from the server.
type taskResponse struct {
	ID string `json:"id"`
}
```

With:

```go
// serverTaskResponse wraps the server's JSON envelope for a task.
type serverTaskResponse struct {
	Success bool          `json:"success"`
	Data    executor.Task `json:"data"`
}
```

**Step 2: Add the executor and reporter imports**

Add to the import block in `poller.go`:

```go
"github.com/f0rt1ka/achilles-agent/internal/executor"
"github.com/f0rt1ka/achilles-agent/internal/reporter"
```

**Step 3: Verify it compiles**

Run: `cd /home/jimx/F0RT1KA/ProjectAchilles/agent && go build ./...`
Expected: Compiles (unused imports will cause errors — that's fine, we fix in Task 2)

**Step 4: Commit**

```bash
git add agent/internal/poller/poller.go
git commit -m "feat(agent): expand taskResponse to decode full task payload"
```

---

### Task 2: Wire executor and reporter into `pollTasks`

**Files:**
- Modify: `agent/internal/poller/poller.go` (the `Run` function signature and `pollTasks` function)

**Step 1: Update `Run` to accept `*config.Config` and pass it through to `pollTasks`**

The `Run` function already receives `cfg *config.Config`. We need to pass `cfg` to
`pollTasks` so it can forward it to `executor.Execute()`.

Replace the current `pollTasks` call inside `Run`:

```go
		case <-pollTicker.C:
			pollTasks(ctx, client, st)
```

With:

```go
		case <-pollTicker.C:
			pollTasks(ctx, client, st, cfg)
```

**Step 2: Rewrite `pollTasks` to execute tasks and report results**

Replace the entire `pollTasks` function with:

```go
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

	// Execute the task.
	result, err := executor.Execute(ctx, client, task, cfg)
	if err != nil {
		log.Printf("execution error for task %s: %v", task.ID, err)
		// Mark the task as failed on the server.
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
```

**Step 3: Add `"fmt"` to imports if not already present**

Ensure the import block includes `"fmt"` (for `fmt.Sprintf` in `patchTaskFailed`).

**Step 4: Verify it compiles**

Run: `cd /home/jimx/F0RT1KA/ProjectAchilles/agent && go build ./...`
Expected: Clean build, no errors.

**Step 5: Run existing tests**

Run: `cd /home/jimx/F0RT1KA/ProjectAchilles/agent && go test ./... -v`
Expected: All existing tests pass.

**Step 6: Commit**

```bash
git add agent/internal/poller/poller.go
git commit -m "feat(agent): wire executor and reporter into polling loop"
```

---

### Task 3: Update heartbeat to reflect current task status

**Files:**
- Modify: `agent/internal/poller/poller.go` (add shared state for current task tracking)

Currently the heartbeat always reports `status: "idle"` and `current_task: nil`.
When a task is running, it should report `status: "executing"` and the task ID.

**Step 1: Add a package-level mutex and current-task tracking**

Add after the import block:

```go
var (
	currentTaskMu sync.Mutex
	currentTaskID *string
)

// setCurrentTask updates the currently executing task ID (nil when idle).
func setCurrentTask(taskID *string) {
	currentTaskMu.Lock()
	defer currentTaskMu.Unlock()
	currentTaskID = taskID
}

// getCurrentTask returns the currently executing task ID.
func getCurrentTask() *string {
	currentTaskMu.Lock()
	defer currentTaskMu.Unlock()
	return currentTaskID
}
```

Add `"sync"` to the import block.

**Step 2: Set current task around execution in `pollTasks`**

In `pollTasks`, wrap the execution block. Before calling `executor.Execute()`, add:

```go
	taskID := task.ID
	setCurrentTask(&taskID)
	defer setCurrentTask(nil)
```

**Step 3: Use current task in `sendHeartbeat`**

In `sendHeartbeat`, replace:

```go
	payload := heartbeatPayload{
		Timestamp:   time.Now().UTC(),
		Status:      "idle",
		CurrentTask: nil,
```

With:

```go
	curTask := getCurrentTask()
	status := "idle"
	if curTask != nil {
		status = "executing"
	}

	payload := heartbeatPayload{
		Timestamp:   time.Now().UTC(),
		Status:      status,
		CurrentTask: curTask,
```

**Step 4: Verify it compiles and tests pass**

Run: `cd /home/jimx/F0RT1KA/ProjectAchilles/agent && go build ./... && go test ./... -v`
Expected: Clean build, all tests pass.

**Step 5: Commit**

```bash
git add agent/internal/poller/poller.go
git commit -m "feat(agent): report current task in heartbeat status"
```

---

### Task 4: Fix backend state transition for `assigned → failed`

**Files:**
- Modify: `backend/src/services/agent/tasks.service.ts:48-53`

The backend's `VALID_TRANSITIONS` allows `assigned → ['downloading', 'failed', 'expired']` which is correct. However, if the executor errors during the *downloading* phase before it has patched the status itself, the poller's `patchTaskFailed` would try `assigned → failed` which IS already allowed. But let's also verify `downloading → failed` is allowed (it is). No code change needed here — just verification.

**Step 1: Verify state transitions are correct**

Read `backend/src/services/agent/tasks.service.ts:48-53` and confirm:
- `assigned → failed` ✅
- `downloading → failed` ✅
- `executing → failed` ✅

All needed transitions already exist. Skip this task if confirmed.

---

### Task 5: Cross-compile the updated agent and test end-to-end

**Files:**
- No new files — this is a build + deploy + test step

**Step 1: Cross-compile for Windows amd64**

```bash
cd /home/jimx/F0RT1KA/ProjectAchilles/agent
GOOS=windows GOARCH=amd64 go build -ldflags "-X main.version=0.6.0" -o ../achilles-agent.exe ./cmd/agent
```

**Step 2: Upload the new binary via the admin API**

Use the Agents page "Available Binaries" or the admin API to register version 0.6.0
and upload the new binary.

**Step 3: Deploy to Windows endpoint**

Copy the new `achilles-agent.exe` to the Windows endpoint, stop the old service,
replace the binary, and start the service again.

**Step 4: Create a test task from the UI**

Go to `/endpoints/tasks` → "Create Task" → select the agent, pick a test binary
that exists in the builds directory, and submit.

**Step 5: Verify the task lifecycle**

Watch the Tasks page for status transitions: `pending → assigned → downloading → executing → completed`.
Check that the result (stdout, stderr, exit code, duration) appears in the task detail.

**Step 6: Commit the final version bump**

```bash
git add agent/
git commit -m "feat(agent): v0.6.0 with task execution wired into polling loop"
```

---

## Summary of Changes

| File | Change |
|------|--------|
| `agent/internal/poller/poller.go` | Decode full task payload, call executor + reporter, heartbeat status tracking |
| (no other files) | The executor, reporter, config, store, and httpclient are all ready — only the poller needs changes |

The entire change is confined to **one file**: `poller.go`. All other modules (`executor.go`, `reporter.go`, `types.go`) are already complete and tested.
