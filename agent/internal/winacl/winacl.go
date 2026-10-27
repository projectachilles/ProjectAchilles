// Package winacl builds the icacls command lines that restrict agent files to
// SYSTEM and Administrators on Windows.
//
// Kept free of build tags so the exact arguments can be tested on any platform.
package winacl

import "fmt"

// Well-known SIDs in the "*SID" form icacls accepts. Account names such as
// "BUILTIN\Administrators" are localized ("BUILTIN\Administradores" on
// Spanish Windows), and an unresolvable name makes icacls fail with exit
// status 1332 without applying anything, not even /inheritance:r.
const (
	SIDLocalSystem    = "*S-1-5-18"
	SIDAdministrators = "*S-1-5-32-544"
)

// RestrictArgs returns the icacls argv that removes inherited ACEs from path
// and grants only LocalSystem and BUILTIN\Administrators, with the given
// icacls permission lists (e.g. "F", "RX", "R,W").
func RestrictArgs(path, systemPerms, adminPerms string) []string {
	return []string{
		"icacls", path,
		"/inheritance:r",
		"/grant:r", fmt.Sprintf("%s:(%s)", SIDLocalSystem, systemPerms),
		"/grant:r", fmt.Sprintf("%s:(%s)", SIDAdministrators, adminPerms),
	}
}
