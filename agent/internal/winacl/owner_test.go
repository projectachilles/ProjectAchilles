package winacl

import "testing"

// Only SYSTEM and Administrators may own the agent folder or binary: any other
// owner (e.g. a non-admin who pre-created C:\F0) holds WRITE_DAC and could
// re-grant itself access and swap the binary the service runs as SYSTEM.
func TestTrustedOwner(t *testing.T) {
	for sid, want := range map[string]bool{
		"S-1-5-18":                         true,  // LocalSystem
		"S-1-5-32-544":                     true,  // BUILTIN\Administrators
		"*S-1-5-32-544":                    false, // icacls form, not a SID string
		"S-1-5-11":                         false, // Authenticated Users
		"S-1-5-32-545":                     false, // BUILTIN\Users
		"S-1-3-4":                          false, // OWNER RIGHTS
		"S-1-5-21-1004336348-1177238915-1": false, // a user account
		"":                                 false,
	} {
		if got := TrustedOwner(sid); got != want {
			t.Errorf("TrustedOwner(%q) = %v, want %v", sid, got, want)
		}
	}
}
