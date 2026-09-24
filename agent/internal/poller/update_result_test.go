package poller

import (
	"runtime"
	"testing"
	"time"
)

// The backend's TaskResultSchema rejects a result whose os/arch are not a
// known enum value, and requires the timestamp and hostname fields. A bare
// Result{ExitCode: 0} was 400'd on every admin-triggered update, leaving the
// task stuck in 'executing' forever even when the update succeeded.
func TestUpdateTaskResult_PopulatesFieldsTheServerValidates(t *testing.T) {
	started := time.Date(2026, 9, 24, 3, 4, 32, 0, time.UTC)

	r := updateTaskResult("task-123", started, "already up to date")

	if r.TaskID != "task-123" {
		t.Errorf("TaskID = %q, want task-123", r.TaskID)
	}
	if r.OS != runtime.GOOS || r.Arch != runtime.GOARCH {
		t.Errorf("OS/Arch = %q/%q, want %q/%q", r.OS, r.Arch, runtime.GOOS, runtime.GOARCH)
	}
	if r.StartedAt != "2026-09-24T03:04:32Z" {
		t.Errorf("StartedAt = %q, want RFC3339 of the start time", r.StartedAt)
	}
	if r.CompletedAt == "" {
		t.Error("CompletedAt is empty")
	}
	if _, err := time.Parse(time.RFC3339, r.CompletedAt); err != nil {
		t.Errorf("CompletedAt %q is not RFC3339: %v", r.CompletedAt, err)
	}
	if r.Hostname == "" {
		t.Error("Hostname is empty")
	}
	if r.ExitCode != 0 || r.Stdout != "already up to date" {
		t.Errorf("ExitCode/Stdout = %d/%q", r.ExitCode, r.Stdout)
	}
}
