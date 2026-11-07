package executor

import (
	"os"
	"path/filepath"
	"sort"
	"testing"
	"time"
)

const (
	lockbit = "298cc137-ea39-4cf0-9b2d-b1c59a3cbacb"
	lumma   = "26a8b54e-0000-4000-8000-000000000001"
)

func touch(t *testing.T, path string, mtime time.Time) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte("x"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.Chtimes(path, mtime, mtime); err != nil {
		t.Fatal(err)
	}
}

func names(t *testing.T, dir string) []string {
	t.Helper()
	entries, err := os.ReadDir(dir)
	if err != nil {
		t.Fatal(err)
	}
	var out []string
	for _, e := range entries {
		out = append(out, e.Name())
	}
	sort.Strings(out)
	return out
}

func TestIsTestBinary(t *testing.T) {
	cases := []struct {
		name string
		uuid string // "" = any test
		want bool
	}{
		{lockbit + ".exe", lockbit, true},
		{lockbit + "-t1486.exe", lockbit, true},
		{lockbit + "-T1003.001.exe", lockbit, true},
		{lockbit + "-t1211-cfapi.exe", lockbit, true},
		{lockbit + "-t1486", lockbit, true}, // Linux / macOS stage binary
		{"298CC137-EA39-4CF0-9B2D-B1C59A3CBACB-T1486.EXE", lockbit, true},
		{lumma + "-t1055.exe", lockbit, false}, // another test
		{lumma + "-t1055.exe", "", true},
		{lockbit + "-t1486.exe_output.txt", lockbit, false},
		{"bundle_results.json", lockbit, false},
		{"achilles-agent-windows-amd64.exe", "", false},
		{"achilles-agent-windows-amd64.exe.old", "", false},
		{"lsass.dmp", "", false},
	}
	for _, c := range cases {
		if got := isTestBinary(c.name, c.uuid); got != c.want {
			t.Errorf("isTestBinary(%q, %q) = %v, want %v", c.name, c.uuid, got, c.want)
		}
	}
}

func TestRemoveTestBinariesOnlyRemovesThisTestsBinaries(t *testing.T) {
	dir := t.TempDir()
	now := time.Now()
	for _, n := range []string{
		lockbit + ".exe", lockbit + "-t1486.exe", lockbit + "-t1003.001.exe",
		lumma + "-t1055.exe", lockbit + "-t1486.exe_output.txt",
		"achilles-agent-windows-amd64.exe", "achilles-agent.yaml", "bundle_results.json",
	} {
		touch(t, filepath.Join(dir, n), now)
	}
	if err := os.Mkdir(filepath.Join(dir, lockbit+"-dir.exe"), 0o700); err != nil {
		t.Fatal(err)
	}

	removed := removeTestBinaries(dir, lockbit)

	if len(removed) != 3 {
		t.Fatalf("removed %v, want the 3 LockBit binaries", removed)
	}
	want := []string{
		lumma + "-t1055.exe", lockbit + "-dir.exe", lockbit + "-t1486.exe_output.txt",
		"achilles-agent-windows-amd64.exe", "achilles-agent.yaml", "bundle_results.json",
	}
	sort.Strings(want)
	if got := names(t, dir); !equal(got, want) {
		t.Errorf("left %v, want %v", got, want)
	}
}

func TestRemoveTestBinariesToleratesAMissingDir(t *testing.T) {
	if removed := removeTestBinaries(filepath.Join(t.TempDir(), "absent"), lockbit); len(removed) != 0 {
		t.Errorf("removed %v from a missing dir", removed)
	}
	if removed := removeTestBinaries(t.TempDir(), ""); len(removed) != 0 {
		t.Errorf("an empty test UUID must remove nothing, removed %v", removed)
	}
}

func TestSweepStaleRemovesOldRunLeftoversOnly(t *testing.T) {
	work := t.TempDir()
	artifacts := t.TempDir()
	now := time.Now()
	old := now.Add(-2 * time.Hour)
	recent := now.Add(-10 * time.Minute)

	touch(t, filepath.Join(work, "task-aaa-111", lockbit+".exe"), old)
	touch(t, filepath.Join(work, "cmd-bbb-222", "out.txt"), old)
	touch(t, filepath.Join(work, "task-ccc-333", lockbit+".exe"), recent)
	touch(t, filepath.Join(work, "queue", "r1.json"), old) // the result queue
	touch(t, filepath.Join(work, "state.json"), old)
	for _, d := range []string{"task-aaa-111", "cmd-bbb-222", "queue"} {
		if err := os.Chtimes(filepath.Join(work, d), old, old); err != nil {
			t.Fatal(err)
		}
	}
	if err := os.Chtimes(filepath.Join(work, "task-ccc-333"), recent, recent); err != nil {
		t.Fatal(err)
	}

	touch(t, filepath.Join(artifacts, lockbit+"-t1486.exe"), old)
	touch(t, filepath.Join(artifacts, lumma+".exe"), old)
	touch(t, filepath.Join(artifacts, lockbit+"-t1003.001.exe"), recent)
	touch(t, filepath.Join(artifacts, "achilles-agent-windows-amd64.exe"), old)
	touch(t, filepath.Join(artifacts, "achilles-agent.log"), old)
	touch(t, filepath.Join(artifacts, lockbit+"-t1486.exe_output.txt"), old)

	SweepStale(work, []string{artifacts}, time.Hour, now)

	if got, want := names(t, work), []string{"queue", "state.json", "task-ccc-333"}; !equal(got, want) {
		t.Errorf("work dir left %v, want %v", got, want)
	}
	if got := names(t, filepath.Join(work, "queue")); !equal(got, []string{"r1.json"}) {
		t.Errorf("queue touched: %v", got)
	}
	wantArtifacts := []string{lockbit + "-t1003.001.exe", lockbit + "-t1486.exe_output.txt", "achilles-agent-windows-amd64.exe", "achilles-agent.log"}
	sort.Strings(wantArtifacts)
	if got := names(t, artifacts); !equal(got, wantArtifacts) {
		t.Errorf("artifact dir left %v, want %v", got, wantArtifacts)
	}
}

func equal(a, b []string) bool {
	if len(a) != len(b) {
		return false
	}
	for i := range a {
		if a[i] != b[i] {
			return false
		}
	}
	return true
}
