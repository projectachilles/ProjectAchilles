//go:build windows

package config

import (
	"fmt"
	"os"
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

// SecureConfigPermissions restricts an existing config file (it holds the
// agent key) to SYSTEM and Administrators. Called at startup so a config
// written by an agent whose icacls call failed (localized account names, before
// winacl) is locked down without waiting for the next Save.
func SecureConfigPermissions(path string) error {
	return secureFilePermissions(path)
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

// SecureAgentDir locks the folder that holds the agent (C:\F0) to SYSTEM and
// Administrators, like bootstrap-windows.ps1 does, and resets the work dir to
// inherit from it. Under C:\ a new folder inherits Modify for every signed-in
// user; the agent downloads test binaries into the work dir, checks their
// hash and then runs them as SYSTEM, and the updater stages the new binary
// next to the old one, so either could be swapped after the check.
//
// Only the standard layout is touched (see winacl.AgentDir), and nothing that
// is a junction or symbolic link. Unlike the bootstrap script it does not walk
// and normalize every existing item: files the agent created inherit the new
// DACL, and new task folders are created inside the locked folder.
func SecureAgentDir(exePath, workDir string) error {
	dir, ok := winacl.AgentDir(exePath, workDir)
	if !ok {
		return fmt.Errorf("work dir %s is not directly inside the agent folder (%s); lock both with bootstrap-windows.ps1 or a GPO", workDir, exePath)
	}
	if err := refuseLink(dir); err != nil {
		return err
	}
	for _, argv := range winacl.LockDirArgs(dir) {
		if err := runICACLS(argv); err != nil {
			return err
		}
	}
	if _, err := os.Lstat(workDir); os.IsNotExist(err) {
		return nil // created later, inside the locked folder
	}
	if err := refuseLink(workDir); err != nil {
		return err
	}
	for _, argv := range winacl.InheritOnlyArgs(workDir) {
		if err := runICACLS(argv); err != nil {
			return err
		}
	}
	return nil
}

// refuseLink returns an error unless path is a plain directory: locking a
// junction or symbolic link would lock (or fail to lock) whatever it points at.
func refuseLink(path string) error {
	fi, err := os.Lstat(path)
	if err != nil {
		return err
	}
	if fi.Mode()&(os.ModeSymlink|os.ModeIrregular) != 0 || !fi.IsDir() {
		return fmt.Errorf("%s is not a plain directory (junction, link or file); not locking it", path)
	}
	return nil
}

func runICACLS(argv []string) error {
	out, err := exec.Command(argv[0], argv[1:]...).CombinedOutput()
	if err != nil {
		return fmt.Errorf("%s failed: %w: %s", argv[1:], err, out)
	}
	return nil
}
