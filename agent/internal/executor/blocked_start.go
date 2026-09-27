package executor

import (
	"errors"
	"os"
	"runtime"
	"time"
)

// classifyStartError decides how a cmd.Start() failure should be reported.
//
// On Windows an "access is denied" (ERROR_ACCESS_DENIED) at process creation is
// the fingerprint of a pre-execution block: Microsoft Defender ASR rule
// 01443614 ("block executables unless they meet a prevalence, age, or trusted
// list criterion") — or an application-control policy — refusing to launch a
// fresh, low-prevalence binary. The test binary never runs, so the technique is
// not evaluated; we surface that as a first-class, non-scoring result instead of
// failing the task. goos is passed in (rather than read from runtime.GOOS) so the
// decision is unit-testable on any platform.
//
// blocked is false for every other start failure (missing binary, bad path, and
// permission errors on non-Windows platforms), leaving the caller's normal error
// path intact.
func classifyStartError(err error, goos string) (exitCode int, reason string, blocked bool) {
	if goos == "windows" && errors.Is(err, os.ErrPermission) {
		return exitCodeBlockedPreExec, blockedPreExecReason, true
	}
	return 0, "", false
}

// blockedPreExecReason explains the outcome to whoever reads the result, and
// points at the exact rule and remediation. Kept in one place so the executor
// and its tests agree on the wording.
const blockedPreExecReason = "Blocked before execution (Access is denied). This is the fingerprint of Microsoft " +
	"Defender ASR rule 01443614-cd74-433a-b99e-2ecdc07bfc25 (\"block executables unless they meet a prevalence, " +
	"age, or trusted list criterion\"), or an application-control policy, refusing to launch a fresh low-prevalence " +
	"binary. The test never ran, so the technique was NOT evaluated (this is not a 'protected' result). To measure " +
	"this test, add a per-rule ASR exclusion for the test path (C:\\F0\\tasks) via Intune; confirm with Defender " +
	"event 1121."

// newBlockedResult builds the first-class result reported for a pre-execution
// block. It fills os/arch/hostname/timestamps so the payload satisfies the
// backend's TaskResultSchema (a result missing those is 400'd and the task
// zombies in "executing").
func newBlockedResult(taskID, testUUID, digest string, startedAt time.Time, code int, reason string) *Result {
	completedAt := time.Now().UTC()
	hostname, _ := os.Hostname()
	return &Result{
		TaskID:              taskID,
		TestUUID:            testUUID,
		ExitCode:            code,
		Stdout:              "",
		Stderr:              reason,
		StartedAt:           startedAt.UTC().Format(time.RFC3339),
		CompletedAt:         completedAt.Format(time.RFC3339),
		ExecutionDurationMs: completedAt.Sub(startedAt).Milliseconds(),
		BinarySHA256:        digest,
		Hostname:            hostname,
		OS:                  runtime.GOOS,
		Arch:                runtime.GOARCH,
	}
}

