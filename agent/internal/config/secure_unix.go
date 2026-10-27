//go:build !windows

package config

import "os"

// secureFilePermissions enforces 0600 (owner read/write only) on the config file.
// This is called after every write to ensure correct permissions even if the file
// was previously created by another process with broader access.
func secureFilePermissions(path string) error {
	return os.Chmod(path, 0600)
}

// SecureConfigPermissions enforces 0600 on an existing config file. Called at
// startup so a config that was never re-saved gets the same mode Save gives.
func SecureConfigPermissions(path string) error {
	return secureFilePermissions(path)
}

// SecureBinaryPermissions enforces 0700 (owner rwx only) on the agent binary.
// Called at startup to retroactively fix permissions left by older applyUpdate() code.
func SecureBinaryPermissions(path string) error {
	return os.Chmod(path, 0700)
}

// SecureAgentDir is a no-op outside Windows: the work dir is created with
// mode 0700, which Unix honours (Windows ignores mode bits, hence the ACLs).
func SecureAgentDir(exePath, workDir string) error {
	return nil
}
