//go:build windows

package config

import (
	"fmt"
	"os/exec"
)

// secureFilePermissions restricts file access to SYSTEM and Administrators only.
// Windows ignores Unix mode bits, so we use icacls to strip inherited permissions
// and grant explicit read/write to privileged accounts only.
func secureFilePermissions(path string) error {
	cmd := exec.Command("icacls", path,
		"/inheritance:r",
		"/grant:r", "NT AUTHORITY\\SYSTEM:(R,W)",
		"/grant:r", "BUILTIN\\Administrators:(R,W)",
	)
	out, err := cmd.CombinedOutput()
	if err != nil {
		return fmt.Errorf("icacls failed: %w: %s", err, out)
	}
	return nil
}
