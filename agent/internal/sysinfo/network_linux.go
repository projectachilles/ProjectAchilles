//go:build linux

package sysinfo

import (
	"os"
	"path/filepath"
	"strings"
)

// CheckNetworkState inspects non-loopback network interfaces via sysfs.
// Returns "adapters_ok" if at least one interface is up, "all_adapters_down"
// if all are down, or "check_failed" on error.
func CheckNetworkState() string {
	entries, err := os.ReadDir("/sys/class/net")
	if err != nil {
		return "check_failed"
	}

	hasNonLoopback := false
	for _, entry := range entries {
		name := entry.Name()
		if name == "lo" {
			continue
		}
		hasNonLoopback = true
		data, err := os.ReadFile(filepath.Join("/sys/class/net", name, "operstate"))
		if err != nil {
			continue
		}
		state := strings.TrimSpace(string(data))
		// "unknown" is common for virtual adapters (veth, docker bridges)
		if state == "up" || state == "unknown" {
			return "adapters_ok"
		}
	}

	if !hasNonLoopback {
		return "adapters_ok" // only loopback exists (container)
	}
	return "all_adapters_down"
}
