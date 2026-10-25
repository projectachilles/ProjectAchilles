package cli

import (
	"bytes"
	"context"
	"errors"
	"os"
	"path/filepath"
	"strings"
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
