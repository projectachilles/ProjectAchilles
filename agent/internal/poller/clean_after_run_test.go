package poller

import (
	"context"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"

	"github.com/f0rt1ka/achilles-agent/internal/config"
	"github.com/f0rt1ka/achilles-agent/internal/executor"
	"github.com/f0rt1ka/achilles-agent/internal/httpclient"
	"github.com/f0rt1ka/achilles-agent/internal/store"
)

// afterPassCall is what the recorder saw when the after pass ran.
type afterPassCall struct {
	testUUID    string
	busy        int32
	currentTask *string
}

// runTask drives executeAndReport with a server that refuses every status
// patch, so Execute fails at once without downloading anything, and returns
// the after-pass calls it saw.
func runTask(t *testing.T, taskType string) []afterPassCall {
	t.Helper()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusForbidden)
	}))
	defer srv.Close()

	st, err := store.New(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	cfg := config.DefaultConfig()
	cfg.ServerURL = srv.URL
	cfg.WorkDir = t.TempDir()

	var busy int32 = 1
	var calls []afterPassCall
	old := cleanAfterRun
	cleanAfterRun = func(_ *config.Config, testUUID string) {
		calls = append(calls, afterPassCall{testUUID, atomic.LoadInt32(&busy), getCurrentTask()})
	}
	t.Cleanup(func() { cleanAfterRun = old })

	task := &executor.Task{ID: "task-after-1", Type: taskType,
		Payload: executor.TaskPayload{TestUUID: "00000000-0000-4000-8000-0000000000f5"}}
	executeAndReport(context.Background(), httpclient.NewClient(&cfg, "test"), st, &cfg, "test", task,
		&busy, make(chan struct{}, 1), make(chan struct{}, 1), make(chan struct{}, 1), nil)
	if busy != 0 {
		t.Errorf("busy flag = %d after the task, want 0", busy)
	}
	return calls
}

func TestExecuteAndReportRunsTheAfterPassOnceWhileStillBusy(t *testing.T) {
	calls := runTask(t, "execute_test")
	if len(calls) != 1 {
		t.Fatalf("after pass ran %d times, want 1", len(calls))
	}
	c := calls[0]
	if c.testUUID != "00000000-0000-4000-8000-0000000000f5" {
		t.Errorf("after pass got test UUID %q", c.testUUID)
	}
	if c.busy != 1 {
		t.Errorf("busy flag = %d when the after pass ran, want 1", c.busy)
	}
	if c.currentTask != nil {
		t.Errorf("heartbeat still named task %q when the after pass ran", *c.currentTask)
	}
}

func TestExecuteAndReportSkipsTheAfterPassForOtherTasks(t *testing.T) {
	if calls := runTask(t, "unsupported_type"); len(calls) != 0 {
		t.Errorf("after pass ran %d times for an unsupported task, want 0", len(calls))
	}
}
