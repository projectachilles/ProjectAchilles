package cli

import (
	"bytes"
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func installRegistry(t *testing.T, term string) (*Registry, *bytes.Buffer, *bytes.Buffer) {
	t.Helper()
	r := NewRegistry("dev")
	var out, errb bytes.Buffer
	in, w, err := os.Pipe() // not a TTY
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { in.Close(); w.Close() })
	registerInstall(r, installIO{
		stdin: in, stdout: w, stderr: &errb,
		getenv: func(k string) string {
			if k == "TERM" {
				return term
			}
			return ""
		},
	})
	return r, &out, &errb
}

func TestInstallRefusesWithoutTTY(t *testing.T) {
	for _, term := range []string{"xterm-256color", "dumb"} {
		r, _, errb := installRegistry(t, term)
		code := r.Run([]string{"install"}, &bytes.Buffer{}, errb)
		if code == 0 {
			t.Fatalf("TERM=%s: exit 0 without a TTY", term)
		}
		if !strings.Contains(errb.String(), "install --config FILE --yes") {
			t.Errorf("TERM=%s: stderr %q does not point to install --config FILE --yes", term, errb)
		}
	}
}

func TestInstallNoArgsIsInstall(t *testing.T) {
	r, _, errb := installRegistry(t, "xterm")
	if code := r.Run(nil, &bytes.Buffer{}, errb); code == 0 || !strings.Contains(errb.String(), "--config FILE --yes") {
		t.Fatalf("code=%d stderr=%q", code, errb)
	}
}

func TestInstallRejectsStrayArgs(t *testing.T) {
	r, _, errb := installRegistry(t, "xterm")
	if code := r.Run([]string{"install", "extra"}, &bytes.Buffer{}, errb); code == 0 {
		t.Fatalf("stray argument accepted: %q", errb)
	}
}

// The wizard's Upgrade/Status choice hands off with the wizard's own --repo
// and --ca-dir; without them the command would act on the default checkout
// and CA directory.
func TestInstallHandOffKeepsRepoAndCADir(t *testing.T) {
	for _, name := range []string{"upgrade", "status"} {
		r := NewRegistry("dev")
		var got []string
		r.Register(name, func(_ context.Context, args []string) error {
			got = args
			return nil
		})
		if err := handOff(r, name, "/srv/pa", "/srv/ca", &bytes.Buffer{}, &bytes.Buffer{}); err != nil {
			t.Fatalf("%s: %v", name, err)
		}
		if want := "--repo /srv/pa --ca-dir /srv/ca"; strings.Join(got, " ") != want {
			t.Errorf("%s hand-off args = %q, want %q", name, got, want)
		}
	}
}

// The real day-2 commands accept the hand-off's flags.
func TestDay2CommandsAcceptHandOffFlags(t *testing.T) {
	r := NewRegistry("dev")
	var errb bytes.Buffer
	registerDay2(r, day2IO{stdin: strings.NewReader(""), stdout: &bytes.Buffer{}, stderr: &errb, cmd: failCmd{}, tty: func() bool { return false }})
	for _, name := range []string{"upgrade", "status"} {
		errb.Reset()
		r.Run([]string{name, "--repo", t.TempDir(), "--ca-dir", t.TempDir()}, &bytes.Buffer{}, &errb)
		if strings.Contains(errb.String(), "flag provided but not defined") {
			t.Errorf("%s rejects the hand-off flags: %s", name, errb.String())
		}
	}
}

// `install --config X` puts the effective config into the checkout, where
// backup finds it, and runs the engine on that copy.
func TestInstallCopiesConfigIntoCheckout(t *testing.T) {
	cfg := validConfig(t) // in a temp dir, outside the checkout
	want, err := os.ReadFile(cfg)
	if err != nil {
		t.Fatal(err)
	}
	repo := t.TempDir()
	r, calls, b := unattendedRegistry(t, scripted{})
	var out, errb bytes.Buffer
	if code := r.Run([]string{"install", "--config", cfg, "--yes", "--repo", repo}, &out, &errb); code != 0 {
		t.Fatalf("exit %d: %s", code, b.err.String())
	}
	dst := filepath.Join(repo, "deploy.config.env")
	got, err := os.ReadFile(dst)
	if err != nil {
		t.Fatalf("config not copied into the checkout: %v", err)
	}
	if string(got) != string(want) {
		t.Fatalf("copy differs:\n%s\nwant:\n%s", got, want)
	}
	if fi, _ := os.Stat(dst); fi.Mode().Perm() != 0o600 {
		t.Fatalf("copy mode %v, want 0600", fi.Mode().Perm())
	}
	if len(*calls) != 1 || (*calls)[0].cfgPath != dst || (*calls)[0].root != repo {
		t.Fatalf("engine calls = %+v, want the checkout's copy %s", *calls, dst)
	}
	if _, err := os.Stat(cfg); err != nil {
		t.Fatalf("the original must stay: %v", err)
	}
}

// A config that already is <repo>/deploy.config.env is used in place.
func TestInstallConfigAlreadyInCheckoutNotCopied(t *testing.T) {
	src := validConfig(t)
	repo := filepath.Dir(src) // validConfig wrote <dir>/deploy.config.env
	if err := os.Chmod(src, 0o640); err != nil {
		t.Fatal(err)
	}
	before, _ := os.Stat(src)
	r, calls, b := unattendedRegistry(t, scripted{})
	var out, errb bytes.Buffer
	// Reached through a path that is not literally <repo>/deploy.config.env.
	via := filepath.Join(repo, ".", "deploy.config.env")
	if code := r.Run([]string{"install", "--config", via, "--yes", "--repo", repo}, &out, &errb); code != 0 {
		t.Fatalf("exit %d: %s", code, b.err.String())
	}
	after, _ := os.Stat(src)
	if !os.SameFile(before, after) || after.Mode().Perm() != 0o640 {
		t.Fatalf("the file in the checkout was replaced or re-moded (%v)", after.Mode().Perm())
	}
	ents, _ := os.ReadDir(repo)
	if len(ents) != 1 {
		t.Fatalf("stray files in the checkout: %v", ents)
	}
	if len(*calls) != 1 || (*calls)[0].cfgPath != src {
		t.Fatalf("engine calls = %+v, want %s", *calls, src)
	}
}
