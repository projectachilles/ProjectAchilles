//go:build windows

package executor

import (
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestCleanArtifactDirKeepsAProtectedPathThatDiffersInCase(t *testing.T) {
	dir := filepath.Join(t.TempDir(), "F0")
	now := time.Now()
	touch(t, filepath.Join(dir, "Tasks", "state.json"), now)
	touch(t, filepath.Join(dir, "rwdrv.sys"), now)
	targets := cleanTargets{
		ArtifactDirs: []string{dir},
		Protected:    []string{strings.ToUpper(filepath.Join(dir, "TASKS"))},
		Wide:         true,
	}
	var rep cleanReport
	cleanArtifactDir(dir, beforeRun, targets, lockbit, inOneMinute(), &rep)
	if got, want := names(t, dir), []string{"Tasks"}; !equal(got, want) {
		t.Errorf("left %v, want %v", got, want)
	}
	if _, err := os.Stat(filepath.Join(dir, "Tasks", "state.json")); err != nil {
		t.Errorf(`Tasks\state.json was removed: %v`, err)
	}
}

func TestCleanArtifactDirRemovesAJunctionNotItsTarget(t *testing.T) {
	tmp := t.TempDir()
	keep := filepath.Join(tmp, "outside", "keep.txt")
	touch(t, keep, time.Now())
	dir := filepath.Join(tmp, "F0")
	if err := os.MkdirAll(dir, 0o700); err != nil {
		t.Fatal(err)
	}
	link := filepath.Join(dir, "link")
	if out, err := exec.Command("cmd", "/c", "mklink", "/J", link, filepath.Join(tmp, "outside")).CombinedOutput(); err != nil {
		t.Skipf("mklink /J failed: %v: %s", err, out)
	}
	var rep cleanReport
	cleanArtifactDir(dir, beforeRun, cleanTargets{ArtifactDirs: []string{dir}, Wide: true}, lockbit, inOneMinute(), &rep)
	if got := names(t, dir); len(got) != 0 {
		t.Errorf("junction left: %v", got)
	}
	if _, err := os.Stat(keep); err != nil {
		t.Errorf("the junction target was removed: %v", err)
	}
}
