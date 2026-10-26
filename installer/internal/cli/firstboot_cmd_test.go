package cli

import (
	"bytes"
	"context"
	"strings"
	"testing"

	"github.com/projectachilles/ProjectAchilles/installer/internal/firstboot"
)

type firstbootRig struct {
	ran    bool
	stderr bytes.Buffer
	deps   firstbootDeps
}

func newFirstbootRig(root, marker bool) *firstbootRig {
	f := &firstbootRig{}
	f.deps = firstbootDeps{
		isRoot: func() bool { return root },
		exists: func(p string) bool { return marker && p == firstboot.MarkerPath },
		run:    func(context.Context) error { f.ran = true; return nil },
		stderr: &f.stderr,
	}
	return f
}

func (f *firstbootRig) run(args ...string) (int, string) {
	r := NewRegistry("dev")
	registerFirstboot(r, f.deps)
	code, _, stderr := run(r, append([]string{"firstboot"}, args...)...)
	return code, stderr + f.stderr.String()
}

func TestFirstbootNeedsRoot(t *testing.T) {
	f := newFirstbootRig(false, false)
	code, stderr := f.run()
	if code == 0 || !strings.Contains(stderr, "needs root:") || f.ran {
		t.Fatalf("code=%d stderr=%q ran=%v", code, stderr, f.ran)
	}
}

func TestFirstbootListedInUsage(t *testing.T) {
	r := NewRegistry("dev")
	_, stdout, _ := run(r, "--help")
	if !strings.Contains(stdout, "firstboot") {
		t.Fatalf("usage = %q", stdout)
	}
}

func TestFirstbootHelp(t *testing.T) {
	for _, arg := range []string{"-h", "--help"} {
		f := newFirstbootRig(false, true) // help works as non-root, after first boot
		code, out := f.run(arg)
		if code != 0 || !strings.Contains(out, "Usage: achilles-installer firstboot") || !strings.Contains(out, "--force") || f.ran {
			t.Fatalf("%s: code=%d out=%q ran=%v", arg, code, out, f.ran)
		}
	}
}

func TestFirstbootRefusesAfterCompletion(t *testing.T) {
	f := newFirstbootRig(true, true)
	code, out := f.run()
	if code == 0 || !strings.Contains(out, "First boot has already completed on this appliance.") || f.ran {
		t.Fatalf("code=%d out=%q ran=%v", code, out, f.ran)
	}
}

func TestFirstbootForceRunsAgain(t *testing.T) {
	f := newFirstbootRig(true, true)
	if code, out := f.run("--force"); code != 0 || !f.ran {
		t.Fatalf("code=%d out=%q ran=%v", code, out, f.ran)
	}
}

func TestFirstbootRunsBeforeCompletion(t *testing.T) {
	f := newFirstbootRig(true, false)
	if code, out := f.run(); code != 0 || !f.ran {
		t.Fatalf("code=%d out=%q ran=%v", code, out, f.ran)
	}
}

func TestFirstbootRejectsStrayArgs(t *testing.T) {
	f := newFirstbootRig(true, false)
	if code, _ := f.run("now"); code == 0 || f.ran {
		t.Fatalf("code=%d ran=%v", code, f.ran)
	}
}
