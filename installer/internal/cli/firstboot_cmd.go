package cli

import (
	"context"
	"fmt"
	"os"
	"strings"

	"github.com/projectachilles/ProjectAchilles/installer/internal/firstboot"
	"github.com/projectachilles/ProjectAchilles/installer/internal/sysprobe"
)

func init() {
	registerFirstboot(defaultRegistry, func() bool { return os.Geteuid() == 0 })
}

// registerFirstboot registers the appliance first-boot console. Any error,
// including Ctrl+C, is returned so the process exits non-zero and systemd
// restarts it; it never falls through to a shell.
func registerFirstboot(r *Registry, isRoot func() bool) {
	r.Register("firstboot", withSignals(func(ctx context.Context, args []string) error {
		if isRoot != nil && !isRoot() {
			return fmt.Errorf("needs root: sudo %s %s", os.Args[0], strings.Join(append([]string{"firstboot"}, args...), " "))
		}
		return firstboot.Run(ctx, firstboot.OSHost{}, firstboot.FormUI{}, sysprobe.SystemLANInterfaces, r.version)
	}))
}
