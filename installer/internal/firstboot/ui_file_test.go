//go:build appliancetest

package firstboot

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
	"time"
)

func TestFileUIAnswers(t *testing.T) {
	dir := t.TempDir()
	answers := filepath.Join(dir, "answers.json")
	handoff := filepath.Join(dir, "handoff.json")
	want := NetConfig{DHCP: false, Address: "10.0.5.20/24", Gateway: "10.0.5.1", DNS: []string{"10.0.5.2"}, Search: "lab.local", Hostname: "achilles"}
	body, _ := json.Marshal(Answers{Layout: "latam", Password: "correct horse battery staple", Network: want, Keep: false})
	if err := os.WriteFile(answers, body, 0o600); err != nil {
		t.Fatal(err)
	}
	ui, err := NewFileUI(answers, handoff)
	if err != nil {
		t.Fatal(err)
	}
	ctx := context.Background()

	l, err := ui.Layout(ctx)
	if err != nil || l.ID != "latam" {
		t.Fatalf("Layout = %+v, %v", l, err)
	}
	pw, err := ui.Password(ctx)
	if err != nil || pw != "correct horse battery staple" {
		t.Fatalf("Password = %q, %v", pw, err)
	}
	nc, err := ui.Network(ctx, Detected{Iface: "eth9"}, nil)
	if err != nil {
		t.Fatal(err)
	}
	wantFilled := want
	wantFilled.Iface = "eth9"
	if !reflect.DeepEqual(nc, wantFilled) {
		t.Fatalf("Network = %+v, want %+v", nc, wantFilled)
	}
	keep, err := ui.ConfirmNetwork(ctx, nc, NetCheck{}, time.Second)
	if err != nil || keep {
		t.Fatalf("ConfirmNetwork = %v, %v; want false", keep, err)
	}
	h := Handoff{User: "achilles", IP: "10.0.5.20", Hostname: "achilles", Fingerprint: "SHA256:abc"}
	if err := ui.Handoff(ctx, h); err != nil {
		t.Fatal(err)
	}
	raw, err := os.ReadFile(handoff)
	if err != nil {
		t.Fatal(err)
	}
	var got Handoff
	if err := json.Unmarshal(raw, &got); err != nil || got != h {
		t.Fatalf("handoff file = %s (%v)", raw, err)
	}
	if st, _ := os.Stat(handoff); st.Mode().Perm() != 0o600 {
		t.Errorf("handoff mode = %v", st.Mode().Perm())
	}
	if err := ui.Notice(ctx, "boom"); err == nil || !strings.Contains(err.Error(), "boom") {
		t.Fatalf("Notice err = %v", err)
	}
}

func TestFileUIKeepsExplicitIface(t *testing.T) {
	dir := t.TempDir()
	answers := filepath.Join(dir, "a.json")
	os.WriteFile(answers, []byte(`{"layout":"us","network":{"Iface":"eth1","DHCP":true,"Hostname":"achilles"}}`), 0o600)
	ui, err := NewFileUI(answers, filepath.Join(dir, "h.json"))
	if err != nil {
		t.Fatal(err)
	}
	nc, _ := ui.Network(context.Background(), Detected{Iface: "eth9"}, nil)
	if nc.Iface != "eth1" || !nc.DHCP {
		t.Fatalf("Network = %+v", nc)
	}
}

func TestFileUIRejectsBadAnswers(t *testing.T) {
	dir := t.TempDir()
	if _, err := NewFileUI(filepath.Join(dir, "missing.json"), ""); err == nil {
		t.Error("missing file accepted")
	}
	bad := filepath.Join(dir, "bad.json")
	os.WriteFile(bad, []byte(`{"layout":"nope"}`), 0o600)
	ui, err := NewFileUI(bad, "")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := ui.Layout(context.Background()); err == nil {
		t.Error("unknown layout accepted")
	}
}
