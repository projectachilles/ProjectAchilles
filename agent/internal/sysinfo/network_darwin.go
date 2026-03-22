//go:build darwin

package sysinfo

import (
	"os/exec"
	"strings"
)

// CheckNetworkState inspects macOS network interfaces via ifconfig.
// Returns "adapters_ok" if at least one non-loopback interface has
// "status: active", "all_adapters_down" if none are active, or
// "check_failed" on error.
func CheckNetworkState() string {
	out, err := exec.Command("ifconfig").Output()
	if err != nil {
		return "check_failed"
	}

	// ifconfig output is separated by blank lines per interface.
	sections := strings.Split(string(out), "\n\n")
	hasNonLoopback := false
	for _, section := range sections {
		if strings.HasPrefix(section, "lo") {
			continue
		}
		if !strings.Contains(section, "flags=") {
			continue
		}
		hasNonLoopback = true
		if strings.Contains(section, "status: active") {
			return "adapters_ok"
		}
	}

	if !hasNonLoopback {
		return "adapters_ok"
	}
	return "all_adapters_down"
}
