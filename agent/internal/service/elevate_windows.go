//go:build windows

package service

import "golang.org/x/sys/windows"

// isElevated returns true if the current process has administrator privileges.
func isElevated() bool {
	token := windows.GetCurrentProcessToken()
	return token.IsElevated()
}
