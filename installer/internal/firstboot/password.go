package firstboot

import (
	"context"
	"errors"
	"fmt"
	"strings"
)

// ValidatePassword applies the appliance password rule. The error texts are
// shown to the admin verbatim.
func ValidatePassword(pw, confirm string) error {
	switch {
	case len(pw) < 12:
		return errors.New("Use at least 12 characters.")
	case pw != confirm:
		return errors.New("The two passwords don't match.")
	case strings.Contains(strings.ToLower(pw), AdminUser):
		return fmt.Errorf("Don't use %q in the password.", AdminUser)
	}
	return nil
}

// SetPassword sets user's password through chpasswd. The password travels on
// stdin, never in the argument list.
func SetPassword(ctx context.Context, h Host, user, pw string) error {
	// chpasswd reads one "user:password" per line; reject anything that
	// would split or re-target the entry.
	if strings.ContainsAny(pw, "\r\n") || strings.ContainsAny(user, ":\r\n") {
		return errors.New("password or user contains a character chpasswd cannot take")
	}
	if out, err := h.Run(ctx, []byte(user+":"+pw+"\n"), "chpasswd"); err != nil {
		return fmt.Errorf("chpasswd: %w: %s", err, strings.TrimSpace(string(out)))
	}
	return nil
}
