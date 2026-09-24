//go:build !windows

package updater

import (
	"context"
	"errors"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
)

// fakeAgent writes an executable script that mimics `achilles-agent --version`.
func fakeAgent(t *testing.T, path, version string) {
	t.Helper()
	script := "#!/bin/sh\necho \"achilles-agent v" + version + "\"\n"
	if err := os.WriteFile(path, []byte(script), 0700); err != nil {
		t.Fatal(err)
	}
}

// blockedAgent writes a file that cannot be launched — the stand-in for a
// binary an endpoint security policy refuses to execute (Defender ASR on
// Windows returns ERROR_ACCESS_DENIED; here exec fails on a missing interpreter).
func blockedAgent(t *testing.T, path string) {
	t.Helper()
	if err := os.WriteFile(path, []byte("#!/nonexistent/interpreter\n"), 0700); err != nil {
		t.Fatal(err)
	}
}

func reportedVersion(t *testing.T, path string) string {
	t.Helper()
	out, err := exec.Command(path, "--version").Output()
	if err != nil {
		t.Fatalf("running %s: %v", path, err)
	}
	return strings.TrimSpace(string(out))
}

func setup(t *testing.T) (dir, current, next string) {
	t.Helper()
	dir = t.TempDir()
	current = filepath.Join(dir, "achilles-agent")
	next = filepath.Join(dir, "achilles-update-123")
	fakeAgent(t, current, "0.6.3")
	return
}

func TestInstallAndVerify_KeepsNewBinaryThatLaunchesAndReportsAdvertisedVersion(t *testing.T) {
	_, current, next := setup(t)
	fakeAgent(t, next, "0.6.5")

	if err := installAndVerify(context.Background(), current, next, "0.6.5"); err != nil {
		t.Fatalf("installAndVerify: %v", err)
	}
	if got := reportedVersion(t, current); got != "achilles-agent v0.6.5" {
		t.Fatalf("installed binary reports %q", got)
	}
	if got := reportedVersion(t, current+".old"); got != "achilles-agent v0.6.3" {
		t.Fatalf(".old reports %q, want the previous binary", got)
	}
}

// The Sep 2026 outage: Defender ASR blocked the freshly built binary, the
// agent exited for a restart that could never succeed, and the endpoint went
// dark. A binary that cannot launch must be rolled back before exiting.
func TestInstallAndVerify_RollsBackBinaryThatCannotLaunch(t *testing.T) {
	_, current, next := setup(t)
	blockedAgent(t, next)

	err := installAndVerify(context.Background(), current, next, "0.6.5")

	if !errors.Is(err, ErrLaunchCheckFailed) {
		t.Fatalf("err = %v, want ErrLaunchCheckFailed", err)
	}
	if !strings.Contains(err.Error(), "rolled back") {
		t.Errorf("error should say it rolled back: %v", err)
	}
	if got := reportedVersion(t, current); got != "achilles-agent v0.6.3" {
		t.Fatalf("after rollback the agent path runs %q, want the previous binary", got)
	}
}

// Catches a mislabelled build before it is committed to, rather than after a
// restart (the 0.6.3-registered-as-0.6.4 incident).
func TestInstallAndVerify_RollsBackBinaryReportingWrongVersion(t *testing.T) {
	_, current, next := setup(t)
	fakeAgent(t, next, "0.6.3")

	err := installAndVerify(context.Background(), current, next, "0.6.4")

	if !errors.Is(err, ErrLaunchCheckFailed) {
		t.Fatalf("err = %v, want ErrLaunchCheckFailed", err)
	}
	if !strings.Contains(err.Error(), "0.6.4") || !strings.Contains(err.Error(), "0.6.3") {
		t.Errorf("error should name both versions: %v", err)
	}
	if _, statErr := os.Stat(current + ".rejected"); !os.IsNotExist(statErr) {
		t.Errorf("rejected binary should be cleaned up, stat err = %v", statErr)
	}
}

func TestInstallAndVerify_AcceptsLeadingVOnAdvertisedVersion(t *testing.T) {
	_, current, next := setup(t)
	fakeAgent(t, next, "0.6.5")

	if err := installAndVerify(context.Background(), current, next, "v0.6.5"); err != nil {
		t.Fatalf("installAndVerify: %v", err)
	}
}

func TestRollbackUpdate_ReportsMissingBackup(t *testing.T) {
	dir := t.TempDir()
	current := filepath.Join(dir, "achilles-agent")
	fakeAgent(t, current, "0.6.5")

	if err := rollbackUpdate(current); err == nil {
		t.Fatal("rollback without a .old backup must fail")
	}
	// The binary in place must be left alone rather than moved away.
	if got := reportedVersion(t, current); got != "achilles-agent v0.6.5" {
		t.Fatalf("binary in place was disturbed: %q", got)
	}
}
