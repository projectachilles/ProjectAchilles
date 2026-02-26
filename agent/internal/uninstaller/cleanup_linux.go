//go:build linux

package uninstaller

import (
	"log"
	"os"
	"os/exec"

	"github.com/f0rt1ka/achilles-agent/internal/config"
)

const (
	unitName = "achilles-agent.service"
	unitPath = "/etc/systemd/system/" + unitName
)

func platformCleanup(workDir, binPath string, _ *config.Config, cleanup bool) error {
	// Stop and disable the systemd service.
	log.Println("[uninstaller] stopping systemd service")
	_ = exec.Command("systemctl", "stop", unitName).Run()
	_ = exec.Command("systemctl", "disable", unitName).Run()

	// Remove the unit file and reload systemd.
	if err := os.Remove(unitPath); err != nil && !os.IsNotExist(err) {
		log.Printf("[uninstaller] warning: could not remove unit file: %v", err)
	}
	_ = exec.Command("systemctl", "daemon-reload").Run()

	if !cleanup {
		log.Println("[uninstaller] soft-delete: service stopped, files preserved")
		return nil
	}

	// Full cleanup: remove work directory and binary.
	// POSIX allows deleting a running binary (unlinks the directory entry;
	// the process retains its file descriptor until exit).
	log.Printf("[uninstaller] removing work directory: %s", workDir)
	if err := os.RemoveAll(workDir); err != nil {
		log.Printf("[uninstaller] warning: RemoveAll(%s): %v", workDir, err)
	}

	log.Printf("[uninstaller] removing binary: %s", binPath)
	if err := os.Remove(binPath); err != nil && !os.IsNotExist(err) {
		log.Printf("[uninstaller] warning: Remove(%s): %v", binPath, err)
	}

	log.Println("[uninstaller] full cleanup complete")
	return nil
}
