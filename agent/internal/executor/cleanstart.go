package executor

import (
	"log"
	"os"
	"os/user"
	"path/filepath"
	"runtime"
	"sort"
	"strings"
	"time"

	"github.com/f0rt1ka/achilles-agent/internal/config"
)

// Clean start. Test binaries drop files of their own into the artifact folder
// (C:\F0, /tmp/F0): drivers, staged payloads, tools downloaded for a stage.
// Nothing removes them, so they pile up and EDR file alerts list them next to
// the test that is running. The agent empties the folder twice per run: a
// before pass, so a test starts on a clean folder, and an after pass, so it
// leaves none of its files behind.
//
// Some files stay in both passes. The agent's own files (achilles-* and its
// update and config temporaries) are never touched. Undo files, the ones a
// test leaves for its own or an operator's cleanup, stay because deleting
// them would strand what they restore. The top-level folders the agent
// itself uses (protectedTops) stay. The after pass also keeps the three
// result files the agent reads once the test has finished; the before pass
// removes them so a stale result can't be mistaken for the new run's.

// cleanPass selects which of the two passes is deciding.
type cleanPass int

const (
	beforeRun cleanPass = iota
	afterRun
)

// undoWords mark a file that undoes a test's changes (cleanup utilities,
// saved state, backups, restore scripts), matched in any case anywhere in the
// name.
var undoWords = []string{"cleanup", "restore", "backup", "state"}

// afterRunKept are the result files the agent reads after the test ends.
var afterRunKept = []string{"test_execution_log.json", "test_execution_log.txt", "bundle_results.json"}

// isAgentFile reports whether name belongs to the agent itself: its binary,
// config and log (achilles-*), the config writer's temporary (.config-*.tmp)
// and the self-update installer's (.achilles-agent-install-*).
func isAgentFile(name string) bool {
	lower := strings.ToLower(name)
	return strings.HasPrefix(lower, "achilles-") ||
		(strings.HasPrefix(lower, ".config-") && strings.HasSuffix(lower, ".tmp")) ||
		strings.HasPrefix(lower, ".achilles-agent-install-")
}

// isUndoFile reports whether name looks like a file that undoes a test's
// changes.
func isUndoFile(name string) bool {
	lower := strings.ToLower(name)
	for _, w := range undoWords {
		if strings.Contains(lower, w) {
			return true
		}
	}
	return false
}

// keepInArtifactDir reports whether a top-level entry of the artifact folder
// survives the given pass.
func keepInArtifactDir(name string, pass cleanPass, protectedTops []string) bool {
	if isAgentFile(name) || isUndoFile(name) {
		return true
	}
	for _, top := range protectedTops {
		if strings.EqualFold(name, top) {
			return true
		}
	}
	if pass == afterRun {
		for _, k := range afterRunKept {
			if strings.EqualFold(name, k) {
				return true
			}
		}
	}
	return false
}

// cleanTargets are the folders a pass works on and the agent's own paths.
type cleanTargets struct {
	ArtifactDirs []string // C:\F0, /tmp/F0
	DecoyDirs    []string // fortika-test
	WorkDir      string
	Protected    []string // absolute: executable, config, log, CA cert, work dir
	Wide         bool     // false = executable or config path unknown: fail closed
}

// cleanReport is what one pass did.
type cleanReport struct {
	Removed    []string // top-level names removed from artifact folders
	Decoys     int      // top-level entries removed from decoy folders
	RunFolders int      // task-* / cmd-* folders removed
	Failed     int
	OutOfTime  bool
}

// protectedTops returns the top-level names of dir that hold a protected path
// (sorted, without duplicates). selfIsWorkDir is true when dir itself is
// protected, which happens when the agent runs from the artifact folder. Paths
// are compared as given, without resolving links.
func protectedTops(dir string, protected []string) (tops []string, selfIsWorkDir bool) {
	seen := map[string]bool{}
	for _, p := range protected {
		if p == "" {
			continue
		}
		if !pathInside(dir, p) {
			continue
		}
		rel, _ := filepath.Rel(filepath.Clean(dir), filepath.Clean(p))
		if rel == "." {
			selfIsWorkDir = true
			continue
		}
		top := strings.Split(rel, string(filepath.Separator))[0]
		if !seen[top] {
			seen[top] = true
			tops = append(tops, top)
		}
	}
	sort.Strings(tops)
	return tops, selfIsWorkDir
}

// reachesDir walks an agent path p up through its parents and reports where it
// reaches the folder whose identity is dir. The comparison is by file identity
// (os.Stat follows links), so a symlink, a junction, a short name or another
// spelling of the folder is found as well. self is true when p is the folder
// itself. below lists, for each ancestor of p that is the folder, the path of
// the entry directly below it on the way up; that entry may not exist yet.
func reachesDir(p string, dir os.FileInfo) (self bool, below []string) {
	child := ""
	for cur := filepath.Clean(p); ; {
		if info, err := os.Stat(cur); err == nil && os.SameFile(info, dir) {
			if child == "" {
				self = true
			} else {
				below = append(below, child)
			}
		}
		parent := filepath.Dir(cur)
		if parent == cur {
			return self, below
		}
		child, cur = cur, parent
	}
}

// identityKeeps is what the identity rule keeps in an opened artifact folder.
type identityKeeps struct {
	entries []os.FileInfo // top-level entries that hold an agent path
	names   []string      // such entries that do not exist yet, kept by name
	self    bool          // an agent path is the folder itself
}

// identityKeepsFor applies the identity rule to every protected path. ok is
// false when the opened folder's own identity can't be read.
func identityKeepsFor(root *os.Root, protected []string) (keeps identityKeeps, ok bool) {
	dir, err := root.Stat(".")
	if err != nil {
		return keeps, false
	}
	for _, p := range protected {
		if p == "" {
			continue
		}
		self, below := reachesDir(p, dir)
		keeps.self = keeps.self || self
		for _, entry := range below {
			if info, err := os.Lstat(entry); err == nil {
				keeps.entries = append(keeps.entries, info)
			} else {
				keeps.names = append(keeps.names, filepath.Base(entry))
			}
		}
	}
	return keeps, true
}

// holds reports whether the top-level entry name of root is one the identity
// rule keeps. An entry whose identity can't be read is kept.
func (k identityKeeps) holds(root *os.Root, name string) bool {
	if len(k.entries) == 0 {
		return false
	}
	info, err := root.Lstat(name)
	if err != nil {
		return true
	}
	for _, kept := range k.entries {
		if os.SameFile(info, kept) {
			return true
		}
	}
	return false
}

// removeEntries removes, through the trusted root, every top-level entry of
// root that selected accepts, and returns their names. A failed delete is
// logged and counted in rep.Failed; the walk stops, setting rep.OutOfTime, once
// the deadline has passed (checked before each entry). dir is only used in log
// lines.
func removeEntries(dir string, root *os.Root, deadline time.Time, rep *cleanReport, selected func(os.DirEntry) bool) []string {
	var removed []string
	for _, e := range readRoot(root) {
		if time.Now().After(deadline) {
			rep.OutOfTime = true
			return removed
		}
		if !selected(e) {
			continue
		}
		name := e.Name()
		if err := root.RemoveAll(name); err != nil {
			log.Printf("[cleanup] could not remove %s: %v", filepath.Join(dir, name), err)
			rep.Failed++
			continue
		}
		removed = append(removed, name)
	}
	return removed
}

// cleanArtifactDir empties the top level of an artifact folder except what
// keepInArtifactDir keeps. Without the agent's own paths (Wide false) it
// removes only testUUID's binaries. An agent path is matched twice: by its
// text (protectedTops) and by file identity (identityKeepsFor), and an entry
// either rule names stays. Every delete goes through the trusted root, which
// never follows a link.
func cleanArtifactDir(dir string, pass cleanPass, t cleanTargets, testUUID string, deadline time.Time, rep *cleanReport) {
	if !t.Wide {
		rep.Removed = append(rep.Removed, removeTestBinaries(dir, testUUID)...)
		return
	}
	root := openTrustedDir(dir)
	if root == nil {
		return
	}
	defer root.Close()
	keeps, ok := identityKeepsFor(root, t.Protected)
	if !ok {
		log.Printf("[cleanup] skipping %s: can't read its identity", dir)
		return
	}
	tops, selfIsWorkDir := protectedTops(dir, t.Protected)
	tops = append(tops, keeps.names...)
	if selfIsWorkDir || keeps.self {
		tops = append(tops, "state.json", "queue")
	}
	rep.Removed = append(rep.Removed, removeEntries(dir, root, deadline, rep, func(e os.DirEntry) bool {
		return !keepInArtifactDir(e.Name(), pass, tops) && !keeps.holds(root, e.Name())
	})...)
}

// decoyAccount is the local account whose home folder the tests fill with
// decoy documents.
const decoyAccount = "fortika-test"

// accountExists reports whether a local account with this name exists. With
// CGO disabled, macOS only sees accounts listed in /etc/passwd, so a
// directory-service account is not detected there. A variable so tests can
// replace it.
var accountExists = func(name string) bool {
	_, err := user.Lookup(name)
	return err == nil
}

// DecoyDirs returns the decoy home folder the tests fill on this OS.
func DecoyDirs() []string {
	switch runtime.GOOS {
	case "windows":
		return []string{`C:\Users\` + decoyAccount}
	case "darwin":
		return []string{"/Users/" + decoyAccount}
	}
	return []string{"/home/" + decoyAccount}
}

// pathInside reports whether p is dir or lies inside it, comparing the paths as
// given.
func pathInside(dir, p string) bool {
	rel, err := filepath.Rel(filepath.Clean(dir), filepath.Clean(p))
	return err == nil && !filepath.IsAbs(rel) && rel != ".." && !strings.HasPrefix(rel, ".."+string(filepath.Separator))
}

// cleanDecoyDir empties a decoy home folder but keeps the folder. It does
// nothing when an agent path lies inside it, by its text or by file identity,
// or when it looks like a real user's home (the account exists, or it holds
// NTUSER.DAT), so a mistaken folder name can never wipe a person's files.
func cleanDecoyDir(dir string, t cleanTargets, deadline time.Time, rep *cleanReport) {
	if !t.Wide {
		return
	}
	for _, p := range t.Protected {
		if p != "" && pathInside(dir, p) {
			log.Printf("[cleanup] skipping %s: it holds an agent path", dir)
			return
		}
	}
	root := openTrustedDir(dir)
	if root == nil {
		return
	}
	defer root.Close()
	if keeps, ok := identityKeepsFor(root, t.Protected); !ok || keeps.self || len(keeps.entries) > 0 || len(keeps.names) > 0 {
		log.Printf("[cleanup] skipping %s: it holds an agent path", dir)
		return
	}
	if _, err := root.Lstat("NTUSER.DAT"); err == nil || accountExists(decoyAccount) {
		log.Printf("[cleanup] skipping %s: it is a user's home folder", dir)
		return
	}
	rep.Decoys += len(removeEntries(dir, root, deadline, rep, func(os.DirEntry) bool { return true }))
}

// removeRunFolders removes the task-* and cmd-* folders of earlier runs from
// the agent's work folder, whatever their age.
func removeRunFolders(workDir string, deadline time.Time, rep *cleanReport) {
	root := openTrustedDir(workDir)
	if root == nil {
		return
	}
	defer root.Close()
	rep.RunFolders += len(removeEntries(workDir, root, deadline, rep, func(e os.DirEntry) bool {
		return e.IsDir() && (strings.HasPrefix(e.Name(), "task-") || strings.HasPrefix(e.Name(), "cmd-"))
	}))
}

// runCleanPass runs one pass over the artifact folders, the decoy folders and,
// before a run, the work folder's old run folders.
func runCleanPass(pass cleanPass, t cleanTargets, testUUID string, deadline time.Time) cleanReport {
	var rep cleanReport
	for _, dir := range t.ArtifactDirs {
		cleanArtifactDir(dir, pass, t, testUUID, deadline, &rep)
	}
	for _, dir := range t.DecoyDirs {
		cleanDecoyDir(dir, t, deadline, &rep)
	}
	if pass == beforeRun && t.Wide && t.WorkDir != "" {
		removeRunFolders(t.WorkDir, deadline, &rep)
	}
	return rep
}

// Time each pass may spend. The before pass delays a test that is waiting to
// start; the after pass runs while the agent is still busy, so it can't take
// another task until it ends.
const (
	beforeRunBudget = 20 * time.Second
	afterRunBudget  = 60 * time.Second
)

// executablePath resolves the running agent binary. A variable so tests can
// replace it.
var executablePath = func() (string, error) {
	exe, err := os.Executable()
	if err != nil {
		return "", err
	}
	return filepath.EvalSymlinks(exe)
}

// targetsFor builds the targets of a pass. A variable so TestMain can point
// every test at temp folders.
var targetsFor = defaultTargets

// defaultTargets builds the real targets from the agent's config. Wide is
// true only when the executable and the config file are both known, because
// those two decide what the agent must never delete. Every protected path is
// made absolute first, since a relative one would never match a folder entry;
// if any of them can't be, Wide is false.
func defaultTargets(cfg *config.Config) cleanTargets {
	t := cleanTargets{
		ArtifactDirs: ArtifactDirs(),
		DecoyDirs:    DecoyDirs(),
		WorkDir:      cfg.WorkDir,
	}
	exe, err := executablePath()
	if err != nil || cfg.ConfigPath() == "" {
		return t
	}
	t.Wide = true
	for _, p := range []string{exe, cfg.ConfigPath(), cfg.LogFile, cfg.CACert, cfg.WorkDir} {
		if p == "" {
			continue
		}
		abs, err := filepath.Abs(p)
		if err != nil {
			t.Wide = false
			break
		}
		t.Protected = append(t.Protected, abs)
	}
	return t
}

// CleanBeforeRun empties the artifact and decoy folders and removes old run
// folders before a test starts. Best effort: nothing is returned and a
// failure never stops the run.
func CleanBeforeRun(cfg *config.Config, testUUID string) {
	cleanRun(beforeRun, beforeRunBudget, cfg, testUUID)
}

// CleanAfterRun empties the artifact and decoy folders once a test has
// finished, keeping the result files the agent still reads.
func CleanAfterRun(cfg *config.Config, testUUID string) {
	cleanRun(afterRun, afterRunBudget, cfg, testUUID)
}

func cleanRun(pass cleanPass, budget time.Duration, cfg *config.Config, testUUID string) {
	t := targetsFor(cfg)
	if !t.Wide {
		log.Printf("[cleanup] agent paths unknown: only this test's binaries are removed")
	}
	logCleanReport(pass, runCleanPass(pass, t, testUUID, time.Now().Add(budget)))
}

// logCleanReport logs what a pass removed; an empty report logs nothing.
func logCleanReport(pass cleanPass, rep cleanReport) {
	label := "before run"
	if pass == afterRun {
		label = "after run"
	}
	if len(rep.Removed) > 0 || rep.Decoys > 0 || rep.RunFolders > 0 || rep.Failed > 0 {
		log.Printf("[cleanup] %s: removed %d from the artifact folder (%s), %d decoy entries, %d old run folder(s); %d failed",
			label, len(rep.Removed), strings.Join(rep.Removed, ", "), rep.Decoys, rep.RunFolders, rep.Failed)
	}
	if rep.OutOfTime {
		log.Printf("[cleanup] %s: out of time, leftovers remain", label)
	}
}
