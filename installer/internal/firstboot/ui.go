package firstboot

import (
	"context"
	"errors"
	"fmt"
	"os"
	"strings"
	"time"

	"charm.land/huh/v2"
)

const baseLstPath = "/usr/share/X11/xkb/rules/base.lst"

const dhcpWarning = "Ask your network team for a DHCP reservation: ProjectAchilles is tied to this address, and a new address needs the installer re-run."

// FormUI is the real console UI, built from huh forms.
type FormUI struct{}

func (FormUI) run(ctx context.Context, groups ...*huh.Group) error {
	return huh.NewForm(groups...).WithTheme(huh.ThemeFunc(huh.ThemeBase16)).RunWithContext(ctx)
}

const otherLayout = "other"

// Layout asks for the console keyboard layout.
func (u FormUI) Layout(ctx context.Context) (Layout, error) {
	opts := make([]huh.Option[string], 0, len(Layouts)+1)
	for _, l := range Layouts {
		opts = append(opts, huh.NewOption(l.Label, l.ID))
	}
	opts = append(opts, huh.NewOption("Other (type an XKB code)", otherLayout))
	choice := Layouts[0].ID
	if err := u.run(ctx, huh.NewGroup(huh.NewSelect[string]().
		Title("Keyboard layout").
		Description("Pick this first: the wrong layout makes the password hard to type.").
		Options(opts...).Value(&choice))); err != nil {
		return Layout{}, err
	}
	if choice != otherLayout {
		for _, l := range Layouts {
			if l.ID == choice {
				return l, nil
			}
		}
	}
	base, _ := os.ReadFile(baseLstPath)
	var code string
	if err := u.run(ctx, huh.NewGroup(huh.NewInput().
		Title("XKB layout code").Description("For example: pt, it, br, se.").
		Value(&code).
		Validate(func(s string) error {
			s = strings.TrimSpace(s)
			if !SafeXKBCode(s) || !KnownXKBLayout(base, s) {
				return errors.New("Unknown layout code.")
			}
			return nil
		}))); err != nil {
		return Layout{}, err
	}
	code = strings.TrimSpace(code)
	return Layout{ID: code, Label: code, XKBLayout: code}, nil
}

// Password asks twice and loops until ValidatePassword accepts.
func (u FormUI) Password(ctx context.Context) (string, error) {
	var pw, confirm string
	if err := u.run(ctx, huh.NewGroup(
		huh.NewInput().Title("Password for "+AdminUser).
			Description("At least 12 characters; must not contain \""+AdminUser+"\".").
			EchoMode(huh.EchoModePassword).Value(&pw),
		huh.NewInput().Title("Repeat the password").
			EchoMode(huh.EchoModePassword).Value(&confirm).
			Validate(func(c string) error { return ValidatePassword(pw, c) }),
	)); err != nil {
		return "", err
	}
	return pw, nil
}

// Network asks DHCP or static and, for static, the address details.
func (u FormUI) Network(ctx context.Context, d Detected, prev *NetConfig) (NetConfig, error) {
	nc := NetConfig{Iface: d.Iface, DHCP: true, Hostname: "achilles"}
	addr, gw, dns, search := d.CIDR, d.Gateway, "", ""
	if prev != nil {
		nc.Hostname = prev.Hostname
		nc.DHCP = prev.DHCP
		if !prev.DHCP {
			addr, gw, dns, search = prev.Address, prev.Gateway, strings.Join(prev.DNS, ", "), prev.Search
		}
	}
	mode := "dhcp"
	if !nc.DHCP {
		mode = "static"
	}
	if err := u.run(ctx, huh.NewGroup(
		huh.NewSelect[string]().Title("Network").
			Description(dhcpWarning).
			Options(huh.NewOption("Keep DHCP", "dhcp"), huh.NewOption("Set a static address", "static")).
			Value(&mode),
		huh.NewInput().Title("Hostname").Value(&nc.Hostname).Validate(func(s string) error {
			return ValidateNetConfig(NetConfig{Iface: d.Iface, DHCP: true, Hostname: s})
		}),
	)); err != nil {
		return NetConfig{}, err
	}
	if mode == "dhcp" {
		return nc, nil
	}
	nc.DHCP = false
	if err := u.run(ctx, huh.NewGroup(
		huh.NewInput().Title("Address (CIDR)").Placeholder("10.0.5.20/24").Value(&addr),
		huh.NewInput().Title("Gateway").Value(&gw),
		huh.NewInput().Title("DNS servers (comma separated, 1-3)").Value(&dns),
		huh.NewInput().Title("Search domain (optional)").Value(&search).
			Validate(func(string) error {
				cand := NetConfig{Iface: d.Iface, Address: addr, Gateway: gw, DNS: splitList(dns), Search: strings.TrimSpace(search), Hostname: nc.Hostname}
				return ValidateNetConfig(cand)
			}),
	)); err != nil {
		return NetConfig{}, err
	}
	nc.Address, nc.Gateway, nc.DNS, nc.Search = addr, gw, splitList(dns), strings.TrimSpace(search)
	return nc, nil
}

func splitList(s string) []string {
	var out []string
	for _, p := range strings.FieldsFunc(s, func(r rune) bool { return r == ',' || r == ' ' }) {
		out = append(out, p)
	}
	return out
}

// ConfirmNetwork asks whether the new network works; no answer in timeout
// means false.
func (u FormUI) ConfirmNetwork(ctx context.Context, nc NetConfig, timeout time.Duration) (bool, error) {
	what := "DHCP"
	if !nc.DHCP {
		what = nc.Address
	}
	ok := false
	cctx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()
	err := u.run(cctx, huh.NewGroup(huh.NewConfirm().
		Title("Can you keep these settings? Reverting in 60 s if there's no answer.").
		Description(fmt.Sprintf("Network: %s on %s, hostname %s", what, nc.Iface, nc.Hostname)).
		Affirmative("Keep").Negative("Revert").Value(&ok)))
	if err != nil {
		// Our own deadline is "no answer"; a cancelled parent is a real abort.
		if ctx.Err() == nil && (errors.Is(err, context.DeadlineExceeded) || errors.Is(err, huh.ErrTimeout)) {
			return false, nil
		}
		return false, err
	}
	return ok, nil
}

// Handoff shows the connection details until the admin presses Enter.
func (u FormUI) Handoff(ctx context.Context, h Handoff) error {
	return u.run(ctx, huh.NewGroup(huh.NewNote().Title("Ready").Description(HandoffText(h)).Next(true).NextLabel("Continue")))
}

// Notice shows msg until the admin presses Enter.
func (u FormUI) Notice(ctx context.Context, msg string) error {
	return u.run(ctx, huh.NewGroup(huh.NewNote().Title("That didn't work").Description(msg).Next(true).NextLabel("OK")))
}
