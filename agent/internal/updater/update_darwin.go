//go:build darwin

package updater

import (
	"fmt"
	"log"
	"os"
	"os/exec"
)

// applyUpdate replaces the current binary with the new one. On macOS a running
// binary's file can be replaced atomically via rename on the same filesystem
// (same as Linux — APFS and HFS+ support this).
func applyUpdate(currentBin, newBin string) error {
	if err := os.Chmod(newBin, 0755); err != nil {
		return fmt.Errorf("chmod: %w", err)
	}

	// Ad-hoc sign the new binary before swapping it in. macOS enforces
	// Launch Constraints that SIGKILL unsigned binaries (codeSigningID
	// "a.out"). codesign ships with macOS — no external dependencies.
	if out, err := exec.Command("codesign", "-f", "-s", "-", newBin).CombinedOutput(); err != nil {
		log.Printf("warning: ad-hoc codesign failed: %v: %s", err, out)
	}

	if err := os.Rename(newBin, currentBin); err != nil {
		return fmt.Errorf("rename: %w", err)
	}

	return nil
}
