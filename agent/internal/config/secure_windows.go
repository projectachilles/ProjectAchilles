//go:build windows

package config

import (
	"fmt"
	"os/exec"

	"github.com/f0rt1ka/achilles-agent/internal/winacl"
)

// secureFilePermissions restricts file access to SYSTEM and Administrators only.
// Windows ignores Unix mode bits, so we use icacls to strip inherited permissions
// and grant explicit read/write to privileged accounts only.
func secureFilePermissions(path string) error {
	argv := winacl.RestrictArgs(path, "R,W", "R,W")
	out, err := exec.Command(argv[0], argv[1:]...).CombinedOutput()
	if err != nil {
		return fmt.Errorf("icacls failed: %w: %s", err, out)
	}
	return nil
}

// SecureBinaryPermissions restricts the agent binary to SYSTEM and
// Administrators (full control). Called at startup to retroactively fix
// permissions left by older applyUpdate() code.
func SecureBinaryPermissions(path string) error {
	argv := winacl.RestrictArgs(path, "F", "F")
	out, err := exec.Command(argv[0], argv[1:]...).CombinedOutput()
	if err != nil {
		return fmt.Errorf("icacls failed: %w: %s", err, out)
	}
	return nil
}
