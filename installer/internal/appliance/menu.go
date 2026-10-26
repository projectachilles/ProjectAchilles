// Package appliance holds the login experience of the ProjectAchilles
// appliance VM: the post-login menu and the console pre-login banner.
package appliance

import (
	"context"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"

	"charm.land/huh/v2"

	"github.com/projectachilles/ProjectAchilles/installer/internal/firstboot"
)

// MenuChoice is what the admin picked in the login menu.
type MenuChoice int

const (
	ChoiceInstall MenuChoice = iota
	ChoiceRestore
	ChoiceShell
)

// MenuUI asks the admin questions.
type MenuUI interface {
	Choose(ctx context.Context) (MenuChoice, error)
	// BackupPath asks for the backup file; problem ("" the first time) says
	// what was wrong with the previous answer.
	BackupPath(ctx context.Context, problem string) (string, error)
}

// MenuDeps are the menu's collaborators; tests fake them.
type MenuDeps struct {
	UI     MenuUI
	Exists func(string) bool
	Exec   func(ctx context.Context, name string, args ...string) error // stdio attached
	Out    io.Writer
	// IsTerminal reports whether stdin is a terminal; nil means yes.
	IsTerminal func() bool
	// IsRegular reports whether a path is a regular file; nil means os.Stat.
	IsRegular func(string) bool
	// HomeDir expands a leading "~/"; nil means os.UserHomeDir.
	HomeDir func() (string, error)
}

// maxPathAttempts bounds the backup-path question, so a script feeding
// stdin can't loop forever.
const maxPathAttempts = 3

func configPath() string { return filepath.Join(firstboot.RepoDir, "deploy.config.env") }

// Installed reports whether the install wizard has already run: it writes
// deploy.config.env before the install itself, so a failed install still
// counts. Text shown to the admin says "configured", not "installed".
func Installed(exists func(string) bool) bool { return exists(configPath()) }

// configuredSummary is the menu's output once the wizard has run.
var configuredSummary = fmt.Sprintf("ProjectAchilles is configured on this server. If the install didn't finish, run `sudo %[1]s install`; check it with `sudo %[1]s status`.", firstboot.BinPath)

// Menu shows the login menu, or a one-line summary once configured.
func Menu(ctx context.Context, d MenuDeps) error {
	if Installed(d.Exists) {
		fmt.Fprintln(d.Out, configuredSummary)
		return nil
	}
	// Without a terminal (ssh host cmd, scp) there is nobody to ask.
	if d.IsTerminal != nil && !d.IsTerminal() {
		return nil
	}
	choice, err := d.UI.Choose(ctx)
	if err != nil {
		if aborted(err) {
			return nil
		}
		return err
	}
	switch choice {
	case ChoiceInstall:
		return d.Exec(ctx, "sudo", firstboot.BinPath, "install", "--repo", firstboot.RepoDir)
	case ChoiceRestore:
		path, err := backupPath(ctx, d)
		if err != nil {
			if aborted(err) {
				return nil // Ctrl+C or EOF: back to the shell
			}
			return err
		}
		return d.Exec(ctx, "sudo", firstboot.BinPath, "restore", path)
	default:
		return nil
	}
}

// backupPath asks for the backup file until the answer is a regular file
// (at most maxPathAttempts times) and returns it as an absolute path. sudo
// does not expand "~", so it is expanded here.
func backupPath(ctx context.Context, d MenuDeps) (string, error) {
	isRegular, home := d.IsRegular, d.HomeDir
	if isRegular == nil {
		isRegular = func(p string) bool {
			fi, err := os.Stat(p)
			return err == nil && fi.Mode().IsRegular()
		}
	}
	if home == nil {
		home = os.UserHomeDir
	}
	var problem error
	for i := 0; i < maxPathAttempts; i++ {
		msg := ""
		if problem != nil {
			msg = problem.Error()
		}
		p, err := d.UI.BackupPath(ctx, msg)
		if err != nil {
			return "", err
		}
		if p, problem = resolvePath(strings.TrimSpace(p), home); problem != nil {
			continue
		}
		switch {
		case isRegular(p):
			return p, nil
		case d.Exists(p):
			problem = fmt.Errorf("%s is not a file. Enter the path of the backup file itself.", p)
		default:
			problem = fmt.Errorf("File not found: %s", p)
		}
	}
	return "", problem
}

// resolvePath expands a leading "~/" and makes p absolute.
func resolvePath(p string, home func() (string, error)) (string, error) {
	if p == "" {
		return "", errors.New("Enter the path of the backup file.")
	}
	if p == "~" || strings.HasPrefix(p, "~/") {
		h, err := home()
		if err != nil {
			return "", fmt.Errorf("can't expand ~: %w", err)
		}
		p = filepath.Join(h, strings.TrimPrefix(p, "~"))
	}
	return filepath.Abs(p)
}

// aborted reports a Ctrl+C or closed stdin, which both mean "open a shell".
func aborted(err error) bool {
	return errors.Is(err, huh.ErrUserAborted) || errors.Is(err, io.EOF)
}

// FormUI is the real menu UI, built from huh forms.
type FormUI struct{}

// Choose asks what to do. Ctrl+C means "open a shell".
func (FormUI) Choose(ctx context.Context) (MenuChoice, error) {
	choice := ChoiceInstall
	err := huh.NewForm(huh.NewGroup(huh.NewSelect[MenuChoice]().
		Title("ProjectAchilles is not installed yet").
		Options(
			huh.NewOption("Install ProjectAchilles (start the setup wizard)", ChoiceInstall),
			huh.NewOption("Restore from a backup (moving from another server)", ChoiceRestore),
			huh.NewOption("Open a shell", ChoiceShell),
		).Value(&choice))).WithTheme(huh.ThemeFunc(huh.ThemeBase16)).RunWithContext(ctx)
	if aborted(err) {
		return ChoiceShell, nil
	}
	return choice, err
}

// BackupPath asks for the backup archive's path.
func (FormUI) BackupPath(ctx context.Context, problem string) (string, error) {
	var p string
	desc := "For example: /home/achilles/backup.tar.gz"
	if problem != "" {
		desc = problem + "\n\n" + desc
	}
	err := huh.NewForm(huh.NewGroup(huh.NewInput().
		Title("Path of the backup file").
		Description(desc).
		Value(&p))).WithTheme(huh.ThemeFunc(huh.ThemeBase16)).RunWithContext(ctx)
	return p, err
}
