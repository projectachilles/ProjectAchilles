package appliance

import (
	"bytes"
	"context"
	"io"

	"charm.land/huh/v2"
	"strings"
	"testing"

	"github.com/projectachilles/ProjectAchilles/installer/internal/firstboot"
)

type fakeUI struct {
	choice    MenuChoice
	path      string
	chosen    int
	pathErr   error
	chooseErr error
}

func (f *fakeUI) Choose(context.Context) (MenuChoice, error) {
	f.chosen++
	return f.choice, f.chooseErr
}
func (f *fakeUI) BackupPath(context.Context) (string, error) { return f.path, f.pathErr }

type menuRig struct {
	ui    *fakeUI
	calls [][]string
	out   bytes.Buffer
	deps  MenuDeps
}

func newRig(installed bool, files ...string) *menuRig {
	r := &menuRig{ui: &fakeUI{}}
	r.deps = MenuDeps{
		UI: r.ui,
		Exists: func(p string) bool {
			if installed && p == firstboot.RepoDir+"/deploy.config.env" {
				return true
			}
			for _, f := range files {
				if f == p {
					return true
				}
			}
			return false
		},
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
	if !strings.Contains(r.out.String(), "sudo achilles-installer status") {
		t.Fatalf("output: %q", r.out.String())
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
