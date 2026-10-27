// Package winacl builds the icacls command lines that restrict agent files to
// SYSTEM and Administrators on Windows.
//
// Kept free of build tags so the exact arguments can be tested on any platform.
package winacl

import (
	"fmt"
	"strings"
)

// Well-known SIDs in the "*SID" form icacls accepts. Account names such as
// "BUILTIN\Administrators" are localized ("BUILTIN\Administradores" on
// Spanish Windows), and an unresolvable name makes icacls fail with exit
// status 1332 without applying anything, not even /inheritance:r.
const (
	SIDLocalSystem    = "*S-1-5-18"
	SIDAdministrators = "*S-1-5-32-544"
	SIDOwnerRights    = "*S-1-3-4"
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

// LockDirArgs returns the icacls commands that lock an agent folder the way
// bootstrap-windows.ps1 does: owner Administrators, then a protected DACL that
// everything inside inherits, granting SYSTEM and Administrators full control
// and OWNER RIGHTS only read-control (so the owner of an item cannot rewrite
// its DACL). /L acts on the entry itself, never on a link target.
func LockDirArgs(dir string) [][]string {
	return [][]string{
		{"icacls", dir, "/setowner", SIDAdministrators, "/L", "/Q"},
		{"icacls", dir, "/inheritance:r",
			"/grant:r", SIDLocalSystem + ":(OI)(CI)F",
			"/grant:r", SIDAdministrators + ":(OI)(CI)F",
			"/grant:r", SIDOwnerRights + ":(OI)(CI)(RC)", // specific rights need their own parentheses
			"/L", "/Q"},
	}
}

// InheritOnlyArgs returns the icacls commands that give path owner
// Administrators and only the permissions it inherits from its parent.
func InheritOnlyArgs(path string) [][]string {
	return [][]string{
		{"icacls", path, "/setowner", SIDAdministrators, "/L", "/Q"},
		{"icacls", path, "/reset", "/L", "/Q"},
	}
}

// AgentDir returns the folder that holds the agent binary when the work dir
// sits directly inside it (C:\F0 holding achilles-agent.exe and tasks), the
// layout every installer uses. Otherwise ok is false: that folder could be a
// drive root or someone's Downloads, and the agent must not lock it.
//
// Plain string handling so it can be tested on any platform: Windows paths,
// either separator, compared case-insensitively.
func AgentDir(exePath, workDir string) (dir string, ok bool) {
	dir = parentDir(exePath)
	if dir == "" || strings.HasPrefix(dir, `\\`) || len(dir) < 4 || dir[1] != ':' || dir[2] != '\\' {
		return "", false
	}
	if !strings.EqualFold(parentDir(workDir), dir) {
		return "", false
	}
	return dir, true
}

// parentDir returns the Windows directory containing p, with backslash
// separators and no trailing separator, or "" when p has none.
func parentDir(p string) string {
	p = strings.TrimRight(strings.ReplaceAll(p, "/", `\`), `\`)
	i := strings.LastIndex(p, `\`)
	if i < 0 {
		return ""
	}
	return p[:i]
}
