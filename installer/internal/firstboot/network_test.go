package firstboot

import (
	"context"
	"errors"
	"os"
	"reflect"
	"strings"
	"testing"

	"github.com/projectachilles/ProjectAchilles/installer/internal/sysprobe"
)

func TestParseDefaultRoute(t *testing.T) {
	gw, dev := parseDefaultRoute("default via 10.0.5.1 dev eth0 proto dhcp src 10.0.5.20 metric 100\n")
	if gw != "10.0.5.1" || dev != "eth0" {
		t.Fatalf("got %q %q", gw, dev)
	}
	gw, dev = parseDefaultRoute("")
	if gw != "" || dev != "" {
		t.Fatalf("empty: got %q %q", gw, dev)
	}
}

func TestDetectNetworkUsesDefaultRouteDevice(t *testing.T) {
	h := newFakeHost()
	h.on([]string{"ip", "-4", "route", "show", "default"}, "default via 10.0.5.1 dev eth1 proto dhcp metric 100\n", nil)
	ifaces := func() []sysprobe.Iface {
		return []sysprobe.Iface{
			{Name: "eth0", IP: "192.168.1.5", CIDR: "192.168.1.5/24"},
			{Name: "eth1", IP: "10.0.5.20", CIDR: "10.0.5.20/24"},
		}
	}
	got, err := DetectNetwork(context.Background(), h, ifaces)
	if err != nil {
		t.Fatal(err)
	}
	want := Detected{Iface: "eth1", IP: "10.0.5.20", CIDR: "10.0.5.20/24", Gateway: "10.0.5.1"}
	if got != want {
		t.Fatalf("got %+v want %+v", got, want)
	}
}

func TestValidateNetConfig(t *testing.T) {
	static := func(mod func(*NetConfig)) NetConfig {
		nc := NetConfig{Iface: "eth0", Address: "10.0.5.20/24", Gateway: "10.0.5.1", DNS: []string{"10.0.0.10"}, Hostname: "achilles"}
		if mod != nil {
			mod(&nc)
		}
		return nc
	}
	cases := []struct {
		name string
		nc   NetConfig
		ok   bool
	}{
		{"dhcp ok", NetConfig{Iface: "eth0", DHCP: true, Hostname: "achilles"}, true},
		{"static ok", static(nil), true},
		{"gateway outside subnet", static(func(n *NetConfig) { n.Gateway = "10.0.6.1" }), false},
		{"prefix 31", static(func(n *NetConfig) { n.Address = "10.0.5.20/31" }), false},
		{"prefix 7", static(func(n *NetConfig) { n.Address = "10.0.5.20/7" }), false},
		{"zero dns", static(func(n *NetConfig) { n.DNS = nil }), false},
		{"four dns", static(func(n *NetConfig) { n.DNS = []string{"1.1.1.1", "1.0.0.1", "8.8.8.8", "8.8.4.4"} }), false},
		{"bad dns", static(func(n *NetConfig) { n.DNS = []string{"dns.local"} }), false},
		{"underscore hostname", static(func(n *NetConfig) { n.Hostname = "Bad_Name" }), false},
		{"leading hyphen", static(func(n *NetConfig) { n.Hostname = "-x" }), false},
		{"64 chars", static(func(n *NetConfig) { n.Hostname = strings.Repeat("a", 64) }), false},
		{"empty hostname", static(func(n *NetConfig) { n.Hostname = "" }), false},
		{"ipv6 address", static(func(n *NetConfig) { n.Address = "fe80::1/64" }), false},
		{"no prefix", static(func(n *NetConfig) { n.Address = "10.0.5.20" }), false},
		{"dhcp bad hostname", NetConfig{Iface: "eth0", DHCP: true, Hostname: "Bad_Name"}, false},
	}
	for _, c := range cases {
		err := ValidateNetConfig(c.nc)
		if (err == nil) != c.ok {
			t.Errorf("%s: err=%v, want ok=%v", c.name, err, c.ok)
		}
	}
}

func golden(t *testing.T, name string, got []byte) {
	t.Helper()
	want, err := os.ReadFile("testdata/" + name)
	if err != nil {
		t.Fatal(err)
	}
	if string(got) != string(want) {
		t.Fatalf("mismatch for %s\n--- got ---\n%s\n--- want ---\n%s", name, got, want)
	}
}

func TestRenderNetplanStatic(t *testing.T) {
	golden(t, "netplan-static.yaml", RenderNetplan(NetConfig{
		Iface: "eth0", Address: "10.0.5.20/24", Gateway: "10.0.5.1",
		DNS: []string{"10.0.0.10", "10.0.0.11"}, Search: "corp.example", Hostname: "achilles",
	}))
}

func TestRenderNetplanStaticNoSearch(t *testing.T) {
	out := string(RenderNetplan(NetConfig{Iface: "eth0", Address: "10.0.5.20/24", Gateway: "10.0.5.1", DNS: []string{"10.0.0.10"}}))
	if strings.Contains(out, "search") {
		t.Fatalf("search emitted when unset:\n%s", out)
	}
}

func TestRenderNetplanDHCP(t *testing.T) {
	golden(t, "netplan-dhcp.yaml", RenderNetplan(NetConfig{Iface: "eth0", DHCP: true, Hostname: "achilles"}))
}

func TestApplyNetworkWritesThenApplies(t *testing.T) {
	h := newFakeHost()
	h.files[NetplanPath] = []byte("old: config\n")
	nc := NetConfig{Iface: "eth0", DHCP: true, Hostname: "achilles"}
	revert, err := ApplyNetwork(context.Background(), h, nc)
	if err != nil {
		t.Fatal(err)
	}
	if string(h.files[NetplanPath]) != string(RenderNetplan(nc)) || h.perms[NetplanPath] != 0o600 {
		t.Fatalf("file/perm wrong: %q %v", h.files[NetplanPath], h.perms[NetplanPath])
	}
	if len(h.log) != 2 || h.log[0].write != NetplanPath || h.log[1].call == nil ||
		!reflect.DeepEqual(h.log[1].call.argv, []string{"netplan", "apply"}) {
		t.Fatalf("bad order: %+v", h.log)
	}
	if err := revert(context.Background()); err != nil {
		t.Fatal(err)
	}
	if string(h.files[NetplanPath]) != "old: config\n" || h.perms[NetplanPath] != 0o600 {
		t.Fatalf("not restored: %q", h.files[NetplanPath])
	}
	cs := h.calls()
	if len(cs) != 2 || !reflect.DeepEqual(cs[1].argv, []string{"netplan", "apply"}) {
		t.Fatalf("revert did not re-apply: %+v", cs)
	}
}

func TestApplyNetworkRestoresOnFailure(t *testing.T) {
	h := newFakeHost()
	h.files[NetplanPath] = []byte("old\n")
	h.on([]string{"netplan", "apply"}, "boom", os.ErrInvalid)
	// the restoring apply also fails here; the original file must still be back
	if _, err := ApplyNetwork(context.Background(), h, NetConfig{Iface: "eth0", DHCP: true}); err == nil {
		t.Fatal("expected error")
	}
	if string(h.files[NetplanPath]) != "old\n" {
		t.Fatalf("not restored: %q", h.files[NetplanPath])
	}
}

func TestSetHostnameAddsLoopbackLine(t *testing.T) {
	h := newFakeHost()
	h.files["/etc/hosts"] = []byte("127.0.0.1 localhost\n")
	if err := SetHostname(context.Background(), h, "achilles-1"); err != nil {
		t.Fatal(err)
	}
	cs := h.calls()
	if len(cs) != 1 || !reflect.DeepEqual(cs[0].argv, []string{"hostnamectl", "set-hostname", "achilles-1"}) {
		t.Fatalf("calls: %+v", cs)
	}
	want := "127.0.0.1 localhost\n127.0.1.1 achilles-1\n"
	if string(h.files["/etc/hosts"]) != want {
		t.Fatalf("hosts: %q", h.files["/etc/hosts"])
	}
}

func TestSetHostnameReplacesLoopbackLine(t *testing.T) {
	h := newFakeHost()
	h.files["/etc/hosts"] = []byte("127.0.0.1 localhost\n127.0.1.1 ubuntu\n127.0.1.1\told\n::1 ip6-localhost\n")
	if err := SetHostname(context.Background(), h, "achilles-1"); err != nil {
		t.Fatal(err)
	}
	got := string(h.files["/etc/hosts"])
	if strings.Count(got, "127.0.1.1") != 1 || !strings.Contains(got, "127.0.1.1 achilles-1\n") ||
		strings.Contains(got, "ubuntu") || !strings.Contains(got, "::1 ip6-localhost") {
		t.Fatalf("hosts: %q", got)
	}
}

const linkShowOut = `1: lo: <LOOPBACK,UP,LOWER_UP> mtu 65536 qdisc noqueue state UNKNOWN mode DEFAULT group default qlen 1000\    link/loopback 00:00:00:00:00:00 brd 00:00:00:00:00:00
2: docker0: <NO-CARRIER,BROADCAST,MULTICAST,UP> mtu 1500 qdisc noqueue state DOWN mode DEFAULT group default \    link/ether 02:42:ac:11:00:01 brd ff:ff:ff:ff:ff:ff
3: eth0: <BROADCAST,MULTICAST,UP,LOWER_UP> mtu 1500 qdisc mq state UP mode DEFAULT group default qlen 1000\    link/ether 00:15:5d:01:02:03 brd ff:ff:ff:ff:ff:ff
`

func TestDetectNetworkFallsBackToFirstNICWithoutDefaultRoute(t *testing.T) {
	h := newFakeHost()
	h.on([]string{"ip", "-4", "route", "show", "default"}, "", nil)
	h.on([]string{"ip", "-o", "link", "show"}, linkShowOut, nil)
	got, err := DetectNetwork(context.Background(), h, func() []sysprobe.Iface { return nil })
	if err != nil {
		t.Fatal(err)
	}
	if want := (Detected{Iface: "eth0"}); got != want {
		t.Fatalf("got %+v want %+v", got, want)
	}
}

func TestDetectNetworkFallsBackWhenRouteNICHasNoAddress(t *testing.T) {
	h := newFakeHost()
	h.on([]string{"ip", "-4", "route", "show", "default"}, "default via 10.0.5.1 dev eth0\n", nil)
	h.on([]string{"ip", "-o", "link", "show"}, linkShowOut, nil)
	got, err := DetectNetwork(context.Background(), h, func() []sysprobe.Iface { return nil })
	if err != nil {
		t.Fatal(err)
	}
	if want := (Detected{Iface: "eth0"}); got != want {
		t.Fatalf("got %+v want %+v", got, want)
	}
}

func TestDetectNetworkNoNICIsError(t *testing.T) {
	h := newFakeHost()
	h.on([]string{"ip", "-4", "route", "show", "default"}, "", nil)
	h.on([]string{"ip", "-o", "link", "show"}, strings.Join(strings.Split(linkShowOut, "\n")[:2], "\n")+"\n", nil)
	_, err := DetectNetwork(context.Background(), h, func() []sysprobe.Iface { return nil })
	if !errors.Is(err, ErrNoNIC) {
		t.Fatalf("err = %v, want ErrNoNIC", err)
	}
}

func TestParseLinkNames(t *testing.T) {
	out := linkShowOut + "4: eth1.10@eth1: <BROADCAST,MULTICAST> mtu 1500 qdisc noop state DOWN\\    link/ether 00:15:5d:01:02:04 brd ff:ff:ff:ff:ff:ff\n" +
		"5: sit0@NONE: <NOARP> mtu 1480 qdisc noop state DOWN\\    link/sit 0.0.0.0 brd 0.0.0.0\n" +
		"6: veth12ab@if5: <BROADCAST,MULTICAST,UP,LOWER_UP> mtu 1500\\    link/ether 6a:00:00:00:00:01 brd ff:ff:ff:ff:ff:ff\n" +
		"7: eth2: <BROADCAST,MULTICAST> mtu 1500 qdisc noop state DOWN\\    link/ether 00:15:5d:01:02:05 brd ff:ff:ff:ff:ff:ff\n"
	if got, want := physicalNICs(out), []string{"eth0", "eth2"}; !reflect.DeepEqual(got, want) {
		t.Fatalf("got %v want %v", got, want)
	}
}
