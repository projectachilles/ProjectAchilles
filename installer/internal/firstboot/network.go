package firstboot

import (
	"context"
	"errors"
	"fmt"
	"net/netip"
	"regexp"
	"strings"

	"github.com/projectachilles/ProjectAchilles/installer/internal/sysprobe"
)

const hostsPath = "/etc/hosts"

// Detected is the network the VM came up with.
type Detected struct{ Iface, IP, CIDR, Gateway string } // CIDR like "10.0.5.20/24"

// NetConfig is what the operator chose for the appliance's network.
type NetConfig struct {
	Iface    string
	DHCP     bool
	Address  string   // CIDR, static only
	Gateway  string   // static only
	DNS      []string // 1-3 IPv4, static only
	Search   string   // optional
	Hostname string
}

// ErrNoNIC means the VM has no network adapter at all.
var ErrNoNIC = errors.New("no network adapter found")

// DetectNetwork finds the default-route interface and its current IPv4/CIDR.
// Without a usable default route (no DHCP server, or the route's interface
// has no IPv4 address) it returns the first physical NIC with empty
// IP/CIDR/Gateway, so the admin can still set a static address. Only a VM
// without any NIC is an error (ErrNoNIC).
func DetectNetwork(ctx context.Context, h Host, ifaces func() []sysprobe.Iface) (Detected, error) {
	out, err := h.Run(ctx, []byte{}, "ip", "-4", "route", "show", "default")
	if err != nil {
		return Detected{}, fmt.Errorf("ip route: %w", err)
	}
	gw, dev := parseDefaultRoute(string(out))
	if dev != "" {
		for _, i := range ifaces() {
			if i.Name == dev {
				return Detected{Iface: i.Name, IP: i.IP, CIDR: i.CIDR, Gateway: gw}, nil
			}
		}
	}
	out, err = h.Run(ctx, []byte{}, "ip", "-o", "link", "show")
	if err != nil {
		return Detected{}, fmt.Errorf("ip link: %w: %s", err, strings.TrimSpace(string(out)))
	}
	nics := physicalNICs(string(out))
	if len(nics) == 0 {
		return Detected{}, ErrNoNIC
	}
	return Detected{Iface: nics[0]}, nil
}

// physicalNICs lists the Ethernet NICs in `ip -o link show` output, in order:
// not loopback, not a stacked link (vlan, veth peer, sit0@NONE: "name@parent"),
// not a virtual name, and with an Ethernet link type.
func physicalNICs(out string) []string {
	var nics []string
	for _, line := range strings.Split(out, "\n") {
		f := strings.Fields(line)
		if len(f) < 2 || !strings.HasSuffix(f[1], ":") || !strings.Contains(line, "link/ether ") {
			continue
		}
		name := strings.TrimSuffix(f[1], ":")
		if name == "lo" || strings.Contains(name, "@") || sysprobe.IsVirtualIface(name) {
			continue
		}
		nics = append(nics, name)
	}
	return nics
}

// parseDefaultRoute extracts the gateway and device from `ip -4 route show
// default` output, using the first default route.
func parseDefaultRoute(out string) (gw, dev string) {
	for _, line := range strings.Split(out, "\n") {
		f := strings.Fields(line)
		if len(f) == 0 || f[0] != "default" {
			continue
		}
		for i := 1; i+1 < len(f); i++ {
			switch f[i] {
			case "via":
				gw = f[i+1]
			case "dev":
				dev = f[i+1]
			}
		}
		return gw, dev
	}
	return "", ""
}

var hostnameRe = regexp.MustCompile(`^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$`)
var searchRe = regexp.MustCompile(`^[A-Za-z0-9]([A-Za-z0-9.-]*[A-Za-z0-9])?$`)

func parseIPv4(s string) (netip.Addr, error) {
	a, err := netip.ParseAddr(s)
	if err != nil || !a.Is4() {
		return netip.Addr{}, fmt.Errorf("%q is not an IPv4 address", s)
	}
	return a, nil
}

// ValidateNetConfig checks a config before it is written anywhere.
func ValidateNetConfig(nc NetConfig) error {
	if nc.Iface == "" {
		return fmt.Errorf("network interface is required")
	}
	if !hostnameRe.MatchString(nc.Hostname) {
		return fmt.Errorf("hostname must be 1-63 characters: lowercase letters, digits and hyphens, not starting or ending with a hyphen")
	}
	if nc.DHCP {
		return nil
	}
	pfx, err := netip.ParsePrefix(nc.Address)
	if err != nil || !pfx.Addr().Is4() {
		return fmt.Errorf("address must be IPv4 in CIDR form, like 10.0.5.20/24")
	}
	if pfx.Bits() < 8 || pfx.Bits() > 30 {
		return fmt.Errorf("prefix length must be between /8 and /30")
	}
	gw, err := parseIPv4(nc.Gateway)
	if err != nil {
		return fmt.Errorf("gateway: %w", err)
	}
	if !pfx.Masked().Contains(gw) {
		return fmt.Errorf("gateway %s is not in subnet %s", nc.Gateway, pfx.Masked())
	}
	if n := len(nc.DNS); n < 1 || n > 3 {
		return fmt.Errorf("provide 1 to 3 DNS servers")
	}
	for _, d := range nc.DNS {
		if _, err := parseIPv4(d); err != nil {
			return fmt.Errorf("DNS server: %w", err)
		}
	}
	if nc.Search != "" && !searchRe.MatchString(nc.Search) {
		return fmt.Errorf("search domain %q is not valid", nc.Search)
	}
	return nil
}

// RenderNetplan renders the netplan file for nc. The caller validates first.
func RenderNetplan(nc NetConfig) []byte {
	var b strings.Builder
	b.WriteString("network:\n  version: 2\n  ethernets:\n")
	fmt.Fprintf(&b, "    %s:\n", nc.Iface)
	if nc.DHCP {
		b.WriteString("      dhcp4: true\n")
		return []byte(b.String())
	}
	b.WriteString("      dhcp4: false\n")
	fmt.Fprintf(&b, "      addresses:\n        - %s\n", nc.Address)
	fmt.Fprintf(&b, "      routes:\n        - to: default\n          via: %s\n", nc.Gateway)
	b.WriteString("      nameservers:\n        addresses:\n")
	for _, d := range nc.DNS {
		fmt.Fprintf(&b, "          - %s\n", d)
	}
	if nc.Search != "" {
		fmt.Fprintf(&b, "        search:\n          - %s\n", nc.Search)
	}
	return []byte(b.String())
}

// ApplyNetwork writes the netplan file and applies it. The returned revert
// restores the previous file (or removes ours if there was none) and applies
// again. If the apply itself fails, the previous state is restored before
// returning the error.
func ApplyNetwork(ctx context.Context, h Host, nc NetConfig) (func(context.Context) error, error) {
	prev, readErr := h.ReadFile(NetplanPath)
	hadPrev := readErr == nil
	revert := func(ctx context.Context) error {
		if hadPrev {
			if err := h.WriteFile(NetplanPath, prev, 0o600); err != nil {
				return fmt.Errorf("restore %s: %w", NetplanPath, err)
			}
		} else if _, err := h.Run(ctx, []byte{}, "rm", "-f", NetplanPath); err != nil {
			return fmt.Errorf("remove %s: %w", NetplanPath, err)
		}
		if out, err := h.Run(ctx, []byte{}, "netplan", "apply"); err != nil {
			return fmt.Errorf("netplan apply: %w: %s", err, strings.TrimSpace(string(out)))
		}
		return nil
	}
	if err := h.WriteFile(NetplanPath, RenderNetplan(nc), 0o600); err != nil {
		return nil, fmt.Errorf("write %s: %w", NetplanPath, err)
	}
	if out, err := h.Run(ctx, []byte{}, "netplan", "apply"); err != nil {
		rerr := revert(context.WithoutCancel(ctx))
		msg := fmt.Sprintf("netplan apply: %v: %s", err, strings.TrimSpace(string(out)))
		if rerr != nil {
			return nil, fmt.Errorf("%s (revert also failed: %v)", msg, rerr)
		}
		return nil, fmt.Errorf("%s", msg)
	}
	return revert, nil
}

// SetHostname sets the hostname and keeps exactly one 127.0.1.1 line in
// /etc/hosts so the machine resolves its own name.
func SetHostname(ctx context.Context, h Host, name string) error {
	if !hostnameRe.MatchString(name) {
		return fmt.Errorf("invalid hostname %q", name)
	}
	if out, err := h.Run(ctx, []byte{}, "hostnamectl", "set-hostname", name); err != nil {
		return fmt.Errorf("hostnamectl: %w: %s", err, strings.TrimSpace(string(out)))
	}
	existing, err := h.ReadFile(hostsPath)
	if err != nil {
		existing = nil
	}
	var kept []string
	for _, line := range strings.Split(string(existing), "\n") {
		if f := strings.Fields(line); len(f) > 0 && f[0] == "127.0.1.1" {
			continue
		}
		kept = append(kept, line)
	}
	text := strings.TrimRight(strings.Join(kept, "\n"), "\n")
	if text != "" {
		text += "\n"
	}
	text += "127.0.1.1 " + name + "\n"
	return h.WriteFile(hostsPath, []byte(text), 0o644)
}
