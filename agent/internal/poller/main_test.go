package poller

import (
	"os"
	"testing"

	"github.com/f0rt1ka/achilles-agent/internal/config"
)

// TestMain turns the after pass off for every test. Its real targets are
// C:\F0, /tmp/F0 and the fortika-test home: without this a test that drives
// executeAndReport with an execute_test task would empty them on the machine
// running it. A test that checks the call installs its own recorder.
func TestMain(m *testing.M) {
	cleanAfterRun = func(*config.Config, string) {}
	os.Exit(m.Run())
}
