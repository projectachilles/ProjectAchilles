//go:build !windows

package executor

import (
	"os"
	"path/filepath"
	"testing"
	"time"
)

// /tmp/F0 lives in world-writable /tmp: a local user could pre-create it or
// symlink it elsewhere and steer the root agent's deletions. The cleanup must
// refuse any artifact folder that is a symlink, not owned by root (or the
// agent's own user), or writable by group / others.

func TestRemoveTestBinariesRefusesASymlinkedArtifactDir(t *testing.T) {
	target := t.TempDir()
	touch(t, filepath.Join(target, lockbit+"-t1486"), time.Now())
	link := filepath.Join(t.TempDir(), "F0")
	if err := os.Symlink(target, link); err != nil {
		t.Fatal(err)
	}
	if removed := removeTestBinaries(link, lockbit); len(removed) != 0 {
		t.Fatalf("followed a symlinked artifact dir: removed %v", removed)
	}
	SweepStale(t.TempDir(), []string{link}, 0, time.Now().Add(time.Hour))
	if got := names(t, target); len(got) != 1 {
		t.Fatalf("sweep followed a symlinked artifact dir: left %v", got)
	}
}

func TestRemoveTestBinariesRefusesAGroupOrWorldWritableDir(t *testing.T) {
	for _, mode := range []os.FileMode{0o777, 0o775, 0o757} {
		dir := t.TempDir()
		touch(t, filepath.Join(dir, lockbit+"-t1486"), time.Now())
		if err := os.Chmod(dir, mode); err != nil {
			t.Fatal(err)
		}
		if removed := removeTestBinaries(dir, lockbit); len(removed) != 0 {
			t.Errorf("mode %o: removed %v from a dir others can write", mode, removed)
		}
	}
}

func TestRemoveTestBinariesRefusesADirOwnedBySomeoneElse(t *testing.T) {
	if os.Geteuid() != 0 {
		t.Skip("needs root to chown")
	}
	dir := t.TempDir()
	touch(t, filepath.Join(dir, lockbit+"-t1486"), time.Now())
	if err := os.Chown(dir, 1000, 1000); err != nil {
		t.Fatal(err)
	}
	if removed := removeTestBinaries(dir, lockbit); len(removed) != 0 {
		t.Fatalf("removed %v from a dir owned by uid 1000", removed)
	}
}

func TestRemoveTestBinariesCleansARootOwnedPrivateDir(t *testing.T) {
	dir := t.TempDir()
	touch(t, filepath.Join(dir, lockbit+"-t1486"), time.Now())
	if err := os.Chmod(dir, 0o755); err != nil {
		t.Fatal(err)
	}
	if removed := removeTestBinaries(dir, lockbit); len(removed) != 1 {
		t.Fatalf("a 0755 dir owned by the agent's user must be cleaned, removed %v", removed)
	}
}
