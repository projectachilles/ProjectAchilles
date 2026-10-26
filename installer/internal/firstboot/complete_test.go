package firstboot

import (
	"context"
	"errors"
	"strings"
	"testing"
)

func TestCompleteOrder(t *testing.T) {
	f := newFakeHost()
	if err := Complete(context.Background(), f, "v9.9.9"); err != nil {
		t.Fatal(err)
	}
	conf := string(f.files[SSHDConfPath])
	if !strings.Contains(conf, "PasswordAuthentication yes") || !strings.Contains(conf, "KbdInteractiveAuthentication no") {
		t.Fatalf("sshd conf = %q", conf)
	}
	if !strings.Contains(string(f.files[MarkerPath]), "v9.9.9") {
		t.Fatalf("marker = %q", f.files[MarkerPath])
	}
	var seq []string
	for _, e := range f.log {
		if e.call != nil {
			seq = append(seq, strings.Join(e.call.argv, " "))
		} else {
			seq = append(seq, "write "+e.write)
		}
	}
	want := []string{
		"write " + SSHDConfPath,
		"systemctl enable --now ssh.socket",
		"systemctl enable getty@tty1.service",
		"systemctl disable achilles-firstboot.service",
		"write " + MarkerPath,
	}
	if strings.Join(seq, "|") != strings.Join(want, "|") {
		t.Fatalf("order = %v\nwant %v", seq, want)
	}
}

func TestCompleteStopsBeforeMarkerOnError(t *testing.T) {
	f := newFakeHost()
	f.on([]string{"systemctl", "enable", "--now", "ssh.socket"}, "", errors.New("boom"))
	if err := Complete(context.Background(), f, "v1"); err == nil {
		t.Fatal("expected error")
	}
	if f.Exists(MarkerPath) {
		t.Fatal("marker written despite failure")
	}
}

func TestCompleteStopsBeforeMarkerOnGettyError(t *testing.T) {
	f := newFakeHost()
	f.on([]string{"systemctl", "enable", "getty@tty1.service"}, "", errors.New("boom"))
	if err := Complete(context.Background(), f, "v1"); err == nil {
		t.Fatal("expected error")
	}
	if f.Exists(MarkerPath) {
		t.Fatal("marker written despite failure")
	}
}

// On later boots an enabled first-boot unit would make systemd drop the
// getty@tty1 start (Conflicts=), leaving tty1 blank: a failed disable must
// not write the marker, so first boot runs again.
func TestCompleteStopsBeforeMarkerOnDisableError(t *testing.T) {
	f := newFakeHost()
	f.on([]string{"systemctl", "disable", "achilles-firstboot.service"}, "", errors.New("boom"))
	if err := Complete(context.Background(), f, "v1"); err == nil {
		t.Fatal("expected error")
	}
	if f.Exists(MarkerPath) {
		t.Fatal("marker written despite failure")
	}
}

// sudo's secure_path doesn't include /opt/projectachilles: a command on the
// handoff screen must name the installer by its absolute path.
func TestHandoffTextCommandsAreAbsolute(t *testing.T) {
	text := HandoffText(Handoff{User: AdminUser, IP: "10.0.5.20", Hostname: "achilles", Fingerprint: "SHA256:x"})
	for _, f := range strings.Fields(text) {
		if strings.Contains(f, "achilles-installer") && strings.Trim(f, "`'\".,;") != BinPath {
			t.Errorf("handoff names %q, not %s", f, BinPath)
		}
	}
}
