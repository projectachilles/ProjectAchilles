//go:build !windows

package executor

import (
	"os"
	"path/filepath"
	"reflect"
	"testing"
	"time"
)

func TestCleanArtifactDirRemovesASymlinkNotItsTarget(t *testing.T) {
	outside := filepath.Join(t.TempDir(), "outside")
	secret := filepath.Join(outside, "secret.txt")
	touch(t, secret, time.Now())
	dir := filepath.Join(t.TempDir(), "F0")
	if err := os.MkdirAll(dir, 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(outside, filepath.Join(dir, "link")); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(secret, filepath.Join(dir, "flink")); err != nil {
		t.Fatal(err)
	}
	var rep cleanReport
	cleanArtifactDir(dir, beforeRun, cleanTargets{Wide: true}, lockbit, inOneMinute(), &rep)
	if got := names(t, dir); len(got) != 0 {
		t.Errorf("links left: %v", got)
	}
	if _, err := os.Stat(secret); err != nil {
		t.Errorf("the link target was removed: %v", err)
	}
}

func TestCleanArtifactDirRefusesASymlinkedDir(t *testing.T) {
	real := filepath.Join(t.TempDir(), "real")
	touch(t, filepath.Join(real, "rwdrv.sys"), time.Now())
	link := filepath.Join(t.TempDir(), "F0")
	if err := os.Symlink(real, link); err != nil {
		t.Fatal(err)
	}
	var rep cleanReport
	cleanArtifactDir(link, beforeRun, cleanTargets{Wide: true}, lockbit, inOneMinute(), &rep)
	if got, want := names(t, real), []string{"rwdrv.sys"}; !equal(got, want) {
		t.Errorf("followed a symlinked dir: left %v", got)
	}
	if !reflect.DeepEqual(rep, cleanReport{}) {
		t.Errorf("rep = %+v, want zero", rep)
	}
}

func TestCleanArtifactDirCountsAFailureAndGoesOn(t *testing.T) {
	if os.Geteuid() == 0 {
		t.Skip("root ignores directory modes")
	}
	dir := filepath.Join(t.TempDir(), "F0")
	touch(t, filepath.Join(dir, "locked", "a.txt"), time.Now())
	touch(t, filepath.Join(dir, "rwdrv.sys"), time.Now())
	locked := filepath.Join(dir, "locked")
	if err := os.Chmod(locked, 0o500); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { os.Chmod(locked, 0o700) })
	var rep cleanReport
	cleanArtifactDir(dir, beforeRun, cleanTargets{Wide: true}, lockbit, inOneMinute(), &rep)
	if got, want := names(t, dir), []string{"locked"}; !equal(got, want) {
		t.Errorf("left %v, want %v", got, want)
	}
	if rep.Failed != 1 {
		t.Errorf("Failed = %d, want 1", rep.Failed)
	}
}

func TestCleanDecoyDirRemovesASymlinkNotItsTarget(t *testing.T) {
	noAccount(t)
	outside := filepath.Join(t.TempDir(), "outside")
	keep := filepath.Join(outside, "keep.txt")
	touch(t, keep, time.Now())
	decoy := filepath.Join(t.TempDir(), "fortika-test")
	if err := os.MkdirAll(decoy, 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(outside, filepath.Join(decoy, "link")); err != nil {
		t.Fatal(err)
	}
	var rep cleanReport
	cleanDecoyDir(decoy, decoyTargets(decoy), inOneMinute(), &rep)
	if got := names(t, decoy); len(got) != 0 {
		t.Errorf("link left: %v", got)
	}
	if _, err := os.Stat(keep); err != nil {
		t.Errorf("the link target was removed: %v", err)
	}
}

func TestCleanDecoyDirSkipsAWorldWritableDir(t *testing.T) {
	noAccount(t)
	decoy := filepath.Join(t.TempDir(), "fortika-test")
	touch(t, filepath.Join(decoy, "a.txt"), time.Now())
	if err := os.Chmod(decoy, 0o777); err != nil {
		t.Fatal(err)
	}
	var rep cleanReport
	cleanDecoyDir(decoy, decoyTargets(decoy), inOneMinute(), &rep)
	if got, want := names(t, decoy), []string{"a.txt"}; !equal(got, want) {
		t.Errorf("left %v, want %v", got, want)
	}
}
