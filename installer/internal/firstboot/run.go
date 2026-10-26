package firstboot

import (
	"context"
	"errors"
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

const (
	noNICNotice  = "No network adapter found. Add one to this VM in Hyper-V and restart it."
	noDHCPNotice = "DHCP didn't give this server an address. Set a static address, or check the network and choose DHCP again."
)

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
		msg := err.Error()
		if errors.Is(err, ErrNoNIC) {
			msg = noNICNotice
		}
		// Shown before systemd restarts us, so the admin knows what to fix.
		_ = ui.Notice(ctx, msg)
		return err
	}

	var prev *NetConfig
	var nc NetConfig
	var ip string
	for {
		if nc, err = chooseNetwork(ctx, h, ui, det, prev); err != nil {
			return err
		}
		if !nc.DHCP {
			ip = strings.SplitN(nc.Address, "/", 2)[0]
			break
		}
		if ip, err = dhcpAddress(ctx, h, ifaces); err != nil {
			return err
		}
		if ip == "" {
			ip = det.IP // fallback: the pre-apply address
		}
		if ip != "" {
			break
		}
		// No lease, before or after: an empty address on the handoff screen
		// would leave the admin with nothing to connect to.
		if err := ui.Notice(ctx, noDHCPNotice); err != nil {
			return err
		}
		cfg := nc
		prev = &cfg
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

// chooseNetwork asks for a network config until one validates, applies and is
// confirmed by the admin. prev pre-fills the first form.
func chooseNetwork(ctx context.Context, h Host, ui UI, det Detected, prev *NetConfig) (NetConfig, error) {
	for {
		nc, err := ui.Network(ctx, det, prev)
		if err != nil {
			return NetConfig{}, err
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
				return NetConfig{}, err
			}
			continue
		}
		revert, aerr := ApplyNetwork(ctx, h, nc)
		if aerr != nil {
			if err := reask(aerr); err != nil {
				return NetConfig{}, err
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
			return NetConfig{}, undo(err)
		}
		ok, err := ui.ConfirmNetwork(ctx, nc, ConfirmTimeout)
		if err != nil {
			return NetConfig{}, undo(err)
		}
		if ok {
			return nc, nil
		}
		if err := undo(nil); err != nil {
			return NetConfig{}, err
		}
		cfg := nc
		prev = &cfg
	}
}

// dhcpAddress waits briefly for the DHCP lease to show up after apply and
// returns its address, or "" if none appeared.
func dhcpAddress(ctx context.Context, h Host, ifaces func() []sysprobe.Iface) (string, error) {
	for i := 0; i < redetectAttempts; i++ {
		if d, err := DetectNetwork(ctx, h, ifaces); err == nil && d.IP != "" {
			return d.IP, nil
		}
		select {
		case <-ctx.Done():
			return "", ctx.Err()
		case <-time.After(redetectPause):
		}
	}
	return "", nil
}
