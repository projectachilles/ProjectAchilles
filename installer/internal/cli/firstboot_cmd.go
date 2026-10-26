package cli

import (
	"context"
	"errors"
	"fmt"
	"io"
	"os"
	"strings"

	"github.com/projectachilles/ProjectAchilles/installer/internal/firstboot"
	"github.com/projectachilles/ProjectAchilles/installer/internal/sysprobe"
)

// firstbootDeps are the firstboot command's collaborators; tests fake them.
type firstbootDeps struct {
	isRoot func() bool
	exists func(string) bool
	run    func(ctx context.Context) error
	stderr io.Writer
}

func init() {
	registerFirstboot(defaultRegistry, firstbootDeps{
		isRoot: func() bool { return os.Geteuid() == 0 },
		exists: firstboot.OSHost{}.Exists,
		run: func(ctx context.Context) error {
			return firstboot.Run(ctx, firstboot.OSHost{}, firstboot.FormUI{}, sysprobe.SystemLANInterfaces, defaultRegistry.version)
		},
		stderr: os.Stderr,
	})
}

// registerFirstboot registers the appliance first-boot console. Any error,
// including Ctrl+C, is returned so the process exits non-zero and systemd
// restarts it; it never falls through to a shell.
func registerFirstboot(r *Registry, d firstbootDeps) {
	r.Register("firstboot", withSignals(func(ctx context.Context, args []string) error {
		flags := newFlagSet("firstboot", d.stderr)
		force := flags.Bool("force", false, "run again although first boot has already completed")
		flags.Usage = func() {
			fmt.Fprint(flags.Output(), `Usage: achilles-installer firstboot [--force]

Runs the appliance first-boot console on tty1: keyboard, the achilles
password, network, then SSH. systemd starts it on the first boot of a new
appliance. Needs root.

  --force   run again although first boot has already completed
`)
		}
		if err := parseFlags(flags, args); err != nil {
			return helpOK(err)
		}
		if d.isRoot != nil && !d.isRoot() {
			return fmt.Errorf("needs root: sudo %s %s", os.Args[0], strings.Join(append([]string{"firstboot"}, args...), " "))
		}
		// The unit's ConditionPathExists skips us once the marker exists, so
		// this only stops a manual run from redoing a finished appliance.
		if !*force && d.exists(firstboot.MarkerPath) {
			return errors.New("First boot has already completed on this appliance. Use --force to run it again.")
		}
		return d.run(ctx)
	}))
}
