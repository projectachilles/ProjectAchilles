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
}

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
		if err := ValidateNetConfig(nc); err != nil {
			return err
		}
		revert, err := ApplyNetwork(ctx, h, nc)
		if err != nil {
			return err
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
		d, err := DetectNetwork(ctx, h, ifaces)
		if err != nil {
			return err
		}
		ip = d.IP
	}

	fp, err := EnsureIdentity(ctx, h)
	if err != nil {
		return err
	}
	if err := Complete(ctx, h, version); err != nil {
		return err
	}
	return ui.Handoff(ctx, Handoff{User: AdminUser, IP: ip, Hostname: nc.Hostname, Fingerprint: fp})
}
