package cli

import (
	"archive/tar"
	"bytes"
	"compress/gzip"
	"context"
	"errors"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"syscall"
	"testing"

	"github.com/projectachilles/ProjectAchilles/installer/internal/engine"
)

type failCmd struct{}

func (failCmd) Run(context.Context, string, ...string) ([]byte, error) {
	return nil, errors.New("docker: not running")
}

func TestStatusExitsOneWhenUnhealthy(t *testing.T) {
	var out, errb bytes.Buffer
	r := NewRegistry("test")
	registerDay2(r, day2IO{stdin: strings.NewReader(""), stdout: &out, stderr: &errb, cmd: failCmd{}})
	code := r.Run([]string{"status", "--repo", t.TempDir(), "--ca-dir", t.TempDir() + "/none"}, &out, &errb)
	if code != 1 {
		t.Fatalf("exit %d, want 1; out=%s", code, out.String())
	}
	if !strings.Contains(out.String(), "unavailable") {
		t.Fatalf("out: %s", out.String())
	}
}

// recordCmd remembers whether any command ran.
type recordCmd struct{ ran *bool }

func (c recordCmd) Run(context.Context, string, ...string) ([]byte, error) {
	*c.ran = true
	return nil, nil
}

// The config files and the Docker socket are root-only: without root the
// day-2 commands would report a healthy install as broken.
func TestDay2CommandsNeedRoot(t *testing.T) {
	for _, name := range []string{"status", "upgrade", "backup", "restore"} {
		var out, errb bytes.Buffer
		ran := false
		r := NewRegistry("test")
		registerDay2(r, day2IO{stdin: strings.NewReader(""), stdout: &out, stderr: &errb,
			cmd: recordCmd{&ran}, isRoot: func() bool { return false }})
		code := r.Run([]string{name, "--repo", t.TempDir()}, &out, &errb)
		if code == 0 || ran {
			t.Errorf("%s: exit %d, ran=%v; want a failure before any command", name, code, ran)
		}
		if !strings.Contains(errb.String(), "sudo ") || !strings.Contains(errb.String(), name+" --repo") {
			t.Errorf("%s: stderr %q should say how to re-run it with sudo", name, errb.String())
		}
		errb.Reset()
		if code := r.Run([]string{name, "-h"}, &out, &errb); code != 0 {
			t.Errorf("%s -h: exit %d, want 0 without root; stderr=%s", name, code, errb.String())
		}
	}
}

func TestRestoreNeedsFile(t *testing.T) {
	var out, errb bytes.Buffer
	r := NewRegistry("test")
	registerDay2(r, day2IO{stdin: strings.NewReader(""), stdout: &out, stderr: &errb, cmd: failCmd{}})
	if code := r.Run([]string{"restore"}, &out, &errb); code == 0 {
		t.Fatal("restore without FILE must fail")
	}
}

// releaseGit answers Upgrade's git calls: clean tree, at v2.3.0, v2.4.0 out.
type releaseGit struct{}

func (releaseGit) Run(_ context.Context, name string, args ...string) ([]byte, error) {
	s := name + " " + strings.Join(args, " ")
	switch {
	case strings.Contains(s, "tag --list"):
		return []byte("v2.3.0\nv2.4.0\n"), nil
	case strings.Contains(s, "describe"):
		return []byte("v2.3.0\n"), nil
	}
	return nil, nil
}

func TestUpgradeNamesThisBinarysVersion(t *testing.T) {
	var out, errb bytes.Buffer
	repo := t.TempDir()
	if err := os.WriteFile(filepath.Join(repo, "deploy.config.env"), []byte("TLS_MODE=internal\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	r := NewRegistry("v2.3.0")
	registerDay2(r, day2IO{
		stdin: strings.NewReader(""), stdout: &out, stderr: &errb, cmd: releaseGit{},
		newRunner: func(string, string, string) (engine.Starter, error) {
			return nil, errors.New("engine not run in this test")
		},
	})
	r.Run([]string{"upgrade", "--repo", repo, "--yes"}, &out, &errb)
	if want := "This installer binary is v2.3.0; the checkout is now v2.4.0."; !strings.Contains(out.String(), want) {
		t.Fatalf("want %q in:\n%s\n%s", want, out.String(), errb.String())
	}
}

// `nohup achilles-installer upgrade` starts with SIGHUP ignored: catching it
// anyway would cancel the upgrade when the SSH session drops.
func TestSignalsToCatch(t *testing.T) {
	has := func(sigs []os.Signal, s os.Signal) bool { return slices.Contains(sigs, s) }
	got := signalsToCatch(func(os.Signal) bool { return false })
	if !has(got, os.Interrupt) || !has(got, syscall.SIGTERM) || !has(got, syscall.SIGHUP) {
		t.Fatalf("not ignored: %v", got)
	}
	got = signalsToCatch(func(s os.Signal) bool { return s == syscall.SIGHUP })
	if !has(got, os.Interrupt) || !has(got, syscall.SIGTERM) || has(got, syscall.SIGHUP) {
		t.Fatalf("SIGHUP ignored (nohup): %v", got)
	}
}

// restoreArchive writes a minimal backup: a MANIFEST and the given files
// (archive name -> content).
func restoreArchive(t *testing.T, files map[string]string) string {
	t.Helper()
	p := filepath.Join(t.TempDir(), "b.tar.gz")
	fh, err := os.Create(p)
	if err != nil {
		t.Fatal(err)
	}
	gz := gzip.NewWriter(fh)
	tw := tar.NewWriter(gz)
	files["MANIFEST"] = "projectachilles backup\n"
	for name, body := range files {
		if err := tw.WriteHeader(&tar.Header{Name: name, Typeflag: tar.TypeReg, Mode: 0o600, Size: int64(len(body))}); err != nil {
			t.Fatal(err)
		}
		if _, err := tw.Write([]byte(body)); err != nil {
			t.Fatal(err)
		}
	}
	if err := errors.Join(tw.Close(), gz.Close(), fh.Close()); err != nil {
		t.Fatal(err)
	}
	return p
}

// restore re-runs the engine the way install --config … --yes does: on the
// restored <repo>/deploy.config.env, with this restore's CA directory.
func TestRestoreRunsEngineOnRestoredConfig(t *testing.T) {
	repo, caDir := t.TempDir(), filepath.Join(t.TempDir(), "ca")
	p := restoreArchive(t, map[string]string{
		// 127.0.0.1 is on every host, so the real address check passes.
		"files/deploy.config.env": "ACHILLES_DOMAIN='achilles.test'\nTLS_MODE='internal'\nCADDY_BIND_IP='127.0.0.1'\n",
		"files/.env":              "COMPOSE_PROJECT_NAME=achilles-server\n",
	})
	var out, errb bytes.Buffer
	var got []string
	r := NewRegistry("test")
	registerDay2(r, day2IO{
		stdin: strings.NewReader(""), stdout: &out, stderr: &errb, cmd: recordCmd{new(bool)},
		newRunner: func(root, cfgPath, ca string) (engine.Starter, error) {
			got = []string{root, cfgPath, ca}
			return okRun{}, nil
		},
	})
	if code := r.Run([]string{"restore", p, "--yes", "--repo", repo, "--ca-dir", caDir}, &out, &errb); code != 0 {
		t.Fatalf("exit %d: %s\n%s", code, errb.String(), out.String())
	}
	if want := []string{repo, filepath.Join(repo, "deploy.config.env"), caDir}; !slices.Equal(got, want) {
		t.Fatalf("engine runner = %q, want %q", got, want)
	}
	if !strings.Contains(out.String(), "==> Rendering") {
		t.Fatalf("engine events not printed:\n%s", out.String())
	}
}

// okRun is an engine run that emits one phase and succeeds.
type okRun struct{}

func (okRun) Start(context.Context) (<-chan engine.Event, func() error, error) {
	ch := make(chan engine.Event, 1)
	ch <- engine.Event{Kind: engine.Phase, ID: "caddy-render", Text: "Rendering"}
	close(ch)
	return ch, func() error { return nil }, nil
}

// A failed engine run after a restore keeps the engine's exit status and
// tells the operator how to finish.
func TestRestoreEngineFailureSaysHowToFinish(t *testing.T) {
	repo := t.TempDir()
	p := restoreArchive(t, map[string]string{
		"files/deploy.config.env": "ACHILLES_DOMAIN='achilles.test'\nTLS_MODE='internal'\n",
		"files/.env":              "COMPOSE_PROJECT_NAME=achilles-server\n",
	})
	var out, errb bytes.Buffer
	r := NewRegistry("test")
	registerDay2(r, day2IO{
		stdin: strings.NewReader(""), stdout: &out, stderr: &errb, cmd: recordCmd{new(bool)},
		newRunner: func(string, string, string) (engine.Starter, error) {
			return scripted{err: exitCode(3)}, nil
		},
	})
	code := r.Run([]string{"restore", p, "--yes", "--repo", repo}, &out, &errb)
	if code != 3 {
		t.Fatalf("exit %d, want the engine's 3; stderr %s", code, errb.String())
	}
	want := "sudo " + filepath.Join(repo, "achilles-installer") + " install --config " + filepath.Join(repo, "deploy.config.env") + " --yes"
	if got := out.String() + errb.String(); !strings.Contains(got, want) {
		t.Fatalf("want %q in:\n%s", want, got)
	}
}
