//go:build windows

package uninstaller

import (
	"fmt"
	"log"
	"os/exec"
	"syscall"
	"time"

	"github.com/f0rt1ka/achilles-agent/internal/config"
)

const serviceName = "AchillesAgent"

func platformCleanup(workDir, binPath string, _ *config.Config, cleanup bool) error {
	// Stop and delete the Windows service.
	log.Println("[uninstaller] stopping Windows service")
	_ = exec.Command("sc", "stop", serviceName).Run()
	time.Sleep(2 * time.Second)
	_ = exec.Command("sc", "delete", serviceName).Run()

	if !cleanup {
		log.Println("[uninstaller] soft-delete: service stopped, files preserved")
		return nil
	}

	// Full cleanup: spawn a detached cmd.exe process that waits for the
	// agent to exit and then deletes the work directory and binary.
	// On Windows, a running binary is locked by the OS, so we can't
	// delete it from within the process itself.
	script := fmt.Sprintf(
		`ping -n 6 127.0.0.1 >nul & rmdir /s /q "%s" & del /f /q "%s"`,
		workDir, binPath,
	)

	cmd := exec.Command("cmd.exe", "/C", script)
	cmd.SysProcAttr = &syscall.SysProcAttr{
		CreationFlags: 0x00000008, // DETACHED_PROCESS
	}

	if err := cmd.Start(); err != nil {
		return fmt.Errorf("failed to spawn cleanup process: %w", err)
	}

	log.Printf("[uninstaller] detached cleanup process spawned (PID %d)", cmd.Process.Pid)
	return nil
}
