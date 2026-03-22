//go:build linux || darwin

package service

import "os"

// isElevated returns true if the current process is running as root.
func isElevated() bool {
	return os.Geteuid() == 0
}
