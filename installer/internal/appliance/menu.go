// Package appliance holds the login experience of the ProjectAchilles
// appliance VM: the post-login menu and the console pre-login banner.
package appliance

import (
	"context"
	"errors"
	"fmt"
	"io"
	"path/filepath"

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
	BackupPath(ctx context.Context) (string, error)
}

// MenuDeps are the menu's collaborators; tests fake them.
type MenuDeps struct {
	UI     MenuUI
	Exists func(string) bool
	Exec   func(ctx context.Context, name string, args ...string) error // stdio attached
	Out    io.Writer
	// IsTerminal reports whether stdin is a terminal; nil means yes.
	IsTerminal func() bool
}

func configPath() string { return filepath.Join(firstboot.RepoDir, "deploy.config.env") }

// Installed reports whether the install wizard has already run.
func Installed(exists func(string) bool) bool { return exists(configPath()) }

// Menu shows the login menu, or a one-line summary once installed.
func Menu(ctx context.Context, d MenuDeps) error {
	if Installed(d.Exists) {
		fmt.Fprintln(d.Out, "ProjectAchilles is installed. Run 'sudo achilles-installer status' to check it.")
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
		path, err := d.UI.BackupPath(ctx)
		if err != nil {
			if aborted(err) {
				return nil // Ctrl+C or EOF: back to the shell
			}
			return err
		}
		if !d.Exists(path) {
			return fmt.Errorf("File not found: %s", path)
		}
		return d.Exec(ctx, "sudo", firstboot.BinPath, "restore", path)
	default:
		return nil
	}
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
func (FormUI) BackupPath(ctx context.Context) (string, error) {
	var p string
	err := huh.NewForm(huh.NewGroup(huh.NewInput().
		Title("Path of the backup file").
		Description("For example: /home/achilles/backup.tar.gz").
		Value(&p))).WithTheme(huh.ThemeFunc(huh.ThemeBase16)).RunWithContext(ctx)
	return p, err
}
