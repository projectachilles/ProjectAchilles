//go:build !windows

package config

import (
	"fmt"
	"os"
	"syscall"
)

// CheckTrustedOwner returns an error unless path (not followed if it is a
// link) is owned by root. A folder or binary owned by another user could be
// swapped for what the service runs as root.
func CheckTrustedOwner(path string) error {
	fi, err := os.Lstat(path)
	if err != nil {
		return err
	}
	st, ok := fi.Sys().(*syscall.Stat_t)
	if !ok {
		return fmt.Errorf("cannot read the owner of %s", path)
	}
	if st.Uid != 0 {
		return fmt.Errorf("%s is owned by uid %d, not root; another user created it and could replace the agent. Check what is in it, remove it, and re-run", path, st.Uid)
	}
	return nil
}
