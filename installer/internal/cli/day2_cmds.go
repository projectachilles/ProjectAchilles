package cli

import (
	"github.com/charmbracelet/x/term"

	"context"
	"errors"
	"fmt"
	"io"
	"os"
	"os/signal"
	"path/filepath"
	"slices"
	"strings"
	"syscall"

	"github.com/projectachilles/ProjectAchilles/installer/internal/config"
	"github.com/projectachilles/ProjectAchilles/installer/internal/day2"
	"github.com/projectachilles/ProjectAchilles/installer/internal/engine"
)

// day2IO is the day-2 handlers' view of the process; tests replace it.
type day2IO struct {
	stdin          io.Reader
	stdout, stderr io.Writer
	cmd            day2.Cmd
	newRunner      func(root, cfgPath, caDir string) (engine.Starter, error)
	tty            func() bool
	isRoot         func() bool // nil: no check (tests)
}

func init() {
	registerDay2(defaultRegistry, day2IO{
		stdin: os.Stdin, stdout: os.Stdout, stderr: os.Stderr,
		cmd: day2.ExecCmd{}, newRunner: engineRunner,
		tty:    func() bool { return term.IsTerminal(os.Stdout.Fd()) },
		isRoot: func() bool { return os.Geteuid() == 0 },
	})
}

// signalsToCatch is what withSignals turns into a cancel. SIGHUP is left out
// when the process started with it ignored (`nohup achilles-installer
// upgrade`): catching it would re-enable it, and an SSH disconnect would then
// cancel the command the admin asked to survive one.
func signalsToCatch(ignored func(os.Signal) bool) []os.Signal {
	sigs := []os.Signal{os.Interrupt, syscall.SIGTERM}
	if !ignored(syscall.SIGHUP) {
		sigs = append(sigs, syscall.SIGHUP)
	}
	return sigs
}

// withSignals cancels ctx on SIGINT/SIGTERM (and SIGHUP unless ignored, see
// signalsToCatch) so the day-2 commands' deferred cleanup (restart the stack,
// remove staged secrets) runs instead of the process dying with the stack
// stopped.
func withSignals(h Handler) Handler {
	return func(ctx context.Context, args []string) error {
		ctx, stop := signal.NotifyContext(ctx, signalsToCatch(signal.Ignored)...)
		defer stop()
		return h(ctx, args)
	}
}

// asRoot refuses to run h without root. deploy.config.env, the .env files
// and the Docker socket are root-only, so as another user status reports a
// healthy install as broken and the other commands fail half-way.
func asRoot(dio day2IO, name string, h Handler) Handler {
	return func(ctx context.Context, args []string) error {
		help := slices.ContainsFunc(args, func(a string) bool {
			return a == "-h" || a == "-help" || a == "--help"
		})
		if dio.isRoot != nil && !dio.isRoot() && !help {
			return fmt.Errorf("needs root: sudo %s %s", os.Args[0], strings.Join(append([]string{name}, args...), " "))
		}
		return h(ctx, args)
	}
}

func registerDay2(r *Registry, dio day2IO) {
	r.Register("status", asRoot(dio, "status", statusCmd(dio)))
	r.Register("upgrade", asRoot(dio, "upgrade", withSignals(upgradeCmd(r, dio))))
	r.Register("backup", asRoot(dio, "backup", withSignals(backupCmd(dio))))
	r.Register("restore", asRoot(dio, "restore", withSignals(restoreCmd(dio))))
}

// day2Deps builds the shared dependencies for the checkout at root. A missing
// or unreadable deploy.config.env leaves Host/TLSMode empty: status then
// reports those sections as failing instead of aborting.
func day2Deps(dio day2IO, root, caDir string) day2.Deps {
	d := day2.Deps{
		Cmd: dio.cmd, RepoDir: root, CADir: caDir, BackupDir: day2.DefaultBackupDir,
		Out: dio.stdout, In: dio.stdin,
	}
	if c, err := config.Load(filepath.Join(root, "deploy.config.env")); err == nil {
		d.Host, d.TLSMode = c.AchillesDomain, c.TLSMode
	}
	return d
}

func statusCmd(dio day2IO) Handler {
	return func(ctx context.Context, args []string) error {
		flags := newFlagSet("status", dio.stderr)
		repo := flags.String("repo", "", repoFlagHelp)
		caDir := flags.String("ca-dir", defaultCADir, "CA directory")
		if err := parseFlags(flags, args); err != nil {
			return helpOK(err)
		}
		rep, err := day2.Status(ctx, day2Deps(dio, repoDir(*repo), *caDir))
		if err != nil {
			return err
		}
		rep.Render(dio.stdout, dio.tty != nil && dio.tty())
		if !rep.OK() {
			return exitWith(1, nil)
		}
		return nil
	}
}

func upgradeCmd(r *Registry, dio day2IO) Handler {
	return func(ctx context.Context, args []string) error {
		flags := newFlagSet("upgrade", dio.stderr)
		repo := flags.String("repo", "", repoFlagHelp)
		caDir := flags.String("ca-dir", defaultCADir, "CA directory")
		ref := flags.String("ref", "", "tag or ref to upgrade to (default: the highest release tag)")
		yes := flags.Bool("yes", false, "do not ask for confirmation")
		if err := parseFlags(flags, args); err != nil {
			return helpOK(err)
		}
		root := repoDir(*repo)
		d := day2Deps(dio, root, *caDir)
		d.InstallerVersion = r.version // read at run time: main sets it after init
		cfgPath := filepath.Join(root, "deploy.config.env")
		if _, err := os.Stat(cfgPath); err != nil {
			return fmt.Errorf("%s not found: upgrade re-runs the install with the existing config", cfgPath)
		}
		d.RunEngine = runEngine(dio, root, *caDir)
		return day2.Upgrade(ctx, d, *ref, *yes)
	}
}

func backupCmd(dio day2IO) Handler {
	return func(ctx context.Context, args []string) error {
		flags := newFlagSet("backup", dio.stderr)
		repo := flags.String("repo", "", repoFlagHelp)
		caDir := flags.String("ca-dir", defaultCADir, "CA directory")
		out := flags.String("out", day2.DefaultBackupDir, "directory to write the backup into")
		if err := parseFlags(flags, args); err != nil {
			return helpOK(err)
		}
		_, err := day2.Backup(ctx, day2Deps(dio, repoDir(*repo), *caDir), *out)
		return err
	}
}

func restoreCmd(dio day2IO) Handler {
	return func(ctx context.Context, args []string) error {
		flags := newFlagSet("restore", dio.stderr)
		repo := flags.String("repo", "", repoFlagHelp)
		caDir := flags.String("ca-dir", defaultCADir, "CA directory")
		yes := flags.Bool("yes", false, "do not ask for the typed confirmation")
		// Accept FILE before or after the flags.
		var file string
		rest := args
		if len(args) > 0 && len(args[0]) > 0 && args[0][0] != '-' {
			file, rest = args[0], args[1:]
		}
		if err := flags.Parse(rest); err != nil {
			return helpOK(err)
		}
		if file == "" && flags.NArg() == 1 {
			file = flags.Arg(0)
		} else if flags.NArg() > 0 {
			return fmt.Errorf("unexpected argument %q", flags.Arg(0))
		}
		if file == "" {
			return errors.New("usage: achilles-installer restore FILE [--yes]")
		}
		root := repoDir(*repo)
		d := day2Deps(dio, root, *caDir)
		d.RunEngine = runEngine(dio, root, *caDir)
		return day2.Restore(ctx, d, file, *yes)
	}
}

// runEngine re-runs the engine on <root>/deploy.config.env the way
// `install --config … --yes` does, printing its events as plain lines.
func runEngine(dio day2IO, root, caDir string) func(context.Context) error {
	return func(ctx context.Context) error {
		if dio.newRunner == nil {
			return errors.New("no installer engine configured")
		}
		starter, err := dio.newRunner(root, filepath.Join(root, "deploy.config.env"), caDir)
		if err != nil {
			return err
		}
		return driveEngine(ctx, dio.stdout, starter)
	}
}
