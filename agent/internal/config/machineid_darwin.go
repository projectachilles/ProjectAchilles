//go:build darwin

package config

import (
	"fmt"
	"os/exec"
	"regexp"
	"strings"
)

// getMachineID returns the IOPlatformUUID from macOS's IORegistry.
// This is a stable hardware UUID that persists across OS reinstalls.
func getMachineID() (string, error) {
	out, err := exec.Command("ioreg", "-rd1", "-c", "IOPlatformExpertDevice").CombinedOutput()
	if err != nil {
		return "", fmt.Errorf("ioreg failed: %w: %s", err, out)
	}

	re := regexp.MustCompile(`"IOPlatformUUID"\s*=\s*"([^"]+)"`)
	match := re.FindStringSubmatch(string(out))
	if len(match) < 2 {
		return "", fmt.Errorf("IOPlatformUUID not found in ioreg output")
	}

	id := strings.TrimSpace(match[1])
	if id == "" {
		return "", fmt.Errorf("IOPlatformUUID is empty")
	}
	return id, nil
}
