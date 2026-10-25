package sysprobe

import (
	"context"
	"errors"
	"strings"
	"testing"
)

type fakeSys struct {
	mem, disk  uint64
	busy       map[int]bool
	httpErr    map[string]error
	dockerErr  error
	synced     bool
	syncErr    error
	root       bool
	osID, osVr string
	dockerDir  bool
	diskPath   string
}

func good() *fakeSys {
	return &fakeSys{mem: 8 << 30, disk: 100 << 30, busy: map[int]bool{}, httpErr: map[string]error{}, synced: true, root: true, osID: "ubuntu", osVr: "24.04"}
}
func (f *fakeSys) MemTotalBytes() (uint64, error)                  { return f.mem, nil }
func (f *fakeSys) DiskFreeBytes(p string) (uint64, error)          { f.diskPath = p; return f.disk, nil }
func (f *fakeSys) DirExists(string) bool                           { return f.dockerDir }
func (f *fakeSys) PortFree(p int) bool                             { return !f.busy[p] }
func (f *fakeSys) HTTPReachable(_ context.Context, u string) error { return f.httpErr[u] }
func (f *fakeSys) DockerVersion() (string, error)                  { return "27.1", f.dockerErr }
func (f *fakeSys) TimeSynced() (bool, error)                       { return f.synced, f.syncErr }
func (f *fakeSys) IsRoot() bool                                    { return f.root }
func (f *fakeSys) OSRelease() (string, string, error)              { return f.osID, f.osVr, nil }

func find(t *testing.T, cs []Check, id string) Check {
	t.Helper()
	for _, c := range cs {
		if c.ID == id {
			return c
		}
	}
	t.Fatalf("check %s missing", id)
	return Check{}
}

func TestPreflightAllGood(t *testing.T) {
	cs := Preflight(context.Background(), good(), PreflightOptions{})
	if len(cs) != 11 {
		t.Fatalf("want 11 checks, got %d", len(cs))
	}
	for _, c := range cs {
		if c.Status != Pass {
			t.Errorf("%s: %v %s", c.ID, c.Status, c.Detail)
		}
	}
	if !ESSelfAllowed(cs) {
		t.Error("ES should be allowed")
	}
}

func TestPreflightLowRAMWarnsAndDisablesES(t *testing.T) {
	s := good()
	s.mem = 3 << 30
	cs := Preflight(context.Background(), s, PreflightOptions{})
	if find(t, cs, "ram").Status != Warn || ESSelfAllowed(cs) {
		t.Error("expected Warn and ES disabled")
	}
	s.mem = 1 << 30
	if find(t, Preflight(context.Background(), s, PreflightOptions{}), "ram").Status != Fail {
		t.Error("expected Fail under 2 GiB")
	}
}

func TestPreflightUnsupportedOSFails(t *testing.T) {
	s := good()
	s.osID, s.osVr = "arch", ""
	if find(t, Preflight(context.Background(), s, PreflightOptions{}), "os").Status != Fail {
		t.Error("expected Fail")
	}
	s.osID, s.osVr = "debian", "12"
	if find(t, Preflight(context.Background(), s, PreflightOptions{}), "os").Status != Warn {
		t.Error("expected Warn for debian 12")
	}
	s.osID, s.osVr = "rocky", "9.4"
	if find(t, Preflight(context.Background(), s, PreflightOptions{}), "os").Status != Warn {
		t.Error("expected Warn for rocky 9")
	}
	for _, v := range []string{"22.04", "24.04", "26.04"} {
		s.osID, s.osVr = "ubuntu", v
		if c := find(t, Preflight(context.Background(), s, PreflightOptions{}), "os"); c.Status != Pass {
			t.Errorf("ubuntu %s: %v %q, want Pass", v, c.Status, c.Detail)
		}
	}
	s.osID, s.osVr = "ubuntu", "25.10" // interim release
	if find(t, Preflight(context.Background(), s, PreflightOptions{}), "os").Status != Fail {
		t.Error("expected Fail for a non-LTS Ubuntu")
	}
}

func TestPreflightPortsBusyOnExistingInstallPass(t *testing.T) {
	s := good()
	s.busy[80], s.busy[443] = true, true
	if find(t, Preflight(context.Background(), s, PreflightOptions{}), "port-80").Status != Fail {
		t.Error("expected Fail on fresh install")
	}
	c := find(t, Preflight(context.Background(), s, PreflightOptions{ExistingInstall: true}), "port-443")
	if c.Status != Pass || c.Detail != "in use by existing install" {
		t.Errorf("got %+v", c)
	}
}

func TestPreflightRootDiskDockerTimeEgress(t *testing.T) {
	s := good()
	s.root, s.disk = false, 10<<30
	s.dockerErr = errors.New("nope")
	s.synced = false
	s.httpErr["https://github.com"] = errors.New("timeout")
	cs := Preflight(context.Background(), s, PreflightOptions{})
	want := map[string]Status{"root": Fail, "disk": Fail, "docker": Warn, "time": Warn, "egress-github": Warn, "egress-docker": Pass}
	for id, st := range want {
		if got := find(t, cs, id).Status; got != st {
			t.Errorf("%s: got %v want %v", id, got, st)
		}
	}
	s.syncErr = errors.New("x")
	if d := find(t, Preflight(context.Background(), s, PreflightOptions{}), "time").Detail; d != "could not determine time sync status" {
		t.Errorf("detail %q", d)
	}
	if d := find(t, cs, "egress-github").Detail; d == "" {
		t.Error("egress detail should name host")
	}
}

// A fresh server has no Docker yet and the install adds it, so that is not
// a warning. Docker present but not answering is: the install would fail.
func TestPreflightDocker(t *testing.T) {
	s := good()
	s.dockerErr = ErrNotInstalled
	c := find(t, Preflight(context.Background(), s, PreflightOptions{}), "docker")
	if c.Status != Pass || !strings.Contains(c.Detail, "the install adds it") {
		t.Errorf("not installed: got %+v", c)
	}
	s.dockerErr = errors.New("Cannot connect to the Docker daemon")
	c = find(t, Preflight(context.Background(), s, PreflightOptions{}), "docker")
	if c.Status != Warn || !strings.Contains(c.Detail, "systemctl start docker") {
		t.Errorf("daemon down: got %+v", c)
	}
	s.dockerErr = nil
	if c = find(t, Preflight(context.Background(), s, PreflightOptions{}), "docker"); c.Status != Pass || c.Detail != "Docker 27.1" {
		t.Errorf("present: got %+v", c)
	}
}

func TestPreflightDiskPathSelection(t *testing.T) {
	s := good()
	s.dockerDir = true
	Preflight(context.Background(), s, PreflightOptions{})
	if s.diskPath != "/var/lib/docker" {
		t.Errorf("got %q", s.diskPath)
	}
	s.dockerDir = false
	Preflight(context.Background(), s, PreflightOptions{})
	if s.diskPath != "/" {
		t.Errorf("got %q", s.diskPath)
	}
}

// A re-run over a working install must not be blocked by the fresh-install
// disk floor: the install's own images and volumes already use that space.
// Found in the E2E run: 18.4 GiB free after a first install blocked
// Reconfigure. Only a nearly full disk still fails.
func TestPreflightDiskExistingInstall(t *testing.T) {
	s := good()
	s.disk = 18 << 30
	if c := find(t, Preflight(context.Background(), s, PreflightOptions{}), "disk"); c.Status != Fail {
		t.Errorf("fresh install with 18 GiB: got %v, want Fail", c.Status)
	}
	c := find(t, Preflight(context.Background(), s, PreflightOptions{ExistingInstall: true}), "disk")
	if c.Status != Warn {
		t.Errorf("existing install with 18 GiB: got %+v, want Warn", c)
	}
	s.disk = 4 << 30
	if c := find(t, Preflight(context.Background(), s, PreflightOptions{ExistingInstall: true}), "disk"); c.Status != Fail {
		t.Errorf("existing install with 4 GiB: got %v, want Fail", c.Status)
	}
	s.disk = 30 << 30
	if c := find(t, Preflight(context.Background(), s, PreflightOptions{ExistingInstall: true}), "disk"); c.Status != Pass {
		t.Errorf("existing install with 30 GiB: got %v, want Pass", c.Status)
	}
}
