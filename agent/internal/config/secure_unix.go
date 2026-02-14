//go:build !windows

package config

import "os"

// secureFilePermissions enforces 0600 (owner read/write only) on the config file.
// This is called after every write to ensure correct permissions even if the file
// was previously created by another process with broader access.
func secureFilePermissions(path string) error {
	return os.Chmod(path, 0600)
}
