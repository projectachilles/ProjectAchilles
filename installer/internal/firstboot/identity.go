package firstboot

import (
	"context"
	"fmt"
	"strings"
)

const (
	machineIDPath  = "/etc/machine-id"
	hostKeyPubPath = "/etc/ssh/ssh_host_ed25519_key.pub"
)

// EnsureIdentity gives this VM its own identity: SSH host keys (the template
// image ships none) and a machine-id if the template's was cleared. It returns
// the SHA256 fingerprint of the ed25519 host key for the admin to verify.
func EnsureIdentity(ctx context.Context, h Host) (string, error) {
	if out, err := h.Run(ctx, []byte{}, "ssh-keygen", "-A"); err != nil {
		return "", fmt.Errorf("ssh-keygen -A: %w: %s", err, strings.TrimSpace(string(out)))
	}
	if id, err := h.ReadFile(machineIDPath); err != nil || strings.TrimSpace(string(id)) == "" {
		if out, err := h.Run(ctx, []byte{}, "systemd-machine-id-setup"); err != nil {
			return "", fmt.Errorf("systemd-machine-id-setup: %w: %s", err, strings.TrimSpace(string(out)))
		}
	}
	out, err := h.Run(ctx, []byte{}, "ssh-keygen", "-lf", hostKeyPubPath)
	if err != nil {
		return "", fmt.Errorf("ssh-keygen -lf: %w: %s", err, strings.TrimSpace(string(out)))
	}
	for _, f := range strings.Fields(string(out)) {
		if strings.HasPrefix(f, "SHA256:") {
			return f, nil
		}
	}
	return "", fmt.Errorf("no SHA256 fingerprint in ssh-keygen output: %q", strings.TrimSpace(string(out)))
}
