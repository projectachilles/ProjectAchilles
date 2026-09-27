package executor

import (
	"errors"
	"fmt"
	"os"
	"strings"
	"testing"
	"time"
)

// TestNewBlockedResult_PopulatesSchemaRequiredFields guards the reason the task
// used to zombie: a result missing os/arch/hostname/timestamps is 400'd by the
// backend TaskResultSchema and the task stays in "executing" forever. The
// blocked-pre-exec result must carry all of them.
func TestNewBlockedResult_PopulatesSchemaRequiredFields(t *testing.T) {
	started := time.Now().UTC()
	r := newBlockedResult("task-1", "uuid-1", "deadbeef", started, exitCodeBlockedPreExec, blockedPreExecReason)

	if r.OS == "" || r.Arch == "" {
		t.Fatalf("os/arch must be set (got os=%q arch=%q)", r.OS, r.Arch)
	}
	if r.Hostname == "" {
		t.Fatal("hostname must be set")
	}
	if r.StartedAt == "" || r.CompletedAt == "" {
		t.Fatalf("timestamps must be set (started=%q completed=%q)", r.StartedAt, r.CompletedAt)
	}
	if r.ExitCode != exitCodeBlockedPreExec {
		t.Fatalf("expected exit code %d, got %d", exitCodeBlockedPreExec, r.ExitCode)
	}
	if r.TaskID != "task-1" || r.TestUUID != "uuid-1" {
		t.Fatalf("task/test identity not carried through: %+v", r)
	}
	if !strings.Contains(r.Stderr, "01443614") {
		t.Fatalf("reason should reach the operator via stderr, got %q", r.Stderr)
	}
}

// TestClassifyStartError_WindowsPermissionIsPreExecBlock verifies that an
// "access is denied" failure from cmd.Start() on Windows is recognised as a
// pre-execution block (Defender ASR 01443614) and mapped to the non-scoring
// blocked-pre-exec outcome with an explanatory reason — not a bare error.
func TestClassifyStartError_WindowsPermissionIsPreExecBlock(t *testing.T) {
	// This is the shape Go produces for CreateProcess ERROR_ACCESS_DENIED.
	startErr := fmt.Errorf("fork/exec C:\\F0\\tasks\\x.exe: %w", os.ErrPermission)

	code, reason, blocked := classifyStartError(startErr, "windows")

	if !blocked {
		t.Fatal("expected a Windows permission-denied start error to be classified as a pre-exec block")
	}
	if code != exitCodeBlockedPreExec {
		t.Fatalf("expected exit code %d, got %d", exitCodeBlockedPreExec, code)
	}
	if !strings.Contains(reason, "01443614") {
		t.Fatalf("expected reason to name ASR rule 01443614, got %q", reason)
	}
}

// TestClassifyStartError_NonWindowsPermissionIsNotBlock verifies we do NOT
// treat a permission error on Linux/macOS as an ASR block — that reason is
// Windows-specific, and elsewhere a denied exec is a genuine error.
func TestClassifyStartError_NonWindowsPermissionIsNotBlock(t *testing.T) {
	startErr := fmt.Errorf("fork/exec /f0/tasks/x: %w", os.ErrPermission)

	_, _, blocked := classifyStartError(startErr, "linux")

	if blocked {
		t.Fatal("expected a permission error on linux NOT to be classified as a pre-exec block")
	}
}

// TestClassifyStartError_OtherErrorIsNotBlock verifies that a non-permission
// start failure (e.g. missing binary) is left to the caller's normal error
// path rather than being misreported as a security block.
func TestClassifyStartError_OtherErrorIsNotBlock(t *testing.T) {
	_, _, blocked := classifyStartError(errors.New("file does not exist"), "windows")

	if blocked {
		t.Fatal("expected a non-permission start error NOT to be classified as a pre-exec block")
	}
}
