package firstboot

import (
	"strings"
	"testing"
	"time"
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

func TestConfirmText(t *testing.T) {
	static := NetConfig{Iface: "eth0", Address: "10.0.5.50/24", Gateway: "10.0.5.1", Hostname: "achilles"}
	title, desc := confirmText(static, NetCheck{Address: "10.0.5.50", Gateway: "10.0.5.1", GatewayOK: true}, 90*time.Second)
	if !strings.Contains(title, "90 s") || strings.Contains(title, "60 s") {
		t.Fatalf("title = %q", title)
	}
	for _, want := range []string{"10.0.5.50/24 on eth0", "hostname achilles", "Gateway 10.0.5.1 answers.", "From your workstation you can also run ping 10.0.5.50."} {
		if !strings.Contains(desc, want) {
			t.Errorf("desc lacks %q:\n%s", want, desc)
		}
	}
	_, desc = confirmText(static, NetCheck{Address: "10.0.5.50", Gateway: "10.0.5.1"}, ConfirmTimeout)
	if !strings.Contains(desc, "Gateway 10.0.5.1 does not answer — this configuration probably won't work.") {
		t.Errorf("failed check: %s", desc)
	}
	_, desc = confirmText(NetConfig{Iface: "eth0", DHCP: true, Hostname: "achilles"}, NetCheck{}, ConfirmTimeout)
	if strings.Contains(desc, "Gateway") || strings.Contains(desc, "ping") || !strings.Contains(desc, "DHCP on eth0") {
		t.Errorf("no check: %s", desc)
	}
}

func TestConfirmDefault(t *testing.T) {
	if !confirmDefault(NetCheck{Gateway: "10.0.5.1", GatewayOK: true}) {
		t.Error("answering gateway should default to Keep")
	}
	if confirmDefault(NetCheck{Gateway: "10.0.5.1"}) || confirmDefault(NetCheck{}) {
		t.Error("failed or missing check should default to Revert")
	}
}
