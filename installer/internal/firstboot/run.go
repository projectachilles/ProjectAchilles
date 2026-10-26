package firstboot

import (
	"context"
	"fmt"
	"strings"
	"time"

	"github.com/projectachilles/ProjectAchilles/installer/internal/sysprobe"
)

// ConfirmTimeout is how long the admin has to confirm a new network config
// before it is reverted.
const ConfirmTimeout = 60 * time.Second

// UI is the first-boot console. Any error (including Ctrl+C) aborts Run.
type UI interface {
	Layout(ctx context.Context) (Layout, error)
	// Password returns a password that already passed ValidatePassword.
	Password(ctx context.Context) (string, error)
	// Network asks for the network config; prev is the last rejected config,
	// used to pre-fill the form.
	Network(ctx context.Context, d Detected, prev *NetConfig) (NetConfig, error)
	// ConfirmNetwork asks whether the admin can keep nc; false on timeout.
	ConfirmNetwork(ctx context.Context, nc NetConfig, timeout time.Duration) (bool, error)
	Handoff(ctx context.Context, h Handoff) error
	// Notice shows msg (an error the admin must read) and waits for OK.
	Notice(ctx context.Context, msg string) error
}

// After a confirmed DHCP config the lease can take a moment to show up.
var redetectPause = time.Second

const redetectAttempts = 5

// Run drives first boot. It is safe to run again after a crash or Ctrl+C:
// every step is idempotent and the marker is written only at the end.
func Run(ctx context.Context, h Host, ui UI, ifaces func() []sysprobe.Iface, version string) error {
	layout, err := ui.Layout(ctx)
	if err != nil {
		return err
	}
	if err := ApplyKeyboard(ctx, h, layout); err != nil {
		return err
	}
	pw, err := ui.Password(ctx)
	if err != nil {
		return err
	}
	if err := ValidatePassword(pw, pw); err != nil {
		return err
	}
	if err := SetPassword(ctx, h, AdminUser, pw); err != nil {
		return err
	}
	det, err := DetectNetwork(ctx, h, ifaces)
	if err != nil {
		return err
	}

	var prev *NetConfig
	var nc NetConfig
	for {
		nc, err = ui.Network(ctx, det, prev)
		if err != nil {
			return err
		}
		// A config that is invalid or won't apply is shown to the admin and
		// asked again; returning would restart first boot with no feedback.
		reask := func(cause error) error {
			if ctx.Err() != nil {
				return ctx.Err()
			}
			cfg := nc
			prev = &cfg
			return ui.Notice(ctx, cause.Error())
		}
		if verr := ValidateNetConfig(nc); verr != nil {
			if err := reask(verr); err != nil {
				return err
			}
			continue
		}
		revert, aerr := ApplyNetwork(ctx, h, nc)
		if aerr != nil {
			if err := reask(aerr); err != nil {
				return err
			}
			continue
		}
		// Past this point the network may be broken: always restore it if we
		// leave without a confirmation, even when ctx is already cancelled.
		undo := func(cause error) error {
			if rerr := revert(context.WithoutCancel(ctx)); rerr != nil {
				return fmt.Errorf("%w (revert failed: %v)", cause, rerr)
			}
			return cause
		}
		if err := SetHostname(ctx, h, nc.Hostname); err != nil {
			return undo(err)
		}
		ok, err := ui.ConfirmNetwork(ctx, nc, ConfirmTimeout)
		if err != nil {
			return undo(err)
		}
		if ok {
			break
		}
		if err := undo(nil); err != nil {
			return err
		}
		cfg := nc
		prev = &cfg
	}

	ip := strings.SplitN(nc.Address, "/", 2)[0]
	if nc.DHCP {
		ip = det.IP // fallback: the pre-apply address
		for i := 0; i < redetectAttempts; i++ {
			if d, derr := DetectNetwork(ctx, h, ifaces); derr == nil {
				ip = d.IP
				break
			}
			select {
			case <-ctx.Done():
				return ctx.Err()
			case <-time.After(redetectPause):
			}
		}
	}

	fp, err := EnsureIdentity(ctx, h)
	if err != nil {
		return err
	}
	if err := Complete(ctx, h, version); err != nil {
		return err
	}
	// First boot is done: whatever happens on the handoff screen (including
	// Ctrl+C) is not a failure. Starting the getty hangs up tty1, so it comes
	// after the admin has read the screen, and is best effort: it is enabled
	// and starts on the next boot anyway.
	_ = ui.Handoff(ctx, Handoff{User: AdminUser, IP: ip, Hostname: nc.Hostname, Fingerprint: fp})
	_, _ = h.Run(context.WithoutCancel(ctx), []byte{}, "systemctl", "--no-block", "start", "getty@tty1.service")
	return nil
}
