package sysprobe

import (
	"bufio"
	"io"
	"net"
	"net/netip"
	"os"
	"sort"
	"strconv"
	"strings"
)

// Iface is one LAN-bindable IPv4 address.
type Iface struct {
	Name, IP, CIDR string
	Default        bool
}

// Public reports whether the address is a public IPv4 address: a cloud
// server's own address rather than one on a LAN.
func (i Iface) Public() bool { return IsPublicIPv4(i.IP) }

// cgnat is the carrier-grade NAT range (RFC 6598): not private by RFC 1918,
// but not reachable from the internet either.
var cgnat = netip.MustParsePrefix("100.64.0.0/10")

// IsPublicIPv4 reports whether ip is a globally routable IPv4 address.
func IsPublicIPv4(ip string) bool {
	a, err := netip.ParseAddr(ip)
	if err != nil || !a.Is4() {
		return false
	}
	return a.IsGlobalUnicast() && !a.IsPrivate() && !cgnat.Contains(a)
}

var virtualPrefixes = []string{
	"docker", "br-", "veth", "virbr", "tailscale", "tun", "wg", "zt", "cni", "flannel", "cali", "vxlan",
}

// IsVirtualIface reports whether name is a container, bridge, VPN or tunnel
// interface rather than a NIC.
func IsVirtualIface(name string) bool {
	for _, p := range virtualPrefixes {
		if strings.HasPrefix(name, p) {
			return true
		}
	}
	return false
}

// LANInterfaces lists candidate IPv4 addresses, default-route interface
// first, then by name, public before private, then by IP.
func LANInterfaces(list func() ([]net.Interface, error), addrs func(net.Interface) ([]net.Addr, error), defaultIface string) []Iface {
	ifs, err := list()
	if err != nil {
		return nil
	}
	out := []Iface{}
	for _, ifc := range ifs {
		if ifc.Flags&net.FlagLoopback != 0 || ifc.Flags&net.FlagUp == 0 || IsVirtualIface(ifc.Name) {
			continue
		}
		as, err := addrs(ifc)
		if err != nil {
			continue
		}
		for _, a := range as {
			ipn, ok := a.(*net.IPNet)
			if !ok {
				continue
			}
			ip4 := ipn.IP.To4()
			if ip4 == nil {
				continue
			}
			network := &net.IPNet{IP: ip4.Mask(ipn.Mask), Mask: ipn.Mask}
			out = append(out, Iface{
				Name:    ifc.Name,
				IP:      ip4.String(),
				CIDR:    network.String(),
				Default: ifc.Name == defaultIface,
			})
		}
	}
	sort.SliceStable(out, func(i, j int) bool {
		if out[i].Default != out[j].Default {
			return out[i].Default
		}
		if out[i].Name != out[j].Name {
			return out[i].Name < out[j].Name
		}
		// A cloud server's interface can also carry a private address (a
		// DigitalOcean anchor IP): the public one comes first.
		if out[i].Public() != out[j].Public() {
			return out[i].Public()
		}
		return out[i].IP < out[j].IP
	})
	return out
}

// SystemLANInterfaces is LANInterfaces over the real host.
func SystemLANInterfaces() []Iface {
	return LANInterfaces(net.Interfaces, func(i net.Interface) ([]net.Addr, error) { return i.Addrs() }, DefaultRouteIface())
}

// ParseDefaultRoute returns the interface of the default route (destination
// 00000000) with the lowest metric from /proc/net/route content, or "".
func ParseDefaultRoute(r io.Reader) string {
	best, bestMetric := "", -1
	sc := bufio.NewScanner(r)
	sc.Scan() // header
	for sc.Scan() {
		f := strings.Fields(sc.Text())
		if len(f) < 7 || f[1] != "00000000" {
			continue
		}
		m, err := strconv.Atoi(f[6])
		if err != nil {
			continue
		}
		if bestMetric < 0 || m < bestMetric {
			best, bestMetric = f[0], m
		}
	}
	return best
}

// DefaultRouteIface reads /proc/net/route; "" if unavailable.
func DefaultRouteIface() string {
	f, err := os.Open("/proc/net/route")
	if err != nil {
		return ""
	}
	defer f.Close()
	return ParseDefaultRoute(f)
}
