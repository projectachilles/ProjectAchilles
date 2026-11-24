package executor

import (
	"fmt"
	"os"
	"path/filepath"
	"testing"

	"github.com/f0rt1ka/achilles-agent/internal/config"
)

// TestMain points every test at temp folders. Execute calls CleanBeforeRun,
// and the real targets are C:\F0, /tmp/F0 and the fortika-test home: without
// this a test that runs Execute would empty them on the machine running it.
// The replacement is not wide, so only a test's own binaries are ever removed
// unless that test installs its own targets.
func TestMain(m *testing.M) {
	root, err := os.MkdirTemp("", "executor-test-")
	if err != nil {
		fmt.Fprintln(os.Stderr, "TestMain:", err)
		os.Exit(1)
	}
	targetsFor = func(cfg *config.Config) cleanTargets {
		return cleanTargets{
			ArtifactDirs: []string{filepath.Join(root, "F0")},
			DecoyDirs:    []string{filepath.Join(root, "fortika-test")},
			WorkDir:      cfg.WorkDir,
			Wide:         false,
		}
	}
	accountExists = func(string) bool { return false }
	code := m.Run()
	os.RemoveAll(root)
	os.Exit(code)
}
