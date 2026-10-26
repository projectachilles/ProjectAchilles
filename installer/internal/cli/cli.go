// Package cli dispatches achilles-installer subcommands.
package cli

import (
	"context"
	"errors"
	"fmt"
	"io"
	"strings"
)

// Handler runs a subcommand with the arguments that follow its name.
type Handler func(ctx context.Context, args []string) error

// commands is the full subcommand table. Handlers are registered by later tasks.
var commands = []string{
	"install", "status", "upgrade", "backup", "restore",
	"ca init", "ca renew", "ca export", "ca bootstrap",
	"firstboot", "appliance menu", "appliance issue", "version",
}

// Registry maps subcommand names (one or two words) to handlers.
type Registry struct {
	version  string
	handlers map[string]Handler
}

// NewRegistry returns a registry whose "version" command prints version.
func NewRegistry(version string) *Registry {
	return &Registry{version: version, handlers: map[string]Handler{}}
}

// Register binds name (e.g. "status" or "ca init") to h, replacing any previous handler.
func (r *Registry) Register(name string, h Handler) { r.handlers[name] = h }

// Run dispatches args and returns the process exit code.
// No args means "install". Unknown commands exit 2 with usage.
func (r *Registry) Run(args []string, stdout, stderr io.Writer) int {
	if len(args) == 0 {
		args = []string{"install"}
	}
	switch args[0] {
	case "-h", "--help", "help":
		r.usage(stdout)
		return 0
	case "version", "-v", "--version":
		fmt.Fprintf(stdout, "achilles-installer %s\n", r.version)
		return 0
	}

	name, rest, ok := r.match(args)
	if !ok {
		fmt.Fprintf(stderr, "achilles-installer: unknown command %q\n\n", strings.Join(args, " "))
		r.usage(stderr)
		return 2
	}
	h := r.handlers[name]
	if h == nil {
		fmt.Fprintf(stderr, "achilles-installer: %q is not implemented yet\n", name)
		return 1
	}
	if err := h(context.Background(), rest); err != nil {
		var ee *exitError
		if errors.As(err, &ee) {
			if ee.err != nil {
				fmt.Fprintf(stderr, "achilles-installer %s: %v\n", name, ee.err)
			}
			return ee.code
		}
		fmt.Fprintf(stderr, "achilles-installer %s: %v\n", name, err)
		return 1
	}
	return 0
}

// exitError makes Run exit with code; err (if any) is printed first.
type exitError struct {
	code int
	err  error
}

func (e *exitError) Error() string {
	if e.err != nil {
		return e.err.Error()
	}
	return fmt.Sprintf("exit status %d", e.code)
}

func (e *exitError) Unwrap() error { return e.err }

// exitWith returns an error that makes Run exit with code, printing err
// (nil prints nothing).
func exitWith(code int, err error) error { return &exitError{code: code, err: err} }

// match finds the longest known command name that prefixes args.
func (r *Registry) match(args []string) (string, []string, bool) {
	if len(args) >= 2 {
		two := args[0] + " " + args[1]
		if known(two) {
			return two, args[2:], true
		}
	}
	if known(args[0]) {
		return args[0], args[1:], true
	}
	return "", nil, false
}

func known(name string) bool {
	for _, c := range commands {
		if c == name {
			return true
		}
	}
	return false
}

func (r *Registry) usage(w io.Writer) {
	fmt.Fprintln(w, "Usage: achilles-installer [command] [flags]")
	fmt.Fprintln(w, "\nCommands (default: install):")
	for _, c := range commands {
		fmt.Fprintf(w, "  %s\n", c)
	}
}

var defaultRegistry = NewRegistry("dev")

// SetVersion sets the version reported by the default registry.
func SetVersion(v string) { defaultRegistry.version = v }

// Register binds a handler on the default registry.
func Register(name string, h Handler) { defaultRegistry.Register(name, h) }

// Run dispatches on the default registry.
func Run(args []string, stdout, stderr io.Writer) int {
	return defaultRegistry.Run(args, stdout, stderr)
}
