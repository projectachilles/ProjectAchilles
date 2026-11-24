package executor

import (
	"os"
	"path/filepath"
	"sort"
	"testing"
	"time"
)

func TestIsAgentFile(t *testing.T) {
	keep := []string{"achilles-agent.exe", "achilles-agent.exe.old", "achilles-agent.exe.replaced",
		"achilles-agent.yaml", "achilles-agent.log", "Achilles-Agent.EXE",
		".config-123456.tmp", ".achilles-agent-install-98765"}
	drop := []string{"rwdrv.sys", "sliver_client.exe", "MsMpEng.exe", ".config-123456", "config.tmp",
		"298cc137-ea39-4cf0-9b2d-b1c59a3cbacb.exe", "tasks"}
	for _, n := range keep {
		if !isAgentFile(n) {
			t.Errorf("isAgentFile(%q) = false, want true", n)
		}
	}
	for _, n := range drop {
		if isAgentFile(n) {
			t.Errorf("isAgentFile(%q) = true, want false", n)
		}
	}
}

func TestIsUndoFileKeepsEveryKnownUndoFile(t *testing.T) {
	undo := []string{"cleanup_utility.exe", "registry_run_key_state.txt", "scheduled_task_state.txt",
		"tailscale_cleanup.exe", "original_service_state.json", "original_openssh_state.json",
		"tailscale.state", "esxi_cleanup", "bluenoroff_cleanup", "emergency_restore.ps1",
		"patch_backup.json", "watchdog_state.json", "Emergency_RESTORE.ps1"}
	notUndo := []string{"rwdrv.sys", "exfil_staging", "credential_staging", "WinRAR.exe",
		"recon_summary.txt", "setup.msi"}
	for _, n := range undo {
		if !isUndoFile(n) {
			t.Errorf("isUndoFile(%q) = false, want true", n)
		}
	}
	for _, n := range notUndo {
		if isUndoFile(n) {
			t.Errorf("isUndoFile(%q) = true, want false", n)
		}
	}
}

func TestKeepInArtifactDir(t *testing.T) {
	tops := []string{"tasks", "certs"}
	both := []string{"achilles-agent.exe", "tasks", "TASKS", "certs", "cleanup_utility.exe"}
	afterOnly := []string{"test_execution_log.json", "test_execution_log.txt", "bundle_results.json",
		"Test_Execution_Log.JSON"}
	neither := []string{"rwdrv.sys", "exfil_staging", lockbit + "-T1486.exe"}
	for _, n := range both {
		for _, p := range []cleanPass{beforeRun, afterRun} {
			if !keepInArtifactDir(n, p, tops) {
				t.Errorf("keepInArtifactDir(%q, %d) = false, want true", n, p)
			}
		}
	}
	for _, n := range afterOnly {
		if keepInArtifactDir(n, beforeRun, tops) {
			t.Errorf("keepInArtifactDir(%q, beforeRun) = true, want false", n)
		}
		if !keepInArtifactDir(n, afterRun, tops) {
			t.Errorf("keepInArtifactDir(%q, afterRun) = false, want true", n)
		}
	}
	for _, n := range neither {
		for _, p := range []cleanPass{beforeRun, afterRun} {
			if keepInArtifactDir(n, p, tops) {
				t.Errorf("keepInArtifactDir(%q, %d) = true, want false", n, p)
			}
		}
	}
}

func TestProtectedTops(t *testing.T) {
	tmp := t.TempDir()
	dir := filepath.Join(tmp, "F0")
	protected := []string{
		filepath.Join(dir, "achilles-agent.exe"),
		filepath.Join(dir, "conf", "agent.yaml"),
		filepath.Join(dir, "tasks"),
		filepath.Join(tmp, "elsewhere", "agent.log"),
		"",
	}
	tops, self := protectedTops(dir, protected)
	if want := []string{"achilles-agent.exe", "conf", "tasks"}; !equal(tops, want) || self {
		t.Errorf("protectedTops = %v, %v; want %v, false", tops, self, want)
	}
	if _, self := protectedTops(dir, []string{dir}); !self {
		t.Error("the work dir itself did not set selfIsWorkDir")
	}
}

// fillArtifactDir builds the folder the clean-start tests share.
func fillArtifactDir(t *testing.T, dir string) cleanTargets {
	t.Helper()
	now := time.Now()
	for _, f := range []string{
		"achilles-agent.exe", "achilles-agent.yaml", "achilles-agent.log", ".config-1.tmp",
		"tasks/state.json", "tasks/queue/a.json", "cleanup_utility.exe", "registry_run_key_state.txt",
		"rwdrv.sys", "sliver_client.exe", lockbit + "-T1486.exe", "exfil_staging/a/b.txt",
		"test_execution_log.json", "bundle_results.json",
	} {
		touch(t, filepath.Join(dir, f), now)
	}
	return cleanTargets{
		ArtifactDirs: []string{dir},
		WorkDir:      filepath.Join(dir, "tasks"),
		Protected: []string{
			filepath.Join(dir, "achilles-agent.exe"), filepath.Join(dir, "achilles-agent.yaml"),
			filepath.Join(dir, "achilles-agent.log"), filepath.Join(dir, "tasks"),
		},
		Wide: true,
	}
}

func inOneMinute() time.Time { return time.Now().Add(time.Minute) }

func TestCleanArtifactDirBeforeRunRemovesEverythingButAgentAndUndoFiles(t *testing.T) {
	dir := filepath.Join(t.TempDir(), "F0")
	targets := fillArtifactDir(t, dir)
	var rep cleanReport
	cleanArtifactDir(dir, beforeRun, targets, lockbit, inOneMinute(), &rep)
	want := []string{".config-1.tmp", "achilles-agent.exe", "achilles-agent.log", "achilles-agent.yaml",
		"cleanup_utility.exe", "registry_run_key_state.txt", "tasks"}
	if got := names(t, dir); !equal(got, want) {
		t.Errorf("left %v, want %v", got, want)
	}
	for _, f := range []string{"tasks/state.json", "tasks/queue/a.json"} {
		if _, err := os.Stat(filepath.Join(dir, f)); err != nil {
			t.Errorf("%s was removed: %v", f, err)
		}
	}
	sort.Strings(rep.Removed)
	wantRemoved := []string{lockbit + "-T1486.exe", "bundle_results.json", "exfil_staging", "rwdrv.sys",
		"sliver_client.exe", "test_execution_log.json"}
	if !equal(rep.Removed, wantRemoved) || rep.Failed != 0 {
		t.Errorf("rep = %+v, want Removed %v and no failures", rep, wantRemoved)
	}
}

func TestCleanArtifactDirAfterRunKeepsTheLastRunsLog(t *testing.T) {
	dir := filepath.Join(t.TempDir(), "F0")
	targets := fillArtifactDir(t, dir)
	var rep cleanReport
	cleanArtifactDir(dir, afterRun, targets, lockbit, inOneMinute(), &rep)
	got := names(t, dir)
	has := map[string]bool{}
	for _, n := range got {
		has[n] = true
	}
	for _, n := range []string{"test_execution_log.json", "bundle_results.json"} {
		if !has[n] {
			t.Errorf("%s was removed after the run", n)
		}
	}
	for _, n := range []string{"rwdrv.sys", "exfil_staging"} {
		if has[n] {
			t.Errorf("%s survived the after pass", n)
		}
	}
}

func TestCleanArtifactDirFailsClosedWithoutAgentPaths(t *testing.T) {
	dir := filepath.Join(t.TempDir(), "F0")
	now := time.Now()
	for _, f := range []string{"rwdrv.sys", lockbit + ".exe", lumma + ".exe"} {
		touch(t, filepath.Join(dir, f), now)
	}
	var rep cleanReport
	cleanArtifactDir(dir, beforeRun, cleanTargets{ArtifactDirs: []string{dir}}, lockbit, inOneMinute(), &rep)
	if got, want := names(t, dir), []string{lumma + ".exe", "rwdrv.sys"}; !equal(got, want) {
		t.Errorf("left %v, want %v", got, want)
	}
	if want := []string{lockbit + ".exe"}; !equal(rep.Removed, want) {
		t.Errorf("Removed = %v, want %v", rep.Removed, want)
	}
}

func TestCleanArtifactDirKeepsStateAndQueueWhenItIsTheWorkDir(t *testing.T) {
	dir := filepath.Join(t.TempDir(), "F0")
	now := time.Now()
	for _, f := range []string{"state.json", "queue/a.json", "rwdrv.sys"} {
		touch(t, filepath.Join(dir, f), now)
	}
	targets := cleanTargets{ArtifactDirs: []string{dir}, WorkDir: dir, Protected: []string{dir}, Wide: true}
	var rep cleanReport
	cleanArtifactDir(dir, beforeRun, targets, lockbit, inOneMinute(), &rep)
	if got, want := names(t, dir), []string{"queue", "state.json"}; !equal(got, want) {
		t.Errorf("left %v, want %v", got, want)
	}
	if _, err := os.Stat(filepath.Join(dir, "queue", "a.json")); err != nil {
		t.Errorf("queue/a.json was removed: %v", err)
	}
}

func TestCleanArtifactDirToleratesAMissingDir(t *testing.T) {
	dir := filepath.Join(t.TempDir(), "absent")
	var rep cleanReport
	cleanArtifactDir(dir, beforeRun, cleanTargets{Wide: true}, lockbit, inOneMinute(), &rep)
	if len(rep.Removed) != 0 || rep.Decoys != 0 || rep.RunFolders != 0 || rep.Failed != 0 || rep.OutOfTime {
		t.Errorf("rep = %+v, want zero", rep)
	}
	if _, err := os.Lstat(dir); !os.IsNotExist(err) {
		t.Errorf("the missing folder was created: %v", err)
	}
}

func TestCleanArtifactDirStopsWhenOutOfTime(t *testing.T) {
	dir := filepath.Join(t.TempDir(), "F0")
	touch(t, filepath.Join(dir, "rwdrv.sys"), time.Now())
	var rep cleanReport
	cleanArtifactDir(dir, beforeRun, cleanTargets{Wide: true}, lockbit, time.Now().Add(-time.Second), &rep)
	if got, want := names(t, dir), []string{"rwdrv.sys"}; !equal(got, want) {
		t.Errorf("left %v, want %v", got, want)
	}
	if !rep.OutOfTime {
		t.Error("OutOfTime not set")
	}
}
