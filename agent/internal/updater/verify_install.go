package updater

import (
	"context"
	"errors"
	"fmt"
	"log"
	"os"
	"os/exec"
	"regexp"
	"runtime"
	"strings"
	"time"
)

// ErrLaunchCheckFailed is returned when a freshly installed binary cannot be
// executed, or reports a different version than it was advertised as. The
// previous binary has been restored when this is returned (unless the message
// says rollback failed), so the running agent can keep going.
var ErrLaunchCheckFailed = errors.New("new agent binary failed its launch check")

// launchCheckTimeout bounds `<binary> --version`, which prints and exits
// before any config, network, or service code runs.
const launchCheckTimeout = 30 * time.Second

var versionOutput = regexp.MustCompile(`achilles-agent v(\S+)`)

// installAndVerify swaps newBin into currentBin's path, then launches it there
// with --version. Committing to the update means exiting for a restart the
// service manager must complete; if an endpoint security policy won't run the
// new file (e.g. Defender ASR's prevalence rule returns Access Denied to the
// service manager), that restart never succeeds and the endpoint goes dark.
// So the launch is tried while the current process is still alive, and on
// failure the previous binary is put back.
//
// The check runs at the final path, not the temp download path, so a
// path-scoped allowlist entry for the agent binary applies to it.
func installAndVerify(ctx context.Context, currentBin, newBin, wantVersion string) error {
	if err := applyUpdate(currentBin, newBin); err != nil {
		return fmt.Errorf("apply update: %w", err)
	}

	checkErr := launchCheck(ctx, currentBin, wantVersion)
	if checkErr == nil {
		return nil
	}

	log.Printf("launch check failed for %s: %v — rolling back", currentBin, checkErr)
	if rbErr := rollbackUpdate(currentBin); rbErr != nil {
		return fmt.Errorf("%w; ROLLBACK FAILED, the agent may not restart: %v", checkErr, rbErr)
	}
	return fmt.Errorf("%w; rolled back to the previous binary", checkErr)
}

// launchCheck runs `<path> --version` and confirms the binary starts and
// reports wantVersion.
func launchCheck(ctx context.Context, path, wantVersion string) error {
	ctx, cancel := context.WithTimeout(ctx, launchCheckTimeout)
	defer cancel()

	out, err := exec.CommandContext(ctx, path, "--version").CombinedOutput()
	if err != nil {
		return fmt.Errorf("%w: could not execute it%s: %v (output: %q)",
			ErrLaunchCheckFailed, blockedHint(err), err, strings.TrimSpace(string(out)))
	}

	m := versionOutput.FindSubmatch(out)
	if m == nil {
		return fmt.Errorf("%w: unexpected --version output %q", ErrLaunchCheckFailed, strings.TrimSpace(string(out)))
	}
	if got := string(m[1]); normalizeVersion(got) != normalizeVersion(wantVersion) {
		return fmt.Errorf("%w: it was advertised as %s but reports %s — its embedded version does not match its registered version",
			ErrLaunchCheckFailed, wantVersion, got)
	}
	return nil
}

// blockedHint names the likely cause when Windows refuses to run the file, so
// the failed update task tells the operator where to look.
func blockedHint(err error) string {
	if runtime.GOOS == "windows" && errors.Is(err, os.ErrPermission) {
		return " (Access denied — typically Microsoft Defender ASR rule 01443614-cd74-433a-b99e-2ecdc07bfc25 " +
			"\"block executables unless they meet a prevalence, age, or trusted list criterion\", or an application-control " +
			"policy; check Defender event 1121 and allowlist the agent binary path)"
	}
	return ""
}

// rollbackUpdate restores currentBin + ".old" (left by every platform's
// applyUpdate) into currentBin. The rejected binary is moved aside first, so a
// failed restore can put it back rather than leave no binary at the path.
func rollbackUpdate(currentBin string) error {
	oldBin := currentBin + ".old"
	rejected := currentBin + ".rejected"

	if _, err := os.Stat(oldBin); err != nil {
		return fmt.Errorf("no previous binary to restore: %w", err)
	}

	os.Remove(rejected)
	if err := os.Rename(currentBin, rejected); err != nil {
		return fmt.Errorf("move rejected binary aside: %w", err)
	}
	if err := os.Rename(oldBin, currentBin); err != nil {
		_ = os.Rename(rejected, currentBin)
		return fmt.Errorf("restore previous binary: %w", err)
	}
	// Best effort: a security product may deny access to the rejected file.
	if err := os.Remove(rejected); err != nil {
		log.Printf("warning: could not remove rejected binary %s: %v", rejected, err)
	}
	return nil
}

func normalizeVersion(v string) string {
	return strings.TrimPrefix(strings.TrimPrefix(v, "v"), "V")
}
