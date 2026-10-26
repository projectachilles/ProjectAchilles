package firstboot

import (
	"strings"
	"testing"
)

func TestNetworkFormDefaultsWithDHCPAddress(t *testing.T) {
	f := networkFormDefaults(Detected{Iface: "eth0", IP: "10.0.5.20", CIDR: "10.0.5.20/24", Gateway: "10.0.5.1"}, nil)
	if f.mode != "dhcp" || f.hostname != "achilles" || f.addr != "10.0.5.20/24" || f.gw != "10.0.5.1" {
		t.Fatalf("got %+v", f)
	}
	if f.desc != dhcpWarning {
		t.Fatalf("desc = %q", f.desc)
	}
}

func TestNetworkFormDefaultsWithoutDHCPAddress(t *testing.T) {
	f := networkFormDefaults(Detected{Iface: "eth0"}, nil)
	if f.mode != "static" || f.addr != "" || f.gw != "" || f.dns != "" || f.search != "" || f.hostname != "achilles" {
		t.Fatalf("got %+v", f)
	}
	if !strings.HasPrefix(f.desc, "No address from DHCP on eth0. Set a static address.") {
		t.Fatalf("desc = %q", f.desc)
	}
	// After DHCP failed to give an address, the re-ask still defaults to static.
	f = networkFormDefaults(Detected{Iface: "eth0"}, &NetConfig{Iface: "eth0", DHCP: true, Hostname: "lab-1"})
	if f.mode != "static" || f.hostname != "lab-1" || f.addr != "" {
		t.Fatalf("after DHCP: got %+v", f)
	}
	// A rejected static config pre-fills the fields.
	f = networkFormDefaults(Detected{Iface: "eth0"}, &NetConfig{Iface: "eth0", Address: "10.0.5.50/24", Gateway: "10.0.5.1", DNS: []string{"10.0.5.2", "10.0.5.3"}, Search: "corp", Hostname: "lab-1"})
	if f.mode != "static" || f.addr != "10.0.5.50/24" || f.gw != "10.0.5.1" || f.dns != "10.0.5.2, 10.0.5.3" || f.search != "corp" {
		t.Fatalf("prev static: got %+v", f)
	}
}
