package firstboot

import (
	"context"
	"strings"
	"testing"
)

const pubKeyPath = "/etc/ssh/ssh_host_ed25519_key.pub"

func argvs(f *fakeHost) []string {
	var out []string
	for _, c := range f.calls() {
		out = append(out, strings.Join(c.argv, " "))
	}
	return out
}

func TestEnsureIdentityRegeneratesMachineID(t *testing.T) {
	f := newFakeHost()
	f.files["/etc/machine-id"] = []byte("\n")
	f.on([]string{"ssh-keygen", "-lf"}, "256 SHA256:abcDEF123 root@achilles (ED25519)\n", nil)
	fp, err := EnsureIdentity(context.Background(), f)
	if err != nil {
		t.Fatal(err)
	}
	if fp != "SHA256:abcDEF123" {
		t.Fatalf("fingerprint = %q", fp)
	}
	want := []string{"ssh-keygen -A", "systemd-machine-id-setup", "ssh-keygen -lf " + pubKeyPath}
	got := argvs(f)
	if strings.Join(got, "|") != strings.Join(want, "|") {
		t.Fatalf("calls = %v, want %v", got, want)
	}
}

func TestEnsureIdentityKeepsMachineID(t *testing.T) {
	f := newFakeHost()
	f.files["/etc/machine-id"] = []byte("0123456789abcdef0123456789abcdef\n")
	f.on([]string{"ssh-keygen", "-lf"}, "256 SHA256:xyz root@h (ED25519)\n", nil)
	if _, err := EnsureIdentity(context.Background(), f); err != nil {
		t.Fatal(err)
	}
	for _, a := range argvs(f) {
		if strings.HasPrefix(a, "systemd-machine-id-setup") {
			t.Fatal("machine-id regenerated though present")
		}
	}
}

func TestEnsureIdentityBadFingerprintOutput(t *testing.T) {
	f := newFakeHost()
	f.files["/etc/machine-id"] = []byte("abc\n")
	f.on([]string{"ssh-keygen", "-lf"}, "garbage\n", nil)
	if _, err := EnsureIdentity(context.Background(), f); err == nil {
		t.Fatal("expected error")
	}
}

func TestHandoffText(t *testing.T) {
	s := HandoffText(Handoff{User: "achilles", IP: "10.0.5.20", Hostname: "achilles", Fingerprint: "SHA256:abc"})
	for _, w := range []string{"ssh achilles@10.0.5.20", "SHA256:abc", "Or log in here as achilles.", "install", "restore from a backup"} {
		if !strings.Contains(s, w) {
			t.Errorf("missing %q in:\n%s", w, s)
		}
	}
}
