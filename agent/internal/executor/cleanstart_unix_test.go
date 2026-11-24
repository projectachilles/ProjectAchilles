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

// aliasOf makes <base>/alias a symlink to target and returns its path.
func aliasOf(t *testing.T, base, target string) string {
	t.Helper()
	alias := filepath.Join(base, "alias")
	if err := os.Symlink(target, alias); err != nil {
		t.Fatal(err)
	}
	return alias
}

func TestCleanArtifactDirKeepsAgentPathsReachedThroughASymlink(t *testing.T) {
	tmp := t.TempDir()
	dir := filepath.Join(tmp, "F0")
	now := time.Now()
	for _, f := range []string{"tasks/state.json", "agent.yaml", "rwdrv.sys"} {
		touch(t, filepath.Join(dir, f), now)
	}
	alias := aliasOf(t, tmp, dir)
	targets := cleanTargets{
		ArtifactDirs: []string{dir},
		WorkDir:      filepath.Join(alias, "tasks"),
		Protected:    []string{filepath.Join(alias, "tasks"), filepath.Join(alias, "agent.yaml")},
		Wide:         true,
	}
	var rep cleanReport
	cleanArtifactDir(dir, beforeRun, targets, lockbit, inOneMinute(), &rep)
	if got, want := names(t, dir), []string{"agent.yaml", "tasks"}; !equal(got, want) {
		t.Errorf("left %v, want %v", got, want)
	}
	if _, err := os.Stat(filepath.Join(dir, "tasks", "state.json")); err != nil {
		t.Errorf("tasks/state.json was removed: %v", err)
	}
}

func TestCleanArtifactDirTreatsAnAliasedWorkDirAsItself(t *testing.T) {
	tmp := t.TempDir()
	dir := filepath.Join(tmp, "F0")
	now := time.Now()
	for _, f := range []string{"state.json", "queue/a.json", "rwdrv.sys"} {
		touch(t, filepath.Join(dir, f), now)
	}
	alias := aliasOf(t, tmp, dir)
	targets := cleanTargets{ArtifactDirs: []string{dir}, WorkDir: alias, Protected: []string{alias}, Wide: true}
	var rep cleanReport
	cleanArtifactDir(dir, beforeRun, targets, lockbit, inOneMinute(), &rep)
	if got, want := names(t, dir), []string{"queue", "state.json"}; !equal(got, want) {
		t.Errorf("left %v, want %v", got, want)
	}
	if _, err := os.Stat(filepath.Join(dir, "queue", "a.json")); err != nil {
		t.Errorf("queue/a.json was removed: %v", err)
	}
}

func TestCleanDecoyDirSkipsWhenAnAgentPathIsInsideThroughASymlink(t *testing.T) {
	noAccount(t)
	tmp := t.TempDir()
	decoy := filepath.Join(tmp, "decoy")
	touch(t, filepath.Join(decoy, "a.txt"), time.Now())
	alias := aliasOf(t, tmp, decoy)
	tg := decoyTargets(decoy)
	tg.Protected = []string{filepath.Join(alias, "agent.log")}
	var rep cleanReport
	cleanDecoyDir(decoy, tg, inOneMinute(), &rep)
	if got, want := names(t, decoy), []string{"a.txt"}; !equal(got, want) {
		t.Errorf("left %v, want %v", got, want)
	}
}

func TestCleanArtifactDirKeepsALogFileThatDoesNotExistYet(t *testing.T) {
	tmp := t.TempDir()
	dir := filepath.Join(tmp, "F0")
	alias := aliasOf(t, tmp, dir)
	// The folder spelled as given and the same folder reached through a link.
	for name, base := range map[string]string{"as given": dir, "through a symlink": alias} {
		if err := os.MkdirAll(filepath.Join(dir, "agentlogs"), 0o700); err != nil {
			t.Fatal(err)
		}
		touch(t, filepath.Join(dir, "rwdrv.sys"), time.Now())
		targets := cleanTargets{
			ArtifactDirs: []string{dir},
			Protected:    []string{filepath.Join(base, "agentlogs", "agent.log")},
			Wide:         true,
		}
		var rep cleanReport
		cleanArtifactDir(dir, beforeRun, targets, lockbit, inOneMinute(), &rep)
		if got, want := names(t, dir), []string{"agentlogs"}; !equal(got, want) {
			t.Errorf("%s: left %v, want %v", name, got, want)
		}
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
