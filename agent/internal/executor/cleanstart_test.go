package executor

import (
	"errors"
	"os"
	"os/user"
	"path/filepath"
	"reflect"
	"runtime"
	"sort"
	"strings"
	"testing"
	"time"

	"github.com/f0rt1ka/achilles-agent/internal/config"
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
	// queue is the entry that proves the work-dir branch: state.json is also
	// kept by the undo word "state".
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
	if !reflect.DeepEqual(rep, cleanReport{}) {
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

// noAccount makes cleanDecoyDir see no local fortika-test account.
func noAccount(t *testing.T) {
	t.Helper()
	old := accountExists
	accountExists = func(string) bool { return false }
	t.Cleanup(func() { accountExists = old })
}

func decoyTargets(dir string) cleanTargets {
	return cleanTargets{DecoyDirs: []string{dir}, Wide: true}
}

func TestCleanDecoyDirEmptiesItAndKeepsTheFolder(t *testing.T) {
	noAccount(t)
	decoy := filepath.Join(t.TempDir(), "fortika-test")
	now := time.Now()
	for _, f := range []string{"README_RESTORE.txt", "backup.docx", "Documents/a/b.xlsx.locked"} {
		touch(t, filepath.Join(decoy, f), now)
	}
	var rep cleanReport
	cleanDecoyDir(decoy, decoyTargets(decoy), inOneMinute(), &rep)
	if got := names(t, decoy); len(got) != 0 {
		t.Errorf("left %v", got)
	}
	if rep.Decoys != 3 {
		t.Errorf("Decoys = %d, want 3", rep.Decoys)
	}
}

func TestCleanDecoyDirSkipsARealWindowsProfile(t *testing.T) {
	noAccount(t)
	decoy := filepath.Join(t.TempDir(), "fortika-test")
	touch(t, filepath.Join(decoy, "NTUSER.DAT"), time.Now())
	touch(t, filepath.Join(decoy, "Documents", "a.txt"), time.Now())
	var rep cleanReport
	cleanDecoyDir(decoy, decoyTargets(decoy), inOneMinute(), &rep)
	if got, want := names(t, decoy), []string{"Documents", "NTUSER.DAT"}; !equal(got, want) {
		t.Errorf("left %v, want %v", got, want)
	}
	if rep.Decoys != 0 {
		t.Errorf("Decoys = %d, want 0", rep.Decoys)
	}
}

func TestCleanDecoyDirSkipsWhenTheAccountExists(t *testing.T) {
	old := accountExists
	accountExists = func(name string) bool { return name == "fortika-test" }
	t.Cleanup(func() { accountExists = old })
	decoy := filepath.Join(t.TempDir(), "fortika-test")
	touch(t, filepath.Join(decoy, "a.txt"), time.Now())
	var rep cleanReport
	cleanDecoyDir(decoy, decoyTargets(decoy), inOneMinute(), &rep)
	if got, want := names(t, decoy), []string{"a.txt"}; !equal(got, want) {
		t.Errorf("left %v, want %v", got, want)
	}
}

func TestAccountExistsFindsARealAccountAndNotAMadeUpOne(t *testing.T) {
	me, err := user.Current()
	if err != nil {
		t.Skipf("no current user: %v", err)
	}
	name := me.Username[strings.LastIndex(me.Username, `\`)+1:]
	if !lookupAccount(name) {
		t.Errorf("lookupAccount(%q) = false for the current user", name)
	}
	if lookupAccount("no-such-account-6f1d2c") {
		t.Error("lookupAccount found a made-up account")
	}
}

func TestAccountFoundCountsOnlyNoSuchAccountAsMissing(t *testing.T) {
	if !accountFound(nil) {
		t.Error("no error read as no account")
	}
	if accountFound(user.UnknownUserError("fortika-test")) {
		t.Error("UnknownUserError read as an account")
	}
	if !accountFound(errors.New("open /etc/passwd: permission denied")) {
		t.Error("a failed lookup read as no account")
	}
	if got, want := accountFound(errorNoneMapped), runtime.GOOS != "windows"; got != want {
		t.Errorf("accountFound(ERROR_NONE_MAPPED) = %v, want %v", got, want)
	}
}

func TestCleanDecoyDirSkipsWhenAnAgentPathIsInside(t *testing.T) {
	noAccount(t)
	decoy := filepath.Join(t.TempDir(), "fortika-test")
	touch(t, filepath.Join(decoy, "a.txt"), time.Now())
	for name, protected := range map[string]string{
		"a path inside": filepath.Join(decoy, "agent.log"),
		"the folder":    decoy,
	} {
		tg := decoyTargets(decoy)
		tg.Protected = []string{protected}
		var rep cleanReport
		cleanDecoyDir(decoy, tg, inOneMinute(), &rep)
		if got, want := names(t, decoy), []string{"a.txt"}; !equal(got, want) {
			t.Errorf("%s: left %v, want %v", name, got, want)
		}
	}

	// An empty protected path protects nothing.
	tg := decoyTargets(decoy)
	tg.Protected = []string{""}
	var rep cleanReport
	cleanDecoyDir(decoy, tg, inOneMinute(), &rep)
	if got := names(t, decoy); len(got) != 0 {
		t.Errorf("an empty protected path skipped the folder: left %v", got)
	}
}

func TestCleanDecoyDirFailsClosedAndToleratesAMissingDir(t *testing.T) {
	noAccount(t)
	decoy := filepath.Join(t.TempDir(), "fortika-test")
	touch(t, filepath.Join(decoy, "a.txt"), time.Now())
	var rep cleanReport
	cleanDecoyDir(decoy, cleanTargets{DecoyDirs: []string{decoy}}, inOneMinute(), &rep)
	if got, want := names(t, decoy), []string{"a.txt"}; !equal(got, want) {
		t.Errorf("Wide=false left %v, want %v", got, want)
	}
	absent := filepath.Join(t.TempDir(), "absent")
	rep = cleanReport{}
	cleanDecoyDir(absent, decoyTargets(absent), inOneMinute(), &rep)
	if !reflect.DeepEqual(rep, cleanReport{}) {
		t.Errorf("rep = %+v, want zero", rep)
	}
	if _, err := os.Lstat(absent); !os.IsNotExist(err) {
		t.Errorf("the missing folder was created: %v", err)
	}
}

func TestRemoveRunFoldersRemovesEveryRunFolderOfAnyAge(t *testing.T) {
	work := filepath.Join(t.TempDir(), "work")
	now := time.Now()
	touch(t, filepath.Join(work, "task-aaa-1", "x"), now)
	touch(t, filepath.Join(work, "cmd-bbb-2", "y"), now.Add(-2*time.Hour))
	touch(t, filepath.Join(work, "queue", "q.json"), now)
	touch(t, filepath.Join(work, "state.json"), now)
	touch(t, filepath.Join(work, "notes", "z"), now)
	var rep cleanReport
	removeRunFolders(work, inOneMinute(), &rep)
	if got, want := names(t, work), []string{"notes", "queue", "state.json"}; !equal(got, want) {
		t.Errorf("left %v, want %v", got, want)
	}
	if rep.RunFolders != 2 {
		t.Errorf("RunFolders = %d, want 2", rep.RunFolders)
	}
}

// passTargets builds an artifact folder, a decoy folder and a work folder.
func passTargets(t *testing.T) (cleanTargets, string, string, string) {
	t.Helper()
	noAccount(t)
	base := t.TempDir()
	art := filepath.Join(base, "F0")
	decoy := filepath.Join(base, "fortika-test")
	work := filepath.Join(base, "work")
	now := time.Now()
	touch(t, filepath.Join(art, "rwdrv.sys"), now)
	touch(t, filepath.Join(art, "achilles-agent.exe"), now)
	touch(t, filepath.Join(decoy, "a.txt"), now)
	touch(t, filepath.Join(work, "task-old-1", "x"), now)
	return cleanTargets{
		ArtifactDirs: []string{art}, DecoyDirs: []string{decoy}, WorkDir: work,
		Protected: []string{filepath.Join(art, "achilles-agent.exe"), work}, Wide: true,
	}, art, decoy, work
}

func TestRunCleanPassBeforeRunCleansAllThreePlaces(t *testing.T) {
	tg, art, decoy, work := passTargets(t)
	rep := runCleanPass(beforeRun, tg, lockbit, inOneMinute())
	if got, want := names(t, art), []string{"achilles-agent.exe"}; !equal(got, want) {
		t.Errorf("artifact dir left %v, want %v", got, want)
	}
	if got := names(t, decoy); len(got) != 0 {
		t.Errorf("decoy left %v", got)
	}
	if got := names(t, work); len(got) != 0 {
		t.Errorf("work left %v", got)
	}
	if rep.Decoys != 1 || rep.RunFolders != 1 {
		t.Errorf("rep = %+v", rep)
	}
}

func TestRunCleanPassAfterRunLeavesRunFoldersAlone(t *testing.T) {
	tg, art, decoy, work := passTargets(t)
	runCleanPass(afterRun, tg, lockbit, inOneMinute())
	if got, want := names(t, work), []string{"task-old-1"}; !equal(got, want) {
		t.Errorf("work left %v, want %v", got, want)
	}
	if got, want := names(t, art), []string{"achilles-agent.exe"}; !equal(got, want) {
		t.Errorf("artifact dir left %v, want %v", got, want)
	}
	if got := names(t, decoy); len(got) != 0 {
		t.Errorf("decoy left %v", got)
	}
}

func TestRunCleanPassOutOfTimeTouchesNothing(t *testing.T) {
	tg, art, decoy, work := passTargets(t)
	rep := runCleanPass(beforeRun, tg, lockbit, time.Now().Add(-time.Second))
	if !rep.OutOfTime {
		t.Error("OutOfTime not set")
	}
	for dir, want := range map[string][]string{
		art: {"achilles-agent.exe", "rwdrv.sys"}, decoy: {"a.txt"}, work: {"task-old-1"},
	} {
		if got := names(t, dir); !equal(got, want) {
			t.Errorf("%s left %v, want %v", dir, got, want)
		}
	}
}

func TestDecoyDirs(t *testing.T) {
	want := "/home/fortika-test"
	switch runtime.GOOS {
	case "windows":
		want = `C:\Users\fortika-test`
	case "darwin":
		want = "/Users/fortika-test"
	}
	if got := DecoyDirs(); !equal(got, []string{want}) {
		t.Errorf("DecoyDirs() = %v, want [%s]", got, want)
	}
}

// useTargets replaces targetsFor for one test.
func useTargets(t *testing.T, f func(cfg *config.Config) cleanTargets) {
	t.Helper()
	old := targetsFor
	targetsFor = f
	t.Cleanup(func() { targetsFor = old })
}

// useExecutable replaces executablePath for one test.
func useExecutable(t *testing.T, path string, err error) {
	t.Helper()
	old := executablePath
	executablePath = func() (string, error) { return path, err }
	t.Cleanup(func() { executablePath = old })
}

// loadConfig writes a minimal config file and loads it, so ConfigPath() is set.
func loadConfig(t *testing.T, path, body string) *config.Config {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(path), 0700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte(body), 0600); err != nil {
		t.Fatal(err)
	}
	cfg, err := config.Load(path)
	if err != nil {
		t.Fatalf("config.Load: %v", err)
	}
	return cfg
}

func TestDefaultTargetsProtectTheAgentsOwnPaths(t *testing.T) {
	f0 := filepath.Join(t.TempDir(), "F0")
	exe := filepath.Join(f0, "achilles-agent.exe")
	useExecutable(t, exe, nil)
	cfgPath := filepath.Join(f0, "achilles-agent.yaml")
	work := filepath.Join(f0, "tasks")
	logFile := filepath.Join(f0, "achilles-agent.log")
	ca := filepath.Join(f0, "certs", "ca.pem")
	cfg := loadConfig(t, cfgPath, "work_dir: "+work+"\nlog_file: "+logFile+"\nca_cert: "+ca+"\n")

	tg := defaultTargets(cfg)
	if !tg.Wide {
		t.Error("Wide = false, want true")
	}
	for _, p := range []string{exe, exe + ".old", exe + ".rejected", exe + ".replaced", cfgPath, logFile, ca, work} {
		found := false
		for _, got := range tg.Protected {
			found = found || got == p
		}
		if !found {
			t.Errorf("Protected %v lacks %s", tg.Protected, p)
		}
	}
	if !equal(tg.ArtifactDirs, ArtifactDirs()) || !equal(tg.DecoyDirs, DecoyDirs()) || tg.WorkDir != work {
		t.Errorf("targets = %+v", tg)
	}
}

func TestCleanArtifactDirKeepsTheRollbackCopiesOfARenamedBinary(t *testing.T) {
	dir := filepath.Join(t.TempDir(), "F0")
	now := time.Now()
	for _, f := range []string{"agent.exe", "agent.exe.old", "rwdrv.sys"} {
		touch(t, filepath.Join(dir, f), now)
	}
	useExecutable(t, filepath.Join(dir, "agent.exe"), nil)
	cfg := loadConfig(t, filepath.Join(t.TempDir(), "achilles-agent.yaml"), "agent_id: a\n")
	targets := defaultTargets(cfg)
	targets.ArtifactDirs = []string{dir}
	var rep cleanReport
	cleanArtifactDir(dir, beforeRun, targets, lockbit, inOneMinute(), &rep)
	if got, want := names(t, dir), []string{"agent.exe", "agent.exe.old"}; !equal(got, want) {
		t.Errorf("left %v, want %v", got, want)
	}
}

func TestDefaultTargetsMakeProtectedPathsAbsolute(t *testing.T) {
	tmp := t.TempDir()
	t.Chdir(tmp)
	useExecutable(t, filepath.Join(tmp, "F0", "achilles-agent.exe"), nil)
	cfg := loadConfig(t, filepath.Join(tmp, "F0", "achilles-agent.yaml"), "ca_cert: certs/ca.pem\n")
	tg := defaultTargets(cfg)
	if !tg.Wide {
		t.Error("Wide = false, want true")
	}
	want := filepath.Join(tmp, "certs", "ca.pem")
	found := false
	for _, p := range tg.Protected {
		if p == "certs/ca.pem" {
			t.Errorf("a relative path stayed in Protected: %v", tg.Protected)
		}
		found = found || p == want
	}
	if !found {
		t.Errorf("Protected %v lacks the absolute %s", tg.Protected, want)
	}
}

func TestDefaultTargetsFailClosed(t *testing.T) {
	tmp := t.TempDir()
	cfg := loadConfig(t, filepath.Join(tmp, "achilles-agent.yaml"), "agent_id: a\n")

	useExecutable(t, "", errors.New("no executable"))
	if defaultTargets(cfg).Wide {
		t.Error("an unknown executable gave Wide = true")
	}

	useExecutable(t, "", nil)
	if defaultTargets(cfg).Wide {
		t.Error("an empty executable path gave Wide = true")
	}

	useExecutable(t, filepath.Join(tmp, "achilles-agent.exe"), nil)
	d := config.DefaultConfig()
	if defaultTargets(&d).Wide {
		t.Error("a config not loaded from a file gave Wide = true")
	}
}

func TestCleanBeforeAndAfterRunUseTheTargets(t *testing.T) {
	tmp := t.TempDir()
	art, decoy, work := filepath.Join(tmp, "F0"), filepath.Join(tmp, "fortika-test"), filepath.Join(tmp, "work")
	noAccount(t)
	now := time.Now()
	for _, f := range []string{
		filepath.Join(art, "rwdrv.sys"), filepath.Join(art, "test_execution_log.json"),
		filepath.Join(art, "achilles-agent.exe"), filepath.Join(decoy, "a.txt"),
		filepath.Join(work, "task-old-1", "x"),
	} {
		touch(t, f, now)
	}
	useTargets(t, func(cfg *config.Config) cleanTargets {
		return cleanTargets{
			ArtifactDirs: []string{art}, DecoyDirs: []string{decoy}, WorkDir: work,
			Protected: []string{filepath.Join(art, "achilles-agent.exe"), work}, Wide: true,
		}
	})
	cfg := &config.Config{}

	CleanBeforeRun(cfg, lockbit)
	if got, want := names(t, art), []string{"achilles-agent.exe"}; !equal(got, want) {
		t.Errorf("artifact dir after the before pass: %v, want %v", got, want)
	}
	if got := names(t, decoy); len(got) != 0 {
		t.Errorf("decoy dir left %v", got)
	}
	if got := names(t, work); len(got) != 0 {
		t.Errorf("work dir left %v", got)
	}

	touch(t, filepath.Join(art, "rwdrv.sys"), now)
	touch(t, filepath.Join(art, "test_execution_log.json"), now)
	CleanAfterRun(cfg, lockbit)
	if got, want := names(t, art), []string{"achilles-agent.exe", "test_execution_log.json"}; !equal(got, want) {
		t.Errorf("artifact dir after the after pass: %v, want %v", got, want)
	}
}
