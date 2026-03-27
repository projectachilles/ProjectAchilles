//go:build linux

package updater

import (
	"fmt"
	"io"
	"os"
)

// applyUpdate replaces the current binary with the new one. On Linux a running
// binary's file can be replaced atomically via rename on the same filesystem.
// The old binary is preserved as <path>.old for rollback.
func applyUpdate(currentBin, newBin string) error {
	if err := os.Chmod(newBin, 0700); err != nil {
		return fmt.Errorf("chmod: %w", err)
	}

	// Preserve the old binary for rollback.
	oldBin := currentBin + ".old"
	os.Remove(oldBin) // Remove leftover .old from a previous update.
	if err := copyFile(currentBin, oldBin); err != nil {
		return fmt.Errorf("backup current binary: %w", err)
	}

	if err := os.Rename(newBin, currentBin); err != nil {
		return fmt.Errorf("rename: %w", err)
	}

	return nil
}

// copyFile copies src to dst, preserving the source file's permissions.
func copyFile(src, dst string) error {
	srcFile, err := os.Open(src)
	if err != nil {
		return err
	}
	defer srcFile.Close()

	info, err := srcFile.Stat()
	if err != nil {
		return err
	}

	dstFile, err := os.OpenFile(dst, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, info.Mode())
	if err != nil {
		return err
	}
	defer dstFile.Close()

	if _, err := io.Copy(dstFile, srcFile); err != nil {
		return err
	}
	return dstFile.Close()
}
