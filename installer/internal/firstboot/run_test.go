package firstboot

import (
	"context"
	"errors"
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
	networkCalls int
	confirmCalls int
	handoff      *Handoff
}

func (u *fakeUI) Layout(context.Context) (Layout, error) { return u.layout, nil }
func (u *fakeUI) Password(context.Context) (string, error) {
	return u.password, u.passwordErr
}
func (u *fakeUI) Network(_ context.Context, _ Detected, prev *NetConfig) (NetConfig, error) {
	u.prevs = append(u.prevs, prev)
	i := u.networkCalls
	u.networkCalls++
	if i >= len(u.networks) {
		i = len(u.networks) - 1
	}
	return u.networks[i], nil
}
func (u *fakeUI) ConfirmNetwork(context.Context, NetConfig, time.Duration) (bool, error) {
	i := u.confirmCalls
	u.confirmCalls++
	if i >= len(u.confirms) {
		return true, nil
	}
	return u.confirms[i], nil
}
func (u *fakeUI) Handoff(_ context.Context, h Handoff) error { u.handoff = &h; return nil }

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
	if err := Run(context.Background(), f, ui, testIfaces, "v1"); err != nil {
		t.Fatal(err)
	}
	seq := logSeq(f)
	kb, pw, ssh := idx(seq, "write "+KeyboardPath), idx(seq, "chpasswd"), idx(seq, "systemctl enable --now ssh.socket")
	if kb < 0 || pw < 0 || ssh < 0 || !(kb < pw && pw < ssh) {
		t.Fatalf("order wrong: kb=%d pw=%d ssh=%d\n%v", kb, pw, ssh, seq)
	}
	n := len(seq)
	if seq[n-2] != "write "+MarkerPath || seq[n-1] != "systemctl --no-block start getty@tty1.service" {
		t.Fatalf("tail = %v", seq[n-3:])
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
}
