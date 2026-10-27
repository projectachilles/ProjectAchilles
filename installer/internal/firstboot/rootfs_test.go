package firstboot

import (
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
)

const rootfsDir = "../../../appliance/rootfs"

func readRootfs(t *testing.T, rel string) string {
	t.Helper()
	b, err := os.ReadFile(filepath.Join(rootfsDir, rel))
	if err != nil {
		t.Fatalf("read %s: %v", rel, err)
	}
	return string(b)
}

func lineValues(content, key string) []string {
	var out []string
	for _, l := range strings.Split(content, "\n") {
		if v, ok := strings.CutPrefix(strings.TrimSpace(l), key); ok {
			out = append(out, v)
		}
	}
	return out
}

// section returns the body of [name] in a unit file.
func section(unit, name string) string {
	var b strings.Builder
	in := false
	for _, l := range strings.Split(unit, "\n") {
		if t := strings.TrimSpace(l); strings.HasPrefix(t, "[") && strings.HasSuffix(t, "]") {
			in = t == "["+name+"]"
			continue
		}
		if in {
			b.WriteString(l + "\n")
		}
	}
	return b.String()
}

func TestRootfsMatchesConstants(t *testing.T) {
	fb := readRootfs(t, "etc/systemd/system/"+FirstbootUnit) // Complete disables it by this name
	is := readRootfs(t, "etc/systemd/system/achilles-issue.service")
	sh := readRootfs(t, "etc/profile.d/achilles-appliance.sh")
	np := readRootfs(t, "etc/netplan/50-achilles.yaml")

	for name, unit := range map[string]string{"firstboot": fb, "issue": is} {
		es := lineValues(unit, "ExecStart=")
		if len(es) == 0 {
			t.Errorf("%s: no ExecStart", name)
		}
		for _, v := range es {
			if !strings.HasPrefix(v, BinPath) {
				t.Errorf("%s: ExecStart %q does not start with %s", name, v, BinPath)
			}
		}
	}
	cond := lineValues(fb, "ConditionPathExists=!")
	if len(cond) != 1 || cond[0] != MarkerPath {
		t.Errorf("ConditionPathExists=! = %v, want %s", cond, MarkerPath)
	}
	if !strings.Contains(fb, "Restart=on-failure") {
		t.Error("firstboot unit lacks Restart=on-failure")
	}
	// A unit setting is a whole line: "Type=idle" must not match "Type=idlex".
	hasLine := func(unit, line string) bool {
		for _, l := range strings.Split(unit, "\n") {
			if strings.TrimSpace(l) == line {
				return true
			}
		}
		return false
	}
	for _, want := range []string{
		// Ctrl+C mashing or a missing binary must never hit the start limit
		// and leave tty1 dead. Only honoured in [Unit].
		"StartLimitIntervalSec=0",
		// A getty (or logind's autovt@tty1 alias) on tty1 would fight first
		// boot for the console. Before= makes the handover stop first boot
		// before the getty takes tty1.
		"Conflicts=getty@tty1.service",
		"Before=getty@tty1.service",
	} {
		if !hasLine(section(fb, "Unit"), want) {
			t.Errorf("firstboot unit [Unit] lacks %s", want)
		}
	}
	// TTYVTDisallocate clears tty1 first, so the form doesn't start under
	// the boot log (getty@.service does the same).
	for _, want := range []string{"Type=idle", "TTYPath=/dev/tty1", "TTYVTDisallocate=yes"} {
		if !hasLine(section(fb, "Service"), want) {
			t.Errorf("firstboot unit [Service] lacks %s", want)
		}
	}
	if !hasLine(is, "Before=getty.target") {
		t.Error("issue unit lacks Before=getty.target")
	}
	// First boot configures the network itself; waiting for network-online
	// blanks tty1 for ~2 min when there is no DHCP.
	for name, unit := range map[string]string{"firstboot": fb, "issue": is} {
		if strings.Contains(unit, "network-online.target") {
			t.Errorf("%s unit waits for network-online.target", name)
		}
	}
	if !strings.Contains(sh, BinPath) {
		t.Error("profile script does not reference BinPath")
	}
	if !strings.Contains(sh, AdminUser) {
		t.Error("profile script does not reference the admin user")
	}
	for _, l := range strings.Split(sh, "\n") {
		code := strings.TrimSpace(l)
		if strings.HasPrefix(code, "#") {
			continue
		}
		for _, w := range strings.FieldsFunc(code, func(r rune) bool { return !(r >= 'a' && r <= 'z') }) {
			if w == "exit" {
				t.Errorf("profile script contains exit: %q", l)
			}
		}
	}
	if !strings.Contains(np, "dhcp4: true") || !strings.Contains(np, `name: "e*"`) {
		t.Error("netplan lacks DHCP on e*")
	}
	if !strings.Contains(np, "0600") {
		t.Error("netplan does not note mode 0600")
	}

	gr := readRootfs(t, "etc/systemd/system/achilles-growroot.service")
	const growScript = "/usr/local/lib/projectachilles/growroot.sh"
	if v := lineValues(gr, "ExecStart="); len(v) != 1 || v[0] != growScript {
		t.Errorf("growroot ExecStart = %v, want %s", v, growScript)
	}
	for _, want := range []string{"Before=achilles-firstboot.service"} {
		if !hasLine(section(gr, "Unit"), want) {
			t.Errorf("growroot [Unit] lacks %s", want)
		}
	}
	if !hasLine(section(gr, "Service"), "Type=oneshot") {
		t.Error("growroot [Service] lacks Type=oneshot")
	}
	// First boot waits for it (Before=), and a oneshot has no start timeout
	// by default: a hung growpart or resize2fs must not hold first boot.
	if !hasLine(section(gr, "Service"), "TimeoutStartSec=5min") {
		t.Error("growroot [Service] lacks TimeoutStartSec=5min")
	}
	if !hasLine(section(gr, "Install"), "WantedBy=multi-user.target") {
		t.Error("growroot [Install] lacks WantedBy=multi-user.target")
	}
	if fi, err := os.Stat(filepath.Join(rootfsDir, "usr/local/lib/projectachilles/growroot.sh")); err != nil {
		t.Errorf("stat growroot.sh: %v", err)
	} else if fi.Mode().Perm()&0o111 != 0o111 {
		t.Errorf("growroot.sh mode %v is not executable", fi.Mode().Perm())
	}

	if _, err := exec.LookPath("systemd-analyze"); err != nil {
		t.Skip("systemd-analyze not available")
	}
	// verify insists the ExecStart binary exists, which it does not on the
	// build host: verify copies with the binary pointed at /bin/true.
	for name, unit := range map[string]string{"achilles-firstboot.service": fb, "achilles-issue.service": is, "achilles-growroot.service": strings.ReplaceAll(gr, growScript, "/bin/true")} {
		p := filepath.Join(t.TempDir(), name)
		if err := os.WriteFile(p, []byte(strings.ReplaceAll(unit, BinPath, "/bin/true")), 0o644); err != nil {
			t.Fatal(err)
		}
		if out, err := exec.Command("systemd-analyze", "verify", "--man=no", p).CombinedOutput(); err != nil {
			t.Errorf("verify %s: %v\n%s", name, err, out)
		}
	}
}
