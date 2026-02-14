//go:build windows

package updater

import (
	"fmt"
	"log"
	"os"
	"os/exec"
)

// applyUpdate replaces the current binary with the new one. Windows cannot
// overwrite a running executable, so we rename the current binary to .old
// first, then move the new binary into place.
func applyUpdate(currentBin, newBin string) error {
	oldBin := currentBin + ".old"

	// Remove a leftover .old from a previous update.
	os.Remove(oldBin)

	if err := os.Rename(currentBin, oldBin); err != nil {
		return fmt.Errorf("rename current to .old: %w", err)
	}

	if err := os.Rename(newBin, currentBin); err != nil {
		// Attempt to restore the original binary.
		os.Rename(oldBin, currentBin)
		return fmt.Errorf("rename new to current: %w", err)
	}

	secureBinaryPermissions(currentBin)
	return nil
}

// secureBinaryPermissions restricts binary access to SYSTEM and Administrators.
// Windows ignores Unix mode bits, so we use icacls to strip inherited permissions
// and grant explicit access to privileged accounts only.
func secureBinaryPermissions(path string) {
	cmd := exec.Command("icacls", path,
		"/inheritance:r",
		"/grant:r", "NT AUTHORITY\\SYSTEM:(RX)",
		"/grant:r", "BUILTIN\\Administrators:(F)",
	)
	if out, err := cmd.CombinedOutput(); err != nil {
		log.Printf("warning: icacls on binary failed: %v: %s", err, out)
	}
}
