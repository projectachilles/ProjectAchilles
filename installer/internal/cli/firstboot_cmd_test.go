package cli

import (
	"strings"
	"testing"
)

func TestFirstbootNeedsRoot(t *testing.T) {
	r := NewRegistry("dev")
	registerFirstboot(r, func() bool { return false })
	code, _, stderr := run(r, "firstboot")
	if code == 0 || !strings.Contains(stderr, "needs root:") {
		t.Fatalf("code=%d stderr=%q", code, stderr)
	}
}

func TestFirstbootListedInUsage(t *testing.T) {
	r := NewRegistry("dev")
	_, stdout, _ := run(r, "--help")
	if !strings.Contains(stdout, "firstboot") {
		t.Fatalf("usage = %q", stdout)
	}
}
