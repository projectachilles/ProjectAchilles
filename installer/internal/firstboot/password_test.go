package firstboot

import (
	"context"
	"reflect"
	"strings"
	"testing"
)

func TestValidatePassword(t *testing.T) {
	tests := []struct {
		name, pw, confirm, wantErr string
	}{
		{"too short", "short", "short", "Use at least 12 characters."},
		{"mismatch", "abcdefghijkl", "abcdefghijkm", "The two passwords don't match."},
		{"contains user", "MyAchillesPass1", "MyAchillesPass1", `Don't use "achilles" in the password.`},
		{"ok", "correct-horse-battery", "correct-horse-battery", ""},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			err := ValidatePassword(tc.pw, tc.confirm)
			if tc.wantErr == "" {
				if err != nil {
					t.Fatalf("unexpected %v", err)
				}
				return
			}
			if err == nil || err.Error() != tc.wantErr {
				t.Fatalf("got %v, want %q", err, tc.wantErr)
			}
		})
	}
}

func TestSetPasswordUsesStdin(t *testing.T) {
	h := newFakeHost()
	pw := "correct-horse-battery"
	if err := SetPassword(context.Background(), h, AdminUser, pw); err != nil {
		t.Fatal(err)
	}
	calls := h.calls()
	if len(calls) != 1 || !reflect.DeepEqual(calls[0].argv, []string{"chpasswd"}) {
		t.Fatalf("calls = %+v", calls)
	}
	if string(calls[0].stdin) != "achilles:"+pw+"\n" {
		t.Fatalf("stdin = %q", calls[0].stdin)
	}
	for _, c := range calls {
		if strings.Contains(strings.Join(c.argv, " "), pw) {
			t.Fatal("password leaked into argv")
		}
	}
}
