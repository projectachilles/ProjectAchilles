//go:build windows

package config

import (
	"fmt"

	"golang.org/x/sys/windows"

	"github.com/f0rt1ka/achilles-agent/internal/winacl"
)

// CheckTrustedOwner returns an error unless path is owned by LocalSystem or
// BUILTIN\Administrators (winacl.TrustedOwner). Under C:\ any signed-in user
// can create a folder, and its creator keeps WRITE_DAC: a C:\F0 made by a
// non-administrator could have its agent binary swapped for what the service
// runs as SYSTEM.
func CheckTrustedOwner(path string) error {
	sd, err := windows.GetNamedSecurityInfo(path, windows.SE_FILE_OBJECT, windows.OWNER_SECURITY_INFORMATION)
	if err != nil {
		return fmt.Errorf("read the owner of %s: %w", path, err)
	}
	owner, _, err := sd.Owner()
	if err != nil || owner == nil {
		return fmt.Errorf("read the owner of %s: %v", path, err)
	}
	if sid := owner.String(); !winacl.TrustedOwner(sid) {
		return fmt.Errorf("%s is owned by %s, not SYSTEM or Administrators; a non-administrator may have created it and could replace the agent. Check what is in it, remove it, and re-run", path, sid)
	}
	return nil
}
