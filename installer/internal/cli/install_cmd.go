package cli

import (
	"context"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"os"
	"os/signal"
	"path/filepath"
	"syscall"

	"github.com/projectachilles/ProjectAchilles/installer/internal/clerkadmin"
	"github.com/projectachilles/ProjectAchilles/installer/internal/config"
	"github.com/projectachilles/ProjectAchilles/installer/internal/engine"
	"github.com/projectachilles/ProjectAchilles/installer/internal/tui"
)

// defaultRepoDir is where install-onprem.sh clones ProjectAchilles.
const defaultRepoDir = "/opt/projectachilles"

const repoFlagHelp = "ProjectAchilles checkout (default: the current directory if it is one, else this binary's directory if it is one, else " + defaultRepoDir + ")"

// installIO is the install handler's view of the process.
type installIO struct {
	stdin          io.Reader
	stdout, stderr io.Writer
	getenv         func(string) string
	// newRunner returns an engine run of scripts/deploy-server.sh in root
	// for cfgPath (absolute). Tests fake it.
	newRunner func(root, cfgPath, caDir string) (engine.Starter, error)
	// admin makes the config's ADMIN_EMAIL an admin through Clerk after a
	// successful install; nil skips it. Tests fake it.
	admin func(context.Context, config.Config) (clerkadmin.Result, error)
}

func init() {
	registerInstall(defaultRegistry, installIO{
		stdin: os.Stdin, stdout: os.Stdout, stderr: os.Stderr, getenv: os.Getenv,
		newRunner: engineRunner,
		admin:     clerkadmin.ForConfig,
	})
}

// engineRunner is the real engine: deploy-server.sh driven by this binary.
// A non-default CA directory is passed on so the engine and the wizard
// agree on where the CA lives.
func engineRunner(root, cfgPath, caDir string) (engine.Starter, error) {
	bin, err := os.Executable()
	if err != nil {
		return nil, err
	}
	r := engine.Runner{RepoRoot: root, ConfigPath: cfgPath, InstallerBin: bin}
	if caDir != "" && caDir != defaultCADir {
		r.Env = append(r.Env, "ACHILLES_CA_DIR_OVERRIDE="+caDir)
	}
	return r, nil
}

func registerInstall(r *Registry, sio installIO) { r.Register("install", installCmd(r, sio)) }

// repoDir picks the checkout to install from: --repo, else the working
// directory when it is a checkout, else the directory holding this binary
// when that is a checkout (install-onprem.sh puts it at <dir>/achilles-installer,
// so `--dir` installs keep working when run from elsewhere), else
// /opt/projectachilles.
func repoDir(flagVal string) string {
	return pickRepoDir(flagVal, os.Getwd, os.Executable)
}

func pickRepoDir(flagVal string, getwd, executable func() (string, error)) string {
	if flagVal != "" {
		return flagVal
	}
	isCheckout := func(dir string) bool {
		_, err := os.Stat(filepath.Join(dir, "scripts", "deploy-server.sh"))
		return err == nil
	}
	if wd, err := getwd(); err == nil && isCheckout(wd) {
		return wd
	}
	if exe, err := executable(); err == nil {
		if real, err := filepath.EvalSymlinks(exe); err == nil {
			exe = real
		}
		if dir := filepath.Dir(exe); isCheckout(dir) {
			return dir
		}
	}
	return defaultRepoDir
}

func installCmd(r *Registry, sio installIO) Handler {
	return func(ctx context.Context, args []string) error {
		flags := newFlagSet("install", sio.stderr)
		cfgFile := flags.String("config", "", "deploy.config.env to install from without prompts (with --yes)")
		yes := flags.Bool("yes", false, "run unattended: no wizard, no confirmation")
		repo := flags.String("repo", "", repoFlagHelp)
		caDir := flags.String("ca-dir", defaultCADir, "where an existing ProjectAchilles CA lives")
		if err := parseFlags(flags, args); err != nil {
			return helpOK(err)
		}
		if *cfgFile != "" || *yes {
			return unattended(ctx, sio, repoDir(*repo), *cfgFile, *yes, *caDir)
		}
		if err := tui.CheckInteractive(sio.stdin, sio.stdout, sio.getenv("TERM")); err != nil {
			return err
		}

		root := repoDir(*repo)
		cfgPath := filepath.Join(root, "deploy.config.env")
		var existing *config.Config
		switch c, err := config.Load(cfgPath); {
		case err == nil:
			existing = &c
		case !errors.Is(err, fs.ErrNotExist):
			return fmt.Errorf("reading %s: %w", cfgPath, err)
		}
		deps, err := hostDeps(root, cfgPath, *caDir, func() (engine.Starter, error) {
			return sio.newRunner(root, cfgPath, *caDir)
		})
		if err != nil {
			return err
		}

		out, err := tui.Run(ctx, deps, existing, sio.stdin, sio.stdout)
		if err != nil {
			return err
		}
		switch out.Action {
		case tui.ActionUpgrade, tui.ActionStatus:
			return handOff(r, out.Action.String(), root, *caDir, sio.stdout, sio.stderr)
		case tui.ActionInstall:
			if out.Summary != "" {
				fmt.Fprintln(sio.stdout, out.Summary)
			} else {
				fmt.Fprintf(sio.stdout, "ProjectAchilles is installed: https://%s\n", out.Config.AchillesDomain)
			}
			return nil
		case tui.ActionInstallFailed:
			return fmt.Errorf("the install did not finish. Your settings are saved in %s: run achilles-installer install again "+
				"(Reconfigure), or unattended: sudo %s install --config %s --yes", cfgPath, filepath.Join(root, "achilles-installer"), cfgPath)
		default:
			return errors.New("cancelled; nothing on this server was changed")
		}
	}
}

// handOff runs the day-2 command the wizard ended with (upgrade or status)
// on the checkout and CA directory the wizard used: without --repo and
// --ca-dir it would fall back to the defaults, a different install.
func handOff(r *Registry, name, root, caDir string, stdout, stderr io.Writer) error {
	if code := r.Run([]string{name, "--repo", root, "--ca-dir", caDir}, stdout, stderr); code != 0 {
		return fmt.Errorf("%s exited with status %d", name, code)
	}
	return nil
}

// unattended is `install --config FILE [--yes]`: no wizard and no TTY
// needed. The config is validated first (problems: exit 1). Without --yes it
// only prints what would run (exit 2). With --yes it runs the engine,
// printing its events as plain lines, and exits with the engine's status.
func unattended(ctx context.Context, sio installIO, root, cfgFile string, yes bool, caDir string) error {
	if cfgFile == "" {
		return exitWith(2, errors.New("--yes needs --config FILE (the deploy.config.env to install from)"))
	}
	path, err := filepath.Abs(cfgFile)
	if err != nil {
		return err
	}
	c, err := config.Load(path)
	if err != nil {
		return err
	}
	if ps := c.Validate(); len(ps) > 0 {
		for _, p := range ps {
			fmt.Fprintf(sio.stderr, "%s: %s\n", p.Key, p.Message)
		}
		return exitWith(1, fmt.Errorf("%s: %d setting(s) need fixing; nothing was changed", path, len(ps)))
	}
	// The engine always runs on <root>/deploy.config.env, so backup (and a
	// restore elsewhere) finds the config the install really used.
	inRepo := filepath.Join(root, "deploy.config.env")
	same := sameFile(path, inRepo)
	if !yes {
		if !same {
			fmt.Fprintf(sio.stdout, "Would copy %s to %s (mode 600), then run, in %s:\n  bash scripts/deploy-server.sh %s\n",
				path, inRepo, root, inRepo)
		} else {
			fmt.Fprintf(sio.stdout, "Would run, in %s:\n  bash scripts/deploy-server.sh %s\n", root, path)
		}
		fmt.Fprintf(sio.stdout, "with ACHILLES_PROGRESS=1 ACHILLES_NONINTERACTIVE=1 (no prompts). Nothing was changed.\n"+
			"To install, add --yes:\n  achilles-installer install --config %s --yes\n", path)
		return exitWith(2, nil)
	}
	if !same {
		if err := copyConfig(path, inRepo); err != nil {
			return fmt.Errorf("copying %s into the checkout: %w", path, err)
		}
		path = inRepo
	}

	starter, err := sio.newRunner(root, path, caDir)
	if err != nil {
		return err
	}
	if err := driveEngine(ctx, sio.stdout, starter); err != nil {
		return err
	}
	if sio.getenv("ACHILLES_RENDER_ONLY") != "1" { // render-only says so itself
		fmt.Fprintf(sio.stdout, "ProjectAchilles is installed: https://%s\n", c.AchillesDomain)
		firstAdmin(ctx, sio, c)
	}
	return nil
}

// firstAdmin invites (or promotes) ADMIN_EMAIL. The stack is already up, so a
// failure only warns, with the manual steps.
func firstAdmin(ctx context.Context, sio installIO, c config.Config) {
	if c.AdminEmail == "" || sio.admin == nil {
		fmt.Fprintln(sio.stdout, "First admin: "+clerkadmin.ManualSteps(c.AchillesDomain))
		return
	}
	r, err := sio.admin(ctx, c)
	if err != nil {
		fmt.Fprintf(sio.stderr, "warning: could not make %s an admin: %v\n%s\n", c.AdminEmail, err, clerkadmin.ManualSteps(c.AchillesDomain))
		return
	}
	fmt.Fprintln(sio.stdout, "First admin: "+r.Message())
}

// driveEngine runs one engine run to completion, printing its events as
// plain lines, and maps the outcome to the exit codes install uses:
// 130 when interrupted, the engine's own status when it fails.
func driveEngine(ctx context.Context, w io.Writer, starter engine.Starter) error {
	// The engine runs in its own process group, so a terminal's ctrl+c
	// reaches only this process: cancel the run (which kills the group).
	ctx, stop := signal.NotifyContext(ctx, os.Interrupt, syscall.SIGTERM)
	defer stop()
	events, wait, err := starter.Start(ctx)
	if err != nil {
		return fmt.Errorf("could not start scripts/deploy-server.sh: %w", err)
	}
	for ev := range events {
		printEvent(w, ev)
	}
	code := engine.ExitCode(wait())
	switch {
	case ctx.Err() != nil:
		return exitWith(130, errors.New("interrupted: the engine was stopped. Running the same command again is safe"))
	case code != 0:
		return exitWith(code, fmt.Errorf("the engine failed (exit status %d). Fix the problem above and run the same command again: it is safe to re-run", code))
	}
	return nil
}

// printEvent writes one engine event as a plain line. Text is sanitised, so
// a log or a pipe never receives escape sequences from the script.
func printEvent(w io.Writer, ev engine.Event) {
	switch ev.Kind {
	case engine.Phase:
		fmt.Fprintf(w, "==> %s\n", engine.Sanitize(ev.Text))
	case engine.OK:
		fmt.Fprintf(w, "  ✓ %s\n", ev.ID)
	case engine.Warn:
		fmt.Fprintf(w, "  ! %s\n", engine.Sanitize(ev.Text))
	case engine.Fail:
		fmt.Fprintf(w, "error: %s\n", engine.Sanitize(ev.Text))
	default:
		fmt.Fprintln(w, engine.Sanitize(ev.Text))
	}
}

// failedStart is a Starter whose Start returns err.
type failedStart struct{ err error }

func (f failedStart) Start(context.Context) (<-chan engine.Event, func() error, error) {
	return nil, nil, f.err
}

// sameFile reports whether a and b name the same existing file.
func sameFile(a, b string) bool {
	if filepath.Clean(a) == filepath.Clean(b) {
		return true
	}
	fa, err := os.Stat(a)
	if err != nil {
		return false
	}
	fb, err := os.Stat(b)
	return err == nil && os.SameFile(fa, fb)
}

// copyConfig writes src's bytes to dst (mode 0600) through a temporary file
// in dst's directory, so a reader never sees a partial config.
func copyConfig(src, dst string) error {
	b, err := os.ReadFile(src)
	if err != nil {
		return err
	}
	tmp, err := os.CreateTemp(filepath.Dir(dst), ".deploy.config.env-")
	if err != nil {
		return err
	}
	defer os.Remove(tmp.Name())
	if err := tmp.Chmod(0o600); err != nil {
		tmp.Close()
		return err
	}
	if _, err := tmp.Write(b); err != nil {
		tmp.Close()
		return err
	}
	if err := tmp.Close(); err != nil {
		return err
	}
	return os.Rename(tmp.Name(), dst)
}
