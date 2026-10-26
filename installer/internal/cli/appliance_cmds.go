package cli

import (
	"context"
	"fmt"
	"os"
	"os/exec"
	"strings"

	"github.com/charmbracelet/x/term"

	"github.com/projectachilles/ProjectAchilles/installer/internal/appliance"
	"github.com/projectachilles/ProjectAchilles/installer/internal/firstboot"
)

func init() {
	registerAppliance(defaultRegistry, func() bool { return os.Geteuid() == 0 })
}

func registerAppliance(r *Registry, isRoot func() bool) {
	// Runs as the achilles user and calls sudo itself.
	r.Register("appliance menu", withSignals(func(ctx context.Context, _ []string) error {
		return appliance.Menu(ctx, appliance.MenuDeps{
			UI:     appliance.FormUI{},
			Exists: firstboot.OSHost{}.Exists,
			Exec: func(ctx context.Context, name string, args ...string) error {
				cmd := exec.CommandContext(ctx, name, args...)
				cmd.Stdin, cmd.Stdout, cmd.Stderr = os.Stdin, os.Stdout, os.Stderr
				return cmd.Run()
			},
			Out:        os.Stdout,
			IsTerminal: func() bool { return term.IsTerminal(os.Stdin.Fd()) },
		})
	}))
	r.Register("appliance issue", func(_ context.Context, args []string) error {
		if isRoot != nil && !isRoot() {
			return fmt.Errorf("needs root: sudo %s %s", os.Args[0], strings.Join(append([]string{"appliance", "issue"}, args...), " "))
		}
		return appliance.WriteIssue(firstboot.OSHost{})
	})
}
