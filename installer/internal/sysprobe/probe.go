// Package sysprobe runs preflight checks and discovers LAN interfaces.
// All host access goes through the System interface so tests can fake it.
package sysprobe

import (
	"context"
	"errors"
	"fmt"
	"strings"
)

// Status is the outcome severity of a Check.
type Status int

const (
	Pass Status = iota
	Warn
	Fail
)

func (s Status) String() string {
	switch s {
	case Pass:
		return "pass"
	case Warn:
		return "warn"
	default:
		return "fail"
	}
}

// ErrNotInstalled is what System.DockerVersion returns when there is no
// docker binary at all, as opposed to a daemon that does not answer.
var ErrNotInstalled = errors.New("not installed")

// Check is one preflight result.
type Check struct {
	ID, Title string
	Status    Status
	Detail    string
}

// System abstracts the host facts preflight needs.
type System interface {
	MemTotalBytes() (uint64, error)
	DiskFreeBytes(path string) (uint64, error)
	PortFree(port int) bool
	HTTPReachable(ctx context.Context, url string) error
	DockerVersion() (string, error)
	TimeSynced() (bool, error)
	IsRoot() bool
	DirExists(path string) bool
	OSRelease() (id, version string, err error)
}

// PreflightOptions tunes preflight behaviour.
type PreflightOptions struct {
	// ExistingInstall marks a re-run over a working install: busy 80/443
	// are then assumed to be our own Caddy.
	ExistingInstall bool
}

const (
	gib = uint64(1) << 30

	egressDockerURL = "https://registry-1.docker.io/v2/"
	egressGitHubURL = "https://github.com"
	egressClerkURL  = "https://api.clerk.com"
)

// Preflight runs every check and returns them in a stable order.
func Preflight(ctx context.Context, s System, o PreflightOptions) []Check {
	var out []Check
	out = append(out, checkRoot(s), checkOS(s), checkRAM(s), checkDisk(s, o))
	out = append(out, checkPort(s, 80, o), checkPort(s, 443, o))
	out = append(out,
		checkEgress(ctx, s, "egress-docker", "Docker registry reachable", egressDockerURL, "registry-1.docker.io"),
		checkEgress(ctx, s, "egress-github", "GitHub reachable", egressGitHubURL, "github.com"),
		checkEgress(ctx, s, "egress-clerk", "Clerk API reachable", egressClerkURL, "api.clerk.com"),
	)
	out = append(out, checkDocker(s), checkTime(s))
	return out
}

// ESSelfAllowed reports whether the RAM check passed, i.e. a self-hosted
// Elasticsearch container is viable.
func ESSelfAllowed(checks []Check) bool {
	for _, c := range checks {
		if c.ID == "ram" {
			return c.Status == Pass
		}
	}
	return false
}

func checkRoot(s System) Check {
	c := Check{ID: "root", Title: "Running as root"}
	if !s.IsRoot() {
		c.Status, c.Detail = Fail, "not root: run with sudo"
	}
	return c
}

func checkOS(s System) Check {
	c := Check{ID: "os", Title: "Supported operating system"}
	id, ver, err := s.OSRelease()
	if err != nil {
		c.Status, c.Detail = Fail, "could not read os-release: "+err.Error()
		return c
	}
	name := id + " " + ver
	rhel := map[string]bool{"rhel": true, "rocky": true, "almalinux": true, "centos": true, "ol": true}
	switch {
	case id == "ubuntu" && (ver == "22.04" || ver == "24.04" || ver == "26.04"):
		c.Detail = name
	case id == "debian" && (ver == "12" || strings.HasPrefix(ver, "12.")):
		c.Status, c.Detail = Warn, name+": best-effort support"
	case rhel[id] && (ver == "9" || strings.HasPrefix(ver, "9.")):
		c.Status, c.Detail = Warn, name+": best-effort support"
	default:
		c.Status, c.Detail = Fail, name+" is not supported (Ubuntu 22.04/24.04/26.04, Debian 12, RHEL-family 9)"
	}
	return c
}

func checkRAM(s System) Check {
	c := Check{ID: "ram", Title: "Memory"}
	b, err := s.MemTotalBytes()
	if err != nil {
		c.Status, c.Detail = Warn, "could not determine memory: "+err.Error()
		return c
	}
	g := float64(b) / float64(gib)
	switch {
	case b < 2*gib:
		c.Status, c.Detail = Fail, fmt.Sprintf("%.1f GiB RAM; at least 2 GiB required", g)
	case b < 4*gib:
		c.Status, c.Detail = Warn, fmt.Sprintf("%.1f GiB RAM; self-hosted Elasticsearch disabled (needs 4 GiB)", g)
	default:
		c.Detail = fmt.Sprintf("%.1f GiB RAM", g)
	}
	return c
}

// checkDisk needs 20 GiB for a fresh install (images, build cache, data).
// A re-run over a working install already holds its images and volumes in
// that space, so there it only warns, and fails below 5 GiB.
func checkDisk(s System, o PreflightOptions) Check {
	c := Check{ID: "disk", Title: "Free disk space"}
	path := "/"
	if s.DirExists("/var/lib/docker") {
		path = "/var/lib/docker"
	}
	b, err := s.DiskFreeBytes(path)
	if err != nil {
		c.Status, c.Detail = Warn, "could not determine free space on "+path+": "+err.Error()
		return c
	}
	c.Detail = fmt.Sprintf("%.1f GiB free on %s", float64(b)/float64(gib), path)
	switch {
	case o.ExistingInstall && b < 5*gib:
		c.Status = Fail
		c.Detail += "; at least 5 GiB required to rebuild an existing install"
	case o.ExistingInstall && b < 20*gib:
		c.Status = Warn
		c.Detail += "; low (a fresh install needs 20 GiB; the existing install already uses part of it)"
	case b < 20*gib:
		c.Status = Fail
		c.Detail += "; at least 20 GiB required"
	}
	return c
}

func checkPort(s System, port int, o PreflightOptions) Check {
	c := Check{ID: fmt.Sprintf("port-%d", port), Title: fmt.Sprintf("Port %d available", port)}
	if s.PortFree(port) {
		return c
	}
	if o.ExistingInstall {
		c.Detail = "in use by existing install"
		return c
	}
	c.Status, c.Detail = Fail, fmt.Sprintf("port %d is already in use", port)
	return c
}

func checkEgress(ctx context.Context, s System, id, title, url, host string) Check {
	c := Check{ID: id, Title: title}
	if err := s.HTTPReachable(ctx, url); err != nil {
		c.Status, c.Detail = Warn, fmt.Sprintf("cannot reach %s: %v", host, err)
	}
	return c
}

func checkDocker(s System) Check {
	c := Check{ID: "docker", Title: "Docker"}
	v, err := s.DockerVersion()
	switch {
	case errors.Is(err, ErrNotInstalled):
		// deploy-server.sh installs it from get.docker.com: nothing to fix.
		c.Detail = "not installed yet: the install adds it"
	case err != nil:
		// deploy-server.sh skips the install when the binary exists, so a
		// stopped daemon makes it fail at the Docker step.
		c.Status, c.Detail = Warn, "installed, but the daemon is not answering: run systemctl start docker"
	default:
		c.Detail = "Docker " + v
	}
	return c
}

func checkTime(s System) Check {
	c := Check{ID: "time", Title: "Clock synchronised"}
	ok, err := s.TimeSynced()
	switch {
	case err != nil:
		c.Status, c.Detail = Warn, "could not determine time sync status"
	case !ok:
		c.Status, c.Detail = Warn, "clock is not NTP-synchronised; certificate validity may be off"
	}
	return c
}
