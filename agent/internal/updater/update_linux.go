//go:build linux

package updater

import (
	"fmt"
	"os"
)

// applyUpdate replaces the current binary with the new one. On Linux a running
// binary's file can be replaced atomically via rename on the same filesystem.
func applyUpdate(currentBin, newBin string) error {
	if err := os.Chmod(newBin, 0700); err != nil {
		return fmt.Errorf("chmod: %w", err)
	}

	if err := os.Rename(newBin, currentBin); err != nil {
		return fmt.Errorf("rename: %w", err)
	}

	return nil
}
