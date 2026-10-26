// Package firstboot drives the first boot of the ProjectAchilles appliance VM:
// keyboard layout, admin password, network, identity, and enabling SSH. All
// host access goes through the Host interface so tests can fake it.
package firstboot

import (
	"bytes"
	"context"
	"io/fs"
	"os"
	"os/exec"
	"path/filepath"
)

const (
	// BinPath is where install-onprem.sh puts the installer, so `upgrade` replaces it.
	BinPath = "/opt/projectachilles/achilles-installer"
	// RepoDir is the ProjectAchilles checkout.
	RepoDir = "/opt/projectachilles"
	// AdminUser is the appliance's local admin account.
	AdminUser = "achilles"
	// MarkerPath exists once first boot has completed.
	MarkerPath = "/var/lib/projectachilles/firstboot.done"
	// NetplanPath is our netplan file (mode 0600).
	NetplanPath = "/etc/netplan/50-achilles.yaml"
	// SSHDConfPath sorts before the cloud image's 60-cloudimg-settings.conf;
	// sshd uses the first value it reads, so ours wins.
	SSHDConfPath = "/etc/ssh/sshd_config.d/50-achilles.conf"
	// KeyboardPath is the console keyboard configuration.
	KeyboardPath = "/etc/default/keyboard"
	// FirstbootUnit is the systemd unit that runs first boot on tty1.
	FirstbootUnit = "achilles-firstboot.service"
	// IssuePath is the console banner snippet.
	IssuePath = "/etc/issue.d/50-achilles.issue"
)

// Host is everything first boot needs from the machine.
type Host interface {
	// Run executes a command and returns its combined output.
	Run(ctx context.Context, stdin []byte, name string, args ...string) ([]byte, error)
	ReadFile(path string) ([]byte, error)
	// WriteFile creates missing parent directories with mode 0755.
	WriteFile(path string, data []byte, perm fs.FileMode) error
	Exists(path string) bool
}

// OSHost is the real Host.
type OSHost struct{}

// Run executes the command. A nil stdin attaches os.Stdin, because setupcon
// needs the console.
func (OSHost) Run(ctx context.Context, stdin []byte, name string, args ...string) ([]byte, error) {
	cmd := exec.CommandContext(ctx, name, args...)
	if stdin == nil {
		cmd.Stdin = os.Stdin
	} else {
		cmd.Stdin = bytes.NewReader(stdin)
	}
	return cmd.CombinedOutput()
}

func (OSHost) ReadFile(path string) ([]byte, error) { return os.ReadFile(path) }

func (OSHost) WriteFile(path string, data []byte, perm fs.FileMode) error {
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return err
	}
	if err := os.WriteFile(path, data, perm); err != nil {
		return err
	}
	// WriteFile only applies perm to new files; enforce it on rewrites too.
	return os.Chmod(path, perm)
}

func (OSHost) Exists(path string) bool {
	_, err := os.Stat(path)
	return err == nil
}
