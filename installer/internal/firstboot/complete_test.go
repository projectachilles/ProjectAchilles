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
