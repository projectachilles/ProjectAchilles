package firstboot

import (
	"context"
	"errors"
	"io"
	"os/exec"
	"strings"
	"testing"
	"time"

	"charm.land/huh/v2"

	"github.com/projectachilles/ProjectAchilles/installer/internal/sysprobe"
)

type fakeUI struct {
	layout       Layout
	password     string
	passwordErr  error
	networks     []NetConfig
	confirms     []bool
	prevs        []*NetConfig
	dets         []Detected
	networkCalls int
	confirmCalls int
	checks       []NetCheck
	handoff      *Handoff
	handoffErr   error
	notices      []string
	onHandoff    func()
}

func (u *fakeUI) Layout(context.Context) (Layout, error) { return u.layout, nil }
func (u *fakeUI) Password(context.Context) (string, error) {
	return u.password, u.passwordErr
}
func (u *fakeUI) Network(_ context.Context, d Detected, prev *NetConfig) (NetConfig, error) {
	u.prevs = append(u.prevs, prev)
	u.dets = append(u.dets, d)
	i := u.networkCalls
	u.networkCalls++
	if i >= len(u.networks) {
		i = len(u.networks) - 1
	}
	return u.networks[i], nil
}
func (u *fakeUI) ConfirmNetwork(_ context.Context, _ NetConfig, c NetCheck, _ time.Duration) (bool, error) {
	u.checks = append(u.checks, c)
	i := u.confirmCalls
	u.confirmCalls++
	if i >= len(u.confirms) {
		return true, nil
	}
	return u.confirms[i], nil
}
func (u *fakeUI) Handoff(_ context.Context, h Handoff) error {
	u.handoff = &h
	if u.onHandoff != nil {
		u.onHandoff()
	}
	return u.handoffErr
}
func (u *fakeUI) Notice(_ context.Context, msg string) error {
	u.notices = append(u.notices, msg)
	return nil
}

func testIfaces() []sysprobe.Iface {
	return []sysprobe.Iface{{Name: "eth0", IP: "10.0.5.20", CIDR: "10.0.5.20/24"}}
}

func runHost() *fakeHost {
	f := newFakeHost()
	f.on([]string{"ip", "-4", "route", "show", "default"}, "default via 10.0.5.1 dev eth0\n", nil)
	f.on([]string{"ssh-keygen", "-lf"}, "256 SHA256:abc123 root@x (ED25519)\n", nil)
	f.files["/etc/machine-id"] = []byte("abc\n")
	return f
}

func dhcpUI() *fakeUI {
	return &fakeUI{
		layout:   Layouts[0],
		password: "correct-horse-battery",
		networks: []NetConfig{{Iface: "eth0", DHCP: true, Hostname: "achilles"}},
	}
}

func idx(seq []string, s string) int {
	for i, v := range seq {
		if v == s {
			return i
		}
	}
	return -1
}

func logSeq(f *fakeHost) []string {
	var seq []string
	for _, e := range f.log {
		if e.call != nil {
			seq = append(seq, strings.Join(e.call.argv, " "))
		} else {
			seq = append(seq, "write "+e.write)
		}
	}
	return seq
}

func TestRunOrder(t *testing.T) {
	f := runHost()
	ui := dhcpUI()
	handoffSeenBeforeGetty := false
	ui.onHandoff = func() { handoffSeenBeforeGetty = idx(logSeq(f), "systemctl --no-block start getty@tty1.service") < 0 }
	if err := Run(context.Background(), f, ui, testIfaces, "v1"); err != nil {
		t.Fatal(err)
	}
	seq := logSeq(f)
	kb, pw, ssh := idx(seq, "write "+KeyboardPath), idx(seq, "chpasswd"), idx(seq, "systemctl enable --now ssh.socket")
	if kb < 0 || pw < 0 || ssh < 0 || !(kb < pw && pw < ssh) {
		t.Fatalf("order wrong: kb=%d pw=%d ssh=%d\n%v", kb, pw, ssh, seq)
	}
	getty, disable := idx(seq, "systemctl enable getty@tty1.service"), idx(seq, "systemctl disable achilles-firstboot.service")
	if getty < 0 || disable < 0 || !(getty < disable && disable < idx(seq, "write "+MarkerPath)) {
		t.Fatalf("first-boot unit not disabled between getty enable and marker: getty=%d disable=%d\n%v", getty, disable, seq)
	}
	n := len(seq)
	if seq[n-2] != "write "+MarkerPath || seq[n-1] != "systemctl --no-block start getty@tty1.service" {
		t.Fatalf("tail = %v", seq[n-3:])
	}
	if !handoffSeenBeforeGetty {
		t.Fatal("getty started before Handoff was shown")
	}
	if ui.handoff == nil || ui.handoff.Fingerprint != "SHA256:abc123" || ui.handoff.IP != "10.0.5.20" ||
		ui.handoff.User != AdminUser || ui.handoff.Hostname != "achilles" {
		t.Fatalf("handoff = %+v", ui.handoff)
	}
}

func TestRunStaticHandoffIP(t *testing.T) {
	f := runHost()
	ui := dhcpUI()
	ui.networks = []NetConfig{{Iface: "eth0", Address: "10.0.5.50/24", Gateway: "10.0.5.1", DNS: []string{"10.0.5.2"}, Hostname: "achilles"}}
	if err := Run(context.Background(), f, ui, testIfaces, "v1"); err != nil {
		t.Fatal(err)
	}
	if ui.handoff.IP != "10.0.5.50" {
		t.Fatalf("ip = %q", ui.handoff.IP)
	}
}

func TestRunRevertsUnconfirmedNetwork(t *testing.T) {
	f := runHost()
	orig := []byte("original netplan\n")
	f.files[NetplanPath] = orig
	ui := dhcpUI()
	first := NetConfig{Iface: "eth0", Address: "10.0.5.50/24", Gateway: "10.0.5.1", DNS: []string{"10.0.5.2"}, Hostname: "achilles"}
	ui.networks = []NetConfig{first, {Iface: "eth0", DHCP: true, Hostname: "achilles"}}
	ui.confirms = []bool{false, true}
	// Snapshot the netplan file when the second Network prompt is shown.
	var atSecond []byte
	wrapped := &snapUI{fakeUI: ui, snap: func() { atSecond = append([]byte(nil), f.files[NetplanPath]...) }}
	if err := Run(context.Background(), f, wrapped, testIfaces, "v1"); err != nil {
		t.Fatal(err)
	}
	if string(atSecond) != string(orig) {
		t.Fatalf("netplan not restored before retry: %q", atSecond)
	}
	if len(ui.prevs) != 2 || ui.prevs[0] != nil || ui.prevs[1] == nil || ui.prevs[1].Address != first.Address {
		t.Fatalf("prevs = %+v", ui.prevs)
	}
}

type snapUI struct {
	*fakeUI
	snap func()
}

func (s *snapUI) Network(ctx context.Context, d Detected, prev *NetConfig) (NetConfig, error) {
	if prev != nil {
		s.snap()
	}
	return s.fakeUI.Network(ctx, d, prev)
}

func TestRunIsRerunnable(t *testing.T) {
	f := runHost()
	for i := 0; i < 2; i++ {
		if err := Run(context.Background(), f, dhcpUI(), testIfaces, "v1"); err != nil {
			t.Fatalf("run %d: %v", i, err)
		}
	}
	if !f.Exists(MarkerPath) {
		t.Fatal("marker missing")
	}
}

func TestRunAbortReturnsError(t *testing.T) {
	f := runHost()
	ui := dhcpUI()
	ui.passwordErr = huh.ErrUserAborted
	err := Run(context.Background(), f, ui, testIfaces, "v1")
	if !errors.Is(err, huh.ErrUserAborted) {
		t.Fatalf("err = %v", err)
	}
	if idx(logSeq(f), "systemctl enable --now ssh.socket") >= 0 || f.Exists(MarkerPath) {
		t.Fatal("ssh enabled or marker written after abort")
	}
	if len(ui.notices) != 0 {
		t.Fatalf("abort showed a notice: %q", ui.notices)
	}
}

func TestRunEOFShowsNoNotice(t *testing.T) {
	ui := dhcpUI()
	ui.passwordErr = io.EOF
	if err := Run(context.Background(), runHost(), ui, testIfaces, "v1"); !errors.Is(err, io.EOF) {
		t.Fatalf("err = %v", err)
	}
	if len(ui.notices) != 0 {
		t.Fatalf("EOF showed a notice: %q", ui.notices)
	}
}

// A failing step outside the network form restarts first boot (systemd
// Restart=on-failure): the admin must be told why before the screen resets.
func TestRunStepFailureShowsNotice(t *testing.T) {
	for _, prefix := range [][]string{
		{"chpasswd"},
		{"ssh-keygen", "-A"},
		{"systemctl", "disable", FirstbootUnit},
	} {
		f := runHost()
		f.script = append([]scripted{{prefix: prefix, out: []byte("it broke"), err: errors.New("exit status 1")}}, f.script...)
		ui := dhcpUI()
		err := Run(context.Background(), f, ui, testIfaces, "v1")
		if err == nil {
			t.Fatalf("%v: expected error", prefix)
		}
		if len(ui.notices) != 1 || !strings.HasPrefix(ui.notices[0], "First boot failed: ") ||
			!strings.Contains(ui.notices[0], prefix[0]) || !strings.Contains(ui.notices[0], "it broke") ||
			!strings.HasSuffix(ui.notices[0], ". It will start again from the beginning.") {
			t.Fatalf("%v: notices = %q", prefix, ui.notices)
		}
		if f.Exists(MarkerPath) || ui.handoff != nil {
			t.Fatalf("%v: continued after failure", prefix)
		}
	}
}

func TestRunStaticChecksGateway(t *testing.T) {
	for _, answers := range []bool{true, false} {
		f := runHost()
		if !answers {
			f.script = append([]scripted{{prefix: []string{"ping"}, err: errors.New("exit status 1")}}, f.script...)
		}
		ui := dhcpUI()
		ui.networks = []NetConfig{{Iface: "eth0", Address: "10.0.5.50/24", Gateway: "10.0.5.1", DNS: []string{"10.0.5.2"}, Hostname: "achilles"}}
		if err := Run(context.Background(), f, ui, testIfaces, "v1"); err != nil {
			t.Fatal(err)
		}
		want := NetCheck{Address: "10.0.5.50", Gateway: "10.0.5.1", GatewayOK: answers}
		if len(ui.checks) != 1 || ui.checks[0] != want {
			t.Fatalf("answers=%v: checks = %+v", answers, ui.checks)
		}
		seq := logSeq(f)
		ping, apply, hn := idx(seq, "ping -c1 -W2 10.0.5.1"), idx(seq, "netplan apply"), idx(seq, "hostnamectl set-hostname achilles")
		if ping < 0 || ping < apply || ping < hn {
			t.Fatalf("answers=%v: ping not run after apply: %v", answers, seq)
		}
		if !f.Exists(MarkerPath) {
			t.Fatalf("answers=%v: a failed ping must not fail first boot", answers)
		}
	}
}

func TestRunPingMissingIsNoCheck(t *testing.T) {
	f := runHost()
	f.script = append([]scripted{{prefix: []string{"ping"}, err: &exec.Error{Name: "ping", Err: exec.ErrNotFound}}}, f.script...)
	ui := dhcpUI()
	if err := Run(context.Background(), f, ui, testIfaces, "v1"); err != nil {
		t.Fatal(err)
	}
	if want := (NetCheck{Address: "10.0.5.20"}); len(ui.checks) != 1 || ui.checks[0] != want {
		t.Fatalf("checks = %+v", ui.checks)
	}
}

// Error texts often end in a period; the notice must not read "..".
func TestRunFailureNoticeHasOnePeriod(t *testing.T) {
	ui := dhcpUI()
	ui.password = "short"
	if err := Run(context.Background(), runHost(), ui, testIfaces, "v1"); err == nil {
		t.Fatal("expected error")
	}
	if want := "First boot failed: Use at least 12 characters. It will start again from the beginning."; len(ui.notices) != 1 || ui.notices[0] != want {
		t.Fatalf("notices = %q", ui.notices)
	}
}

func TestRunDHCPChecksDetectedGateway(t *testing.T) {
	f := runHost()
	ui := dhcpUI()
	if err := Run(context.Background(), f, ui, testIfaces, "v1"); err != nil {
		t.Fatal(err)
	}
	want := NetCheck{Address: "10.0.5.20", Gateway: "10.0.5.1", GatewayOK: true}
	if len(ui.checks) != 1 || ui.checks[0] != want {
		t.Fatalf("checks = %+v", ui.checks)
	}
	if idx(logSeq(f), "ping -c1 -W2 10.0.5.1") < 0 {
		t.Fatalf("gateway not pinged: %v", logSeq(f))
	}
}

func TestRunNoGatewayDoesNotPing(t *testing.T) {
	old := redetectPause
	redetectPause = 0
	defer func() { redetectPause = old }()
	f := noDHCPHost()
	ui := dhcpUI()
	static := NetConfig{Iface: "eth0", Address: "10.0.5.50/24", Gateway: "10.0.5.1", DNS: []string{"10.0.5.2"}, Hostname: "achilles"}
	ui.networks = []NetConfig{{Iface: "eth0", DHCP: true, Hostname: "achilles"}, static}
	if err := Run(context.Background(), f, ui, noIfaces, "v1"); err != nil {
		t.Fatal(err)
	}
	if len(ui.checks) != 2 || ui.checks[0] != (NetCheck{}) {
		t.Fatalf("checks = %+v", ui.checks)
	}
	pings := 0
	for _, c := range f.calls() {
		if c.argv[0] == "ping" {
			pings++
		}
	}
	if pings != 1 { // only the static config's gateway
		t.Fatalf("pings = %d: %v", pings, logSeq(f))
	}
}

func TestRunGettyStartFailureIsNonFatal(t *testing.T) {
	f := runHost()
	f.on([]string{"systemctl", "--no-block", "start", "getty@tty1.service"}, "", errors.New("boom"))
	if err := Run(context.Background(), f, dhcpUI(), testIfaces, "v1"); err != nil {
		t.Fatal(err)
	}
	if !f.Exists(MarkerPath) {
		t.Fatal("marker missing")
	}
}

func TestRunHandoffAbortAfterCompleteIsNotAnError(t *testing.T) {
	f := runHost()
	ui := dhcpUI()
	ui.handoffErr = huh.ErrUserAborted
	if err := Run(context.Background(), f, ui, testIfaces, "v1"); err != nil {
		t.Fatal(err)
	}
	seq := logSeq(f)
	if seq[len(seq)-1] != "systemctl --no-block start getty@tty1.service" {
		t.Fatalf("getty not started after aborted handoff: %v", seq)
	}
}

// failingHost fails one scripted Run once, then behaves normally.
type onceHost struct {
	*fakeHost
	prefix string
	hook   func()
	done   bool
}

func (h *onceHost) Run(ctx context.Context, stdin []byte, name string, args ...string) ([]byte, error) {
	out, err := h.fakeHost.Run(ctx, stdin, name, args...)
	if !h.done && strings.HasPrefix(strings.Join(append([]string{name}, args...), " "), h.prefix) {
		h.done = true
		if h.hook != nil {
			h.hook()
		}
		return []byte("apply broke"), errors.New("exit 1")
	}
	return out, err
}

func TestRunReasksAfterApplyFailure(t *testing.T) {
	f := &onceHost{fakeHost: runHost(), prefix: "netplan apply"}
	ui := dhcpUI()
	first := NetConfig{Iface: "eth0", Address: "10.0.5.50/24", Gateway: "10.0.5.1", DNS: []string{"10.0.5.2"}, Hostname: "achilles"}
	ui.networks = []NetConfig{first, {Iface: "eth0", DHCP: true, Hostname: "achilles"}}
	if err := Run(context.Background(), f, ui, testIfaces, "v1"); err != nil {
		t.Fatal(err)
	}
	if len(ui.notices) != 1 || !strings.Contains(ui.notices[0], "netplan apply") {
		t.Fatalf("notices = %q", ui.notices)
	}
	if len(ui.prevs) != 2 || ui.prevs[1] == nil || ui.prevs[1].Address != first.Address {
		t.Fatalf("prevs = %+v", ui.prevs)
	}
}

func TestRunReasksAfterInvalidConfig(t *testing.T) {
	f := runHost()
	ui := dhcpUI()
	bad := NetConfig{Iface: "eth0", Address: "nonsense", Gateway: "10.0.5.1", DNS: []string{"10.0.5.2"}, Hostname: "achilles"}
	ui.networks = []NetConfig{bad, {Iface: "eth0", DHCP: true, Hostname: "achilles"}}
	if err := Run(context.Background(), f, ui, testIfaces, "v1"); err != nil {
		t.Fatal(err)
	}
	if len(ui.notices) != 1 || ui.networkCalls != 2 || ui.prevs[1] == nil || ui.prevs[1].Address != "nonsense" {
		t.Fatalf("notices=%q calls=%d prevs=%+v", ui.notices, ui.networkCalls, ui.prevs)
	}
	if idx(logSeq(f), "netplan apply") != -1 && f.files[NetplanPath] != nil && strings.Contains(string(f.files[NetplanPath]), "nonsense") {
		t.Fatal("invalid config was written")
	}
}

func TestRunDHCPRedetectFallsBack(t *testing.T) {
	old := redetectPause
	redetectPause = 0
	defer func() { redetectPause = old }()
	f := runHost()
	ui := dhcpUI()
	calls := 0
	ifaces := func() []sysprobe.Iface {
		calls++
		if calls == 1 {
			return testIfaces()
		}
		return nil // default-route iface vanishes after apply
	}
	if err := Run(context.Background(), f, ui, ifaces, "v1"); err != nil {
		t.Fatal(err)
	}
	if ui.handoff.IP != "10.0.5.20" {
		t.Fatalf("ip = %q", ui.handoff.IP)
	}
	if calls != 1+redetectAttempts {
		t.Fatalf("calls = %d", calls)
	}
}

func TestRunCancelDuringApplyStillRevertsAndErrors(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	f := &onceHost{fakeHost: runHost(), prefix: "netplan apply", hook: cancel}
	orig := []byte("original netplan\n")
	f.files[NetplanPath] = orig
	ui := dhcpUI()
	ui.networks = []NetConfig{{Iface: "eth0", Address: "10.0.5.50/24", Gateway: "10.0.5.1", DNS: []string{"10.0.5.2"}, Hostname: "achilles"}}
	if err := Run(ctx, f, ui, testIfaces, "v1"); err == nil {
		t.Fatal("expected error")
	}
	if string(f.files[NetplanPath]) != string(orig) {
		t.Fatalf("netplan not restored: %q", f.files[NetplanPath])
	}
	if f.Exists(MarkerPath) || len(ui.notices) != 0 {
		t.Fatal("continued after cancel")
	}
}

// noDHCPHost has a NIC but no default route: no DHCP server answered.
func noDHCPHost() *fakeHost {
	f := newFakeHost()
	f.on([]string{"ip", "-4", "route", "show", "default"}, "", nil)
	f.on([]string{"ip", "-o", "link", "show"}, "1: lo: <LOOPBACK,UP,LOWER_UP> mtu 65536\\    link/loopback 00:00:00:00:00:00 brd 00:00:00:00:00:00\n"+
		"3: eth0: <BROADCAST,MULTICAST,UP,LOWER_UP> mtu 1500\\    link/ether 00:15:5d:01:02:03 brd ff:ff:ff:ff:ff:ff\n", nil)
	f.on([]string{"ssh-keygen", "-lf"}, "256 SHA256:abc123 root@x (ED25519)\n", nil)
	f.files["/etc/machine-id"] = []byte("abc\n")
	return f
}

func noIfaces() []sysprobe.Iface { return nil }

func TestRunWithoutDHCPReachesNetworkForm(t *testing.T) {
	f := noDHCPHost()
	ui := dhcpUI()
	ui.networks = []NetConfig{{Iface: "eth0", Address: "10.0.5.50/24", Gateway: "10.0.5.1", DNS: []string{"10.0.5.2"}, Hostname: "achilles"}}
	if err := Run(context.Background(), f, ui, noIfaces, "v1"); err != nil {
		t.Fatal(err)
	}
	if len(ui.dets) != 1 || ui.dets[0] != (Detected{Iface: "eth0"}) {
		t.Fatalf("Network got %+v", ui.dets)
	}
	if !strings.Contains(string(f.files[NetplanPath]), "10.0.5.50/24") || !f.Exists(MarkerPath) {
		t.Fatalf("static config not applied or first boot incomplete: %q", f.files[NetplanPath])
	}
	if ui.handoff == nil || ui.handoff.IP != "10.0.5.50" || len(ui.notices) != 0 {
		t.Fatalf("handoff=%+v notices=%q", ui.handoff, ui.notices)
	}
}

func TestRunDHCPWithoutAddressReasks(t *testing.T) {
	old := redetectPause
	redetectPause = 0
	defer func() { redetectPause = old }()
	f := noDHCPHost()
	ui := dhcpUI()
	static := NetConfig{Iface: "eth0", Address: "10.0.5.50/24", Gateway: "10.0.5.1", DNS: []string{"10.0.5.2"}, Hostname: "achilles"}
	ui.networks = []NetConfig{{Iface: "eth0", DHCP: true, Hostname: "achilles"}, static}
	if err := Run(context.Background(), f, ui, noIfaces, "v1"); err != nil {
		t.Fatal(err)
	}
	if len(ui.notices) != 1 || !strings.Contains(ui.notices[0], "DHCP didn't give this server an address") {
		t.Fatalf("notices = %q", ui.notices)
	}
	if ui.networkCalls != 2 || ui.prevs[1] == nil || !ui.prevs[1].DHCP || ui.prevs[1].Hostname != "achilles" {
		t.Fatalf("calls=%d prevs=%+v", ui.networkCalls, ui.prevs)
	}
	if ui.handoff == nil || ui.handoff.IP != "10.0.5.50" {
		t.Fatalf("handoff = %+v", ui.handoff)
	}
}

func TestRunNoNICShowsNotice(t *testing.T) {
	f := newFakeHost()
	f.on([]string{"ip", "-4", "route", "show", "default"}, "", nil)
	f.on([]string{"ip", "-o", "link", "show"}, "1: lo: <LOOPBACK,UP,LOWER_UP> mtu 65536\\    link/loopback 00:00:00:00:00:00 brd 00:00:00:00:00:00\n", nil)
	ui := dhcpUI()
	err := Run(context.Background(), f, ui, noIfaces, "v1")
	if err == nil {
		t.Fatal("expected error")
	}
	want := "No network adapter found. Add one to this VM in Hyper-V and restart it."
	if len(ui.notices) != 1 || ui.notices[0] != want {
		t.Fatalf("notices = %q", ui.notices)
	}
	if ui.networkCalls != 0 || f.Exists(MarkerPath) {
		t.Fatal("continued without a NIC")
	}
}

// systemd stops first boot (SIGTERM, which cancels ctx) when Run starts the
// tty1 getty, because the unit has Conflicts=getty@tty1.service. That is the
// normal end of first boot, not a failure.
func TestRunStoppedByGettyStartIsNotAnError(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	f := &onceHost{fakeHost: runHost(), prefix: "systemctl --no-block start getty@tty1.service", hook: cancel}
	if err := Run(ctx, f, dhcpUI(), testIfaces, "v1"); err != nil {
		t.Fatalf("err = %v", err)
	}
	if !f.Exists(MarkerPath) {
		t.Fatal("marker missing")
	}
}
