package executor

import (
	"log"
	"path/filepath"
	"sort"
	"strings"
	"time"
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
		rel, err := filepath.Rel(filepath.Clean(dir), filepath.Clean(p))
		if err != nil || filepath.IsAbs(rel) || rel == ".." || strings.HasPrefix(rel, ".."+string(filepath.Separator)) {
			continue
		}
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

// cleanArtifactDir empties the top level of an artifact folder except what
// keepInArtifactDir keeps. Without the agent's own paths (Wide false) it
// removes only testUUID's binaries. Every delete goes through the trusted
// root, which never follows a link. A failed delete is logged and counted; the
// pass stops, setting rep.OutOfTime, once the deadline has passed.
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
	tops, selfIsWorkDir := protectedTops(dir, t.Protected)
	if selfIsWorkDir {
		tops = append(tops, "state.json", "queue")
	}
	for _, e := range readRoot(root) {
		if time.Now().After(deadline) {
			rep.OutOfTime = true
			return
		}
		name := e.Name()
		if keepInArtifactDir(name, pass, tops) {
			continue
		}
		if err := root.RemoveAll(name); err != nil {
			log.Printf("[cleanup] could not remove %s: %v", filepath.Join(dir, name), err)
			rep.Failed++
			continue
		}
		rep.Removed = append(rep.Removed, name)
	}
}
