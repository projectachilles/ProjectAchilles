//go:build windows

package config

import (
	"fmt"
	"os/exec"
	"regexp"
	"strings"
)

// getMachineID returns the MachineGuid from the Windows registry.
// This GUID is generated at OS install time and persists across reboots.
func getMachineID() (string, error) {
	out, err := exec.Command("reg", "query",
		`HKLM\SOFTWARE\Microsoft\Cryptography`,
		"/v", "MachineGuid",
	).CombinedOutput()
	if err != nil {
		return "", fmt.Errorf("reg query failed: %w: %s", err, out)
	}

	re := regexp.MustCompile(`MachineGuid\s+REG_SZ\s+(\S+)`)
	match := re.FindStringSubmatch(string(out))
	if len(match) < 2 {
		return "", fmt.Errorf("MachineGuid not found in registry output")
	}

	id := strings.TrimSpace(match[1])
	if id == "" {
		return "", fmt.Errorf("MachineGuid is empty")
	}
	return id, nil
}
