package executor

import (
	"log"
	"os"
	"path/filepath"
	"regexp"
	"runtime"
	"strings"
	"time"
)

// Test leftovers. Orchestrators extract their stage binaries into the shared
// artifact folder (C:\F0 on Windows, /tmp/F0 on Linux and macOS), and almost
// none remove them, so binaries of every test ever run pile up there. EDR file
// alerts then list several tests' binaries at once (Defender's "A suspicious
// file was observed"), which reads as detections of tests that did not run.
// A run that dies mid-way (the agent killed by an EDR) also leaves its
// task-<id>-* folder, because the deferred RemoveAll never runs.
//
// Only Achilles test binaries are ever removed: <uuid>.exe or
// <uuid>-<control>[.NNN].exe, or the same with no extension. The agent's own
// files, logs, outputs, bundle_results.json, the result queue and the state
// store never match.

// testBinaryPattern: a test UUID, an optional -<control> (controls may carry
// numeric parts, e.g. -t1003.001), then .exe or nothing.
var testBinaryPattern = regexp.MustCompile(`(?i)^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(?:-[a-z0-9_-]+(?:\.\d+)*)?(?:\.exe)?$`)

// isTestBinary reports whether name is an Achilles test binary; with a
// non-empty testUUID, a binary of that test only.
func isTestBinary(name, testUUID string) bool {
	m := testBinaryPattern.FindStringSubmatch(name)
	if m == nil {
		return false
	}
	return testUUID == "" || strings.EqualFold(m[1], testUUID)
}

// ArtifactDirs is where test binaries extract their stage binaries.
func ArtifactDirs() []string {
	if runtime.GOOS == "windows" {
		return []string{`C:\F0`}
	}
	return []string{"/tmp/F0"}
}

// removeTestBinaries deletes testUUID's binaries from the top level of dir and
// returns their names. Errors (a file still in use, an EDR holding it) are
// logged and skipped: the startup sweep retries leftovers.
func removeTestBinaries(dir, testUUID string) []string {
	if testUUID == "" {
		return nil
	}
	entries, err := os.ReadDir(dir)
	if err != nil {
		return nil
	}
	var removed []string
	for _, e := range entries {
		if !e.Type().IsRegular() || !isTestBinary(e.Name(), testUUID) {
			continue
		}
		if err := os.Remove(filepath.Join(dir, e.Name())); err != nil {
			log.Printf("[cleanup] could not remove %s: %v", filepath.Join(dir, e.Name()), err)
			continue
		}
		removed = append(removed, e.Name())
	}
	return removed
}

// cleanupAfterRun removes the run's test binaries from every artifact folder.
func cleanupAfterRun(testUUID string) {
	for _, dir := range ArtifactDirs() {
		if removed := removeTestBinaries(dir, testUUID); len(removed) > 0 {
			log.Printf("[cleanup] removed %d test binar%s of %s from %s", len(removed), plural(len(removed)), testUUID, dir)
		}
	}
}

// SweepStale removes what runs that died left behind: task-* and cmd-* run
// folders in workDir, and test binaries (of any test) in the artifact folders,
// when last modified more than olderThan before now. The age keeps it away
// from a test an orphaned process may still be running.
func SweepStale(workDir string, artifactDirs []string, olderThan time.Duration, now time.Time) {
	cutoff := now.Add(-olderThan)
	folders, files := 0, 0
	if entries, err := os.ReadDir(workDir); err == nil {
		for _, e := range entries {
			name := e.Name()
			if !e.IsDir() || !(strings.HasPrefix(name, "task-") || strings.HasPrefix(name, "cmd-")) {
				continue
			}
			if info, err := e.Info(); err != nil || info.ModTime().After(cutoff) {
				continue
			}
			if err := os.RemoveAll(filepath.Join(workDir, name)); err != nil {
				log.Printf("[cleanup] could not remove %s: %v", filepath.Join(workDir, name), err)
				continue
			}
			folders++
		}
	}
	for _, dir := range artifactDirs {
		entries, err := os.ReadDir(dir)
		if err != nil {
			continue
		}
		for _, e := range entries {
			if !e.Type().IsRegular() || !isTestBinary(e.Name(), "") {
				continue
			}
			if info, err := e.Info(); err != nil || info.ModTime().After(cutoff) {
				continue
			}
			if err := os.Remove(filepath.Join(dir, e.Name())); err != nil {
				log.Printf("[cleanup] could not remove %s: %v", filepath.Join(dir, e.Name()), err)
				continue
			}
			files++
		}
	}
	if folders > 0 || files > 0 {
		log.Printf("[cleanup] removed %d stale run folder(s) and %d leftover test binar%s", folders, files, plural(files))
	}
}

func plural(n int) string {
	if n == 1 {
		return "y"
	}
	return "ies"
}
