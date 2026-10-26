package firstboot

import (
	"context"
	"errors"
	"fmt"
	"io"
	"os/exec"
	"strings"
	"time"

	"charm.land/huh/v2"

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
	ConfirmNetwork(ctx context.Context, nc NetConfig, check NetCheck, timeout time.Duration) (bool, error)
	Handoff(ctx context.Context, h Handoff) error
	// Notice shows msg (an error the admin must read) and waits for OK.
	Notice(ctx context.Context, msg string) error
}

// NetCheck is what first boot found out about a just-applied config.
type NetCheck struct {
	Address   string // the appliance's IPv4 address; "" if unknown
	Gateway   string // "" when there was no gateway to check
	GatewayOK bool   // the gateway answered a ping
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
//
// A failing step makes Run return an error, and systemd restarts first boot
// from the beginning; unless the admin aborted (or we are being stopped), the
// error is shown first so the admin knows why the screen reset.
func Run(ctx context.Context, h Host, ui UI, ifaces func() []sysprobe.Iface, version string) error {
	err := run(ctx, h, ui, ifaces, version)
	var sh shownError
	if err == nil || aborted(err) || ctx.Err() != nil || errors.As(err, &sh) {
		return err
	}
	_ = ui.Notice(ctx, fmt.Sprintf("First boot failed: %s. It will start again from the beginning.", strings.TrimRight(err.Error(), ".")))
	return err
}

// aborted reports a Ctrl+C or a closed console: the admin's choice, not a
// failure to explain.
func aborted(err error) bool {
	return errors.Is(err, huh.ErrUserAborted) || errors.Is(err, io.EOF)
}

// shownError is an error whose own notice the admin has already seen.
type shownError struct{ error }

func (e shownError) Unwrap() error { return e.error }

func run(ctx context.Context, h Host, ui UI, ifaces func() []sysprobe.Iface, version string) error {
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
		return shownError{err}
	}

	var prev *NetConfig
	var nc NetConfig
	var ip string
	for {
		if nc, ip, err = chooseNetwork(ctx, h, ui, ifaces, det, prev); err != nil {
			return err
		}
		if ip == "" {
			ip = det.IP // DHCP fallback: the pre-apply address
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
// confirmed by the admin. prev pre-fills the first form. It returns the
// confirmed config and the appliance's address under it ("" when DHCP gave
// none).
func chooseNetwork(ctx context.Context, h Host, ui UI, ifaces func() []sysprobe.Iface, det Detected, prev *NetConfig) (NetConfig, string, error) {
	for {
		nc, err := ui.Network(ctx, det, prev)
		if err != nil {
			return NetConfig{}, "", err
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
				return NetConfig{}, "", err
			}
			continue
		}
		revert, aerr := ApplyNetwork(ctx, h, nc)
		if aerr != nil {
			if err := reask(aerr); err != nil {
				return NetConfig{}, "", err
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
			return NetConfig{}, "", undo(err)
		}
		check := NetCheck{}
		if nc.DHCP {
			lease, err := dhcpLease(ctx, h, ifaces)
			if err != nil {
				return NetConfig{}, "", undo(err)
			}
			check.Address, check.Gateway = lease.IP, lease.Gateway
		} else {
			check.Address, check.Gateway = strings.SplitN(nc.Address, "/", 2)[0], nc.Gateway
		}
		if check.Gateway != "" {
			check.GatewayOK, err = pingGateway(ctx, h, check.Gateway)
			if err != nil {
				check.Gateway = "" // no ping binary: nothing to report
			}
		}
		ok, err := ui.ConfirmNetwork(ctx, nc, check, ConfirmTimeout)
		if err != nil {
			return NetConfig{}, "", undo(err)
		}
		if ok {
			return nc, check.Address, nil
		}
		if err := undo(nil); err != nil {
			return NetConfig{}, "", err
		}
		cfg := nc
		prev = &cfg
	}
}

// pingGateway reports whether gw answers one ping. The answer is information
// for the admin, never a failure; the error is only for a missing ping
// binary, when no check was made.
func pingGateway(ctx context.Context, h Host, gw string) (bool, error) {
	_, err := h.Run(ctx, []byte{}, "ping", "-c1", "-W2", gw)
	if errors.Is(err, exec.ErrNotFound) {
		return false, err
	}
	return err == nil, nil
}

// dhcpLease waits briefly for the DHCP lease to show up after apply and
// returns it, or an empty Detected if none appeared.
func dhcpLease(ctx context.Context, h Host, ifaces func() []sysprobe.Iface) (Detected, error) {
	for i := 0; i < redetectAttempts; i++ {
		if d, err := DetectNetwork(ctx, h, ifaces); err == nil && d.IP != "" {
			return d, nil
		}
		select {
		case <-ctx.Done():
			return Detected{}, ctx.Err()
		case <-time.After(redetectPause):
		}
	}
	return Detected{}, nil
}
