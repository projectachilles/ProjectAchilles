//go:build darwin

package uninstaller

import (
	"log"
	"os"
	"os/exec"

	"github.com/f0rt1ka/achilles-agent/internal/config"
)

const plistPath = "/Library/LaunchDaemons/com.f0rtika.achilles-agent.plist"

func platformCleanup(workDir, binPath string, _ *config.Config, cleanup bool) error {
	// Unload the launchd plist (stops the service).
	log.Println("[uninstaller] unloading launchd plist")
	_ = exec.Command("launchctl", "unload", plistPath).Run()

	// Remove the plist file.
	if err := os.Remove(plistPath); err != nil && !os.IsNotExist(err) {
		log.Printf("[uninstaller] warning: could not remove plist: %v", err)
	}

	if !cleanup {
		log.Println("[uninstaller] soft-delete: service stopped, files preserved")
		return nil
	}

	// Full cleanup: remove work directory, binary, and log files.
	log.Printf("[uninstaller] removing work directory: %s", workDir)
	if err := os.RemoveAll(workDir); err != nil {
		log.Printf("[uninstaller] warning: RemoveAll(%s): %v", workDir, err)
	}

	log.Printf("[uninstaller] removing binary: %s", binPath)
	if err := os.Remove(binPath); err != nil && !os.IsNotExist(err) {
		log.Printf("[uninstaller] warning: Remove(%s): %v", binPath, err)
	}

	// Remove log files.
	for _, logFile := range []string{"/var/log/achilles-agent.log", "/var/log/achilles-agent.err"} {
		if err := os.Remove(logFile); err != nil && !os.IsNotExist(err) {
			log.Printf("[uninstaller] warning: Remove(%s): %v", logFile, err)
		}
	}

	log.Println("[uninstaller] full cleanup complete")
	return nil
}
