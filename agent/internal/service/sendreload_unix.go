//go:build linux || darwin

package service

import (
	"fmt"
	"syscall"
)

// SendReload signals the running agent service to re-read its config from disk.
// On Unix this sends SIGHUP to the service's PID (discovered via the platform
// service manager — systemctl on Linux, launchctl on macOS).
func SendReload() error {
	if !isElevated() {
		return fmt.Errorf("reload requires administrator/root privileges")
	}
	st := platformServiceStatus()
	if !st.Installed {
		return fmt.Errorf("agent service is not installed")
	}
	if !st.Running || st.PID == 0 {
		return fmt.Errorf("agent service is not running")
	}
	if err := syscall.Kill(st.PID, syscall.SIGHUP); err != nil {
		return fmt.Errorf("send SIGHUP to pid %d: %w", st.PID, err)
	}
	return nil
}
