//go:build !windows

package config

import (
	"os"
	"strings"
	"testing"
)

func TestCheckTrustedOwnerAcceptsRoot(t *testing.T) {
	if err := CheckTrustedOwner("/"); err != nil {
		t.Fatalf("CheckTrustedOwner(/) = %v, want nil", err)
	}
}

// /opt/f0 pre-created by a non-root user would let that user swap the binary
// systemd/launchd runs as root.
func TestCheckTrustedOwnerRefusesAUserFolder(t *testing.T) {
	if os.Geteuid() == 0 {
		t.Skip("running as root: a temp dir is root-owned")
	}
	dir := t.TempDir()
	err := CheckTrustedOwner(dir)
	if err == nil || !strings.Contains(err.Error(), dir) {
		t.Fatalf("CheckTrustedOwner(user dir) = %v, want an error naming %s", err, dir)
	}
}
