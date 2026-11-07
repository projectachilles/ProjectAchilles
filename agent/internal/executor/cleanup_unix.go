//go:build !windows

package executor

import (
	"os"
	"syscall"
)

// dirIsTrusted: a folder the root agent may delete from on Linux / macOS.
// /tmp/F0 sits in world-writable /tmp, so a local user could create it first:
// only a folder owned by root (or the agent's own user) that neither group nor
// others can write is trusted.
func dirIsTrusted(info os.FileInfo) bool {
	st, ok := info.Sys().(*syscall.Stat_t)
	if !ok {
		return false
	}
	owner := int(st.Uid)
	if owner != 0 && owner != os.Geteuid() {
		return false
	}
	return info.Mode().Perm()&0o022 == 0
}
