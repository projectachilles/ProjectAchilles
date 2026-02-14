//go:build linux

package config

import (
	"fmt"
	"os"
	"strings"
)

// getMachineID returns the unique machine identifier from /etc/machine-id.
// This file is present on all systemd-based Linux distributions and contains
// a hex-encoded 128-bit ID that persists across reboots.
func getMachineID() (string, error) {
	data, err := os.ReadFile("/etc/machine-id")
	if err != nil {
		return "", fmt.Errorf("read /etc/machine-id: %w", err)
	}
	id := strings.TrimSpace(string(data))
	if id == "" {
		return "", fmt.Errorf("/etc/machine-id is empty")
	}
	return id, nil
}
