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
