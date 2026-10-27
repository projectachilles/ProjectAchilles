package winacl

import (
	"reflect"
	"strings"
	"testing"
)

// icacls resolves account names in the machine's display language. On
// Spanish Windows "BUILTIN\Administrators" is "BUILTIN\Administradores", so
// the English name failed with exit status 1332 and icacls applied nothing,
// not even /inheritance:r: the config file holding the agent key kept its
// inherited ACLs. Well-known SIDs are the same on every locale.
func TestRestrictArgs_ExactArgv(t *testing.T) {
	const path = `C:\F0\achilles-agent.yaml`
	cases := []struct {
		name          string
		system, admin string
		want          []string
	}{
		{"config file", "R,W", "R,W", []string{
			"icacls", path,
			"/inheritance:r",
			"/grant:r", "*S-1-5-18:(R,W)",
			"/grant:r", "*S-1-5-32-544:(R,W)",
		}},
		{"binary full control", "F", "F", []string{
			"icacls", path,
			"/inheritance:r",
			"/grant:r", "*S-1-5-18:(F)",
			"/grant:r", "*S-1-5-32-544:(F)",
		}},
		{"binary at install", "RX", "F", []string{
			"icacls", path,
			"/inheritance:r",
			"/grant:r", "*S-1-5-18:(RX)",
			"/grant:r", "*S-1-5-32-544:(F)",
		}},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got := RestrictArgs(path, tc.system, tc.admin)
			if !reflect.DeepEqual(got, tc.want) {
				t.Fatalf("RestrictArgs() =\n  %q\nwant\n  %q", got, tc.want)
			}
		})
	}
}

func TestRestrictArgs_NoLocalizableAccountNames(t *testing.T) {
	for _, a := range RestrictArgs(`C:\F0\x`, "F", "F") {
		upper := strings.ToUpper(a)
		for _, name := range []string{"ADMINISTRATORS", "SYSTEM", "NT AUTHORITY", "BUILTIN"} {
			if strings.Contains(upper, name) {
				t.Errorf("argument %q names an account (%s); use a well-known SID", a, name)
			}
		}
	}
}

func TestRestrictArgs_PrincipalsAreWellKnownSIDs(t *testing.T) {
	if SIDLocalSystem != "*S-1-5-18" {
		t.Errorf("SIDLocalSystem = %q, want *S-1-5-18", SIDLocalSystem)
	}
	if SIDAdministrators != "*S-1-5-32-544" {
		t.Errorf("SIDAdministrators = %q, want *S-1-5-32-544", SIDAdministrators)
	}
	args := RestrictArgs(`C:\F0\x`, "F", "F")
	var principals []string
	for i, a := range args {
		if a == "/grant:r" && i+1 < len(args) {
			principals = append(principals, strings.SplitN(args[i+1], ":", 2)[0])
		}
	}
	want := []string{"*S-1-5-18", "*S-1-5-32-544"}
	if !reflect.DeepEqual(principals, want) {
		t.Fatalf("granted principals = %q, want %q", principals, want)
	}
}

func TestRestrictArgs_KeepsInheritanceRemoval(t *testing.T) {
	args := RestrictArgs(`C:\F0\x`, "F", "F")
	if len(args) < 3 || args[2] != "/inheritance:r" {
		t.Fatalf("want /inheritance:r right after the path, got %q", args)
	}
}

// The agent locks its own folder only in the standard layout, where the work
// dir sits directly inside the folder that holds the binary (C:\F0 holding
// achilles-agent.exe and tasks). Anything else could be a folder the agent
// does not own (a drive root, a user's Downloads), and stripping its
// inherited ACL would lock other people out of it.
func TestAgentDir(t *testing.T) {
	cases := []struct {
		name, exe, workDir string
		want               string
		ok                 bool
	}{
		{"standard layout", `C:\F0\achilles-agent.exe`, `C:\F0\tasks`, `C:\F0`, true},
		{"case and trailing separator", `c:\f0\achilles-agent.exe`, `C:\F0\Tasks\`, `c:\f0`, true},
		{"forward slashes in config", `C:\F0\achilles-agent.exe`, `C:/F0/tasks`, `C:\F0`, true},
		{"custom folder, same layout", `D:\Achilles\achilles-agent.exe`, `D:\Achilles\tasks`, `D:\Achilles`, true},
		{"work dir elsewhere", `C:\F0\achilles-agent.exe`, `D:\work\tasks`, "", false},
		{"work dir nested deeper", `C:\F0\achilles-agent.exe`, `C:\F0\x\tasks`, "", false},
		{"work dir is the binary folder", `C:\F0\achilles-agent.exe`, `C:\F0`, "", false},
		{"binary run from Downloads", `C:\Users\bob\Downloads\achilles-agent.exe`, `C:\F0\tasks`, "", false},
		{"binary at a drive root", `C:\achilles-agent.exe`, `C:\tasks`, "", false},
		{"UNC path", `\\srv\share\achilles-agent.exe`, `\\srv\share\tasks`, "", false},
		{"relative paths", `achilles-agent.exe`, `tasks`, "", false},
		{"empty work dir", `C:\F0\achilles-agent.exe`, ``, "", false},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got, ok := AgentDir(tc.exe, tc.workDir)
			if got != tc.want || ok != tc.ok {
				t.Fatalf("AgentDir(%q, %q) = (%q, %v), want (%q, %v)", tc.exe, tc.workDir, got, ok, tc.want, tc.ok)
			}
		})
	}
}

// Same lock as bootstrap-windows.ps1 step 1: owner Administrators, a
// protected DACL inherited by everything inside, and OWNER RIGHTS limited to
// read-control so whoever owns an item cannot rewrite its DACL. /L acts on
// the entry itself, never on a link target. A specific right such as RC must
// be in its own parentheses: icacls rejects "(OI)(CI)RC" with exit status 87.
func TestLockDirArgs_ExactArgv(t *testing.T) {
	const dir = `C:\F0`
	want := [][]string{
		{"icacls", dir, "/setowner", "*S-1-5-32-544", "/L", "/Q"},
		{"icacls", dir, "/inheritance:r",
			"/grant:r", "*S-1-5-18:(OI)(CI)F",
			"/grant:r", "*S-1-5-32-544:(OI)(CI)F",
			"/grant:r", "*S-1-3-4:(OI)(CI)(RC)",
			"/L", "/Q"},
	}
	if got := LockDirArgs(dir); !reflect.DeepEqual(got, want) {
		t.Fatalf("LockDirArgs() =\n  %q\nwant\n  %q", got, want)
	}
}

// The work dir gets owner Administrators and only what it inherits from the
// locked folder (bootstrap step 2), so an explicit ACE someone added to it
// does not survive.
func TestInheritOnlyArgs_ExactArgv(t *testing.T) {
	const dir = `C:\F0\tasks`
	want := [][]string{
		{"icacls", dir, "/setowner", "*S-1-5-32-544", "/L", "/Q"},
		{"icacls", dir, "/reset", "/L", "/Q"},
	}
	if got := InheritOnlyArgs(dir); !reflect.DeepEqual(got, want) {
		t.Fatalf("InheritOnlyArgs() =\n  %q\nwant\n  %q", got, want)
	}
}

func TestDirArgs_NoLocalizableAccountNames(t *testing.T) {
	all := append(LockDirArgs(`C:\F0`), InheritOnlyArgs(`C:\F0\tasks`)...)
	for _, argv := range all {
		for _, a := range argv[2:] {
			upper := strings.ToUpper(a)
			for _, name := range []string{"ADMINISTRATORS", "SYSTEM", "NT AUTHORITY", "BUILTIN", "OWNER RIGHTS"} {
				if strings.Contains(upper, name) {
					t.Errorf("argument %q names an account (%s); use a well-known SID", a, name)
				}
			}
		}
	}
}
