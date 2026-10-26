package firstboot

import (
	"context"
	"fmt"
	"strings"
	"time"
)

// Handoff is what the admin needs to reach the appliance.
type Handoff struct{ User, IP, Hostname, Fingerprint string }

// HandoffText is the final screen of first boot.
func HandoffText(h Handoff) string {
	return fmt.Sprintf(`First boot is complete.

Connect from your workstation:

    ssh %[1]s@%[2]s

Host key fingerprint (check it matches on first connect):

    %[4]s

After you log in, a menu offers to install ProjectAchilles or restore from a backup.

Or log in here as %[1]s.
`, h.User, h.IP, h.Hostname, h.Fingerprint)
}

const sshdConf = `# Managed by ProjectAchilles first boot.
PasswordAuthentication yes
KbdInteractiveAuthentication no
`

// Complete enables SSH and the tty1 getty, disables the first-boot unit, then
// writes the first-boot marker. It does not start the getty: starting it hangs
// up tty1, so Run starts it after the handoff screen has been read.
//
// The unit must be disabled, not just skipped by its ConditionPathExists: on
// every boot an enabled unit puts start(achilles-firstboot) and
// start(getty@tty1) in one transaction, and because of Conflicts= systemd
// drops the getty, leaving tty1 blank once the condition skips first boot.
// The condition stays as a backstop.
//
// Order matters: the marker comes last, so a crash (or failure) before it
// makes first boot run again on the next boot. Callers must set the password
// first.
func Complete(ctx context.Context, h Host, version string) error {
	if err := h.WriteFile(SSHDConfPath, []byte(sshdConf), 0o644); err != nil {
		return fmt.Errorf("write %s: %w", SSHDConfPath, err)
	}
	for _, args := range [][]string{
		{"enable", "--now", "ssh.socket"},
		{"enable", "getty@tty1.service"},
		{"disable", FirstbootUnit},
	} {
		if out, err := h.Run(ctx, []byte{}, "systemctl", args...); err != nil {
			return fmt.Errorf("systemctl %s: %w: %s", strings.Join(args, " "), err, strings.TrimSpace(string(out)))
		}
	}
	marker := fmt.Sprintf("version=%s\ncompleted=%s\n", version, time.Now().UTC().Format(time.RFC3339))
	if err := h.WriteFile(MarkerPath, []byte(marker), 0o644); err != nil {
		return fmt.Errorf("write %s: %w", MarkerPath, err)
	}
	return nil
}
