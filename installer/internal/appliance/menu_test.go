package appliance

import (
	"bytes"
	"context"
	"io"
	"path/filepath"
	"regexp"
	"slices"
	"strings"
	"testing"

	"charm.land/huh/v2"

	"github.com/projectachilles/ProjectAchilles/installer/internal/firstboot"
)

type fakeUI struct {
	choice    MenuChoice
	path      string   // returned when paths is exhausted
	paths     []string // answers to BackupPath, in order
	problems  []string // the problem passed to each BackupPath call
	chosen    int
	pathErr   error
	chooseErr error
}

func (f *fakeUI) Choose(context.Context) (MenuChoice, error) {
	f.chosen++
	return f.choice, f.chooseErr
}
func (f *fakeUI) BackupPath(_ context.Context, problem string) (string, error) {
	f.problems = append(f.problems, problem)
	if len(f.paths) > 0 {
		p := f.paths[0]
		f.paths = f.paths[1:]
		return p, f.pathErr
	}
	return f.path, f.pathErr
}

type menuRig struct {
	ui    *fakeUI
	calls [][]string
	out   bytes.Buffer
	deps  MenuDeps
	dirs  []string
}

func newRig(installed bool, files ...string) *menuRig {
	r := &menuRig{ui: &fakeUI{}}
	r.deps = MenuDeps{
		UI: r.ui,
		Exists: func(p string) bool {
			if installed && p == firstboot.RepoDir+"/deploy.config.env" {
				return true
			}
			return slices.Contains(files, p) || slices.Contains(r.dirs, p)
		},
		IsRegular: func(p string) bool { return slices.Contains(files, p) },
		HomeDir:   func() (string, error) { return "/home/achilles", nil },
		Exec: func(_ context.Context, name string, args ...string) error {
			r.calls = append(r.calls, append([]string{name}, args...))
			return nil
		},
		Out: &r.out,
	}
	return r
}

func TestMenuInstalledPrintsSummaryOnly(t *testing.T) {
	r := newRig(true)
	if err := Menu(context.Background(), r.deps); err != nil {
		t.Fatal(err)
	}
	if r.ui.chosen != 0 || len(r.calls) != 0 {
		t.Fatalf("chosen=%d calls=%v", r.ui.chosen, r.calls)
	}
	out := r.out.String()
	// deploy.config.env exists once the wizard ran, even if the install then
	// failed: say "configured" and how to finish or check it.
	for _, want := range []string{"configured", "sudo " + firstboot.BinPath + " install", "sudo " + firstboot.BinPath + " status"} {
		if !strings.Contains(out, want) {
			t.Errorf("output lacks %q: %q", want, out)
		}
	}
	if strings.Contains(out, "is installed") {
		t.Errorf("output claims an install: %q", out)
	}
	assertAbsoluteCommands(t, out)
}

// sudo's secure_path doesn't include /opt/projectachilles: every command
// shown to the admin must name the binary by its absolute path.
func assertAbsoluteCommands(t *testing.T, text string) {
	t.Helper()
	for _, m := range regexp.MustCompile(`\S*achilles-installer`).FindAllString(text, -1) {
		if strings.TrimLeft(m, "`'\"") != firstboot.BinPath {
			t.Errorf("command %q is not %s in %q", m, firstboot.BinPath, text)
		}
	}
}

func TestMenuInstall(t *testing.T) {
	r := newRig(false)
	r.ui.choice = ChoiceInstall
	if err := Menu(context.Background(), r.deps); err != nil {
		t.Fatal(err)
	}
	want := []string{"sudo", firstboot.BinPath, "install", "--repo", firstboot.RepoDir}
	if len(r.calls) != 1 || strings.Join(r.calls[0], " ") != strings.Join(want, " ") {
		t.Fatalf("calls: %v", r.calls)
	}
}

func TestMenuRestore(t *testing.T) {
	p := "/home/achilles/backup.tar.gz"
	r := newRig(false, p)
	r.ui.choice, r.ui.path = ChoiceRestore, p
	if err := Menu(context.Background(), r.deps); err != nil {
		t.Fatal(err)
	}
	want := []string{"sudo", firstboot.BinPath, "restore", p}
	if len(r.calls) != 1 || strings.Join(r.calls[0], " ") != strings.Join(want, " ") {
		t.Fatalf("calls: %v", r.calls)
	}

	r = newRig(false)
	r.ui.choice, r.ui.path = ChoiceRestore, p
	err := Menu(context.Background(), r.deps)
	if err == nil || !strings.Contains(err.Error(), "File not found") {
		t.Fatalf("err: %v", err)
	}
	if len(r.calls) != 0 {
		t.Fatalf("calls: %v", r.calls)
	}
	// A bad path is asked again (with the reason), a bounded number of times.
	if n := len(r.ui.problems); n != maxPathAttempts || r.ui.problems[0] != "" || !strings.Contains(r.ui.problems[1], "File not found: "+p) {
		t.Fatalf("problems: %q", r.ui.problems)
	}
}

func restoreWith(t *testing.T, r *menuRig, answers ...string) {
	t.Helper()
	r.ui.choice, r.ui.paths = ChoiceRestore, answers
	if err := Menu(context.Background(), r.deps); err != nil {
		t.Fatal(err)
	}
}

func wantRestore(t *testing.T, r *menuRig, path string) {
	t.Helper()
	want := []string{"sudo", firstboot.BinPath, "restore", path}
	if len(r.calls) != 1 || strings.Join(r.calls[0], " ") != strings.Join(want, " ") {
		t.Fatalf("calls: %v, want %v", r.calls, want)
	}
}

func TestMenuRestoreExpandsHome(t *testing.T) {
	r := newRig(false, "/home/achilles/backup.tar.gz")
	restoreWith(t, r, "~/backup.tar.gz")
	wantRestore(t, r, "/home/achilles/backup.tar.gz")
}

func TestMenuRestoreTrimsWhitespace(t *testing.T) {
	r := newRig(false, "/home/achilles/backup.tar.gz")
	restoreWith(t, r, "  /home/achilles/backup.tar.gz \n")
	wantRestore(t, r, "/home/achilles/backup.tar.gz")
}

func TestMenuRestoreRelativePathMadeAbsolute(t *testing.T) {
	abs, err := filepath.Abs("backup.tar.gz")
	if err != nil {
		t.Fatal(err)
	}
	r := newRig(false, abs)
	restoreWith(t, r, "backup.tar.gz")
	wantRestore(t, r, abs)
}

func TestMenuRestoreRejectsDirectory(t *testing.T) {
	p := "/home/achilles/backup.tar.gz"
	r := newRig(false, p)
	r.dirs = []string{"/home/achilles"}
	restoreWith(t, r, "/home/achilles", p)
	wantRestore(t, r, p)
	if len(r.ui.problems) != 2 || !strings.Contains(r.ui.problems[1], "/home/achilles is not a file") {
		t.Fatalf("problems: %q", r.ui.problems)
	}
}

func TestMenuRestoreEmptyPathReasks(t *testing.T) {
	p := "/home/achilles/backup.tar.gz"
	r := newRig(false, p)
	restoreWith(t, r, "   ", p)
	wantRestore(t, r, p)
	if len(r.ui.problems) != 2 || r.ui.problems[1] == "" {
		t.Fatalf("problems: %q", r.ui.problems)
	}
}

func TestMenuShell(t *testing.T) {
	r := newRig(false)
	r.ui.choice = ChoiceShell
	if err := Menu(context.Background(), r.deps); err != nil || len(r.calls) != 0 {
		t.Fatalf("err=%v calls=%v", err, r.calls)
	}
}

func TestMenuRestoreAbortReturnsToShell(t *testing.T) {
	for _, e := range []error{huh.ErrUserAborted, io.EOF} {
		r := newRig(false)
		r.ui.choice, r.ui.pathErr = ChoiceRestore, e
		if err := Menu(context.Background(), r.deps); err != nil || len(r.calls) != 0 {
			t.Fatalf("%v: err=%v calls=%v", e, err, r.calls)
		}
	}
}

func TestMenuChooseAbortReturnsToShell(t *testing.T) {
	r := newRig(false)
	r.ui.chooseErr = io.EOF
	if err := Menu(context.Background(), r.deps); err != nil {
		t.Fatal(err)
	}
}

func TestMenuNoTerminalIsQuiet(t *testing.T) {
	r := newRig(false)
	r.deps.IsTerminal = func() bool { return false }
	if err := Menu(context.Background(), r.deps); err != nil {
		t.Fatal(err)
	}
	if r.ui.chosen != 0 || len(r.calls) != 0 || r.out.Len() != 0 {
		t.Fatalf("chosen=%d calls=%v out=%q", r.ui.chosen, r.calls, r.out.String())
	}
}
