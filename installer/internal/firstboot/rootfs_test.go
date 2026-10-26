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

func TestRootfsMatchesConstants(t *testing.T) {
	fb := readRootfs(t, "etc/systemd/system/achilles-firstboot.service")
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

	if _, err := exec.LookPath("systemd-analyze"); err != nil {
		t.Skip("systemd-analyze not available")
	}
	// verify insists the ExecStart binary exists, which it does not on the
	// build host: verify copies with the binary pointed at /bin/true.
	for name, unit := range map[string]string{"achilles-firstboot.service": fb, "achilles-issue.service": is} {
		p := filepath.Join(t.TempDir(), name)
		if err := os.WriteFile(p, []byte(strings.ReplaceAll(unit, BinPath, "/bin/true")), 0o644); err != nil {
			t.Fatal(err)
		}
		if out, err := exec.Command("systemd-analyze", "verify", "--man=no", p).CombinedOutput(); err != nil {
			t.Errorf("verify %s: %v\n%s", name, err, out)
		}
	}
}
