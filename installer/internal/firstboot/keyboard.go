package firstboot

import (
	"bufio"
	"bytes"
	"context"
	"fmt"
	"regexp"
	"strings"
)

// xkbSafeRe is what may go into /etc/default/keyboard, a shell-sourced file.
var xkbSafeRe = regexp.MustCompile(`^[a-z0-9_-]+$`)

// SafeXKBCode reports whether code is safe to write into /etc/default/keyboard.
func SafeXKBCode(code string) bool { return xkbSafeRe.MatchString(code) }

// Layout is a keyboard choice offered on the first screen.
type Layout struct{ ID, Label, XKBLayout, XKBVariant string }

// Layouts are the layouts offered before "Other", in menu order.
var Layouts = []Layout{
	{"us", "English (US)", "us", ""},
	{"latam", "Spanish (Latin America)", "latam", ""},
	{"es", "Spanish (Spain)", "es", ""},
	{"gb", "English (UK)", "gb", ""},
	{"de", "German", "de", ""},
	{"fr", "French", "fr", ""},
}

// KnownXKBLayout reports whether code is listed in the "! layout" section of
// an xkb rules base.lst (used to validate the "Other" entry).
func KnownXKBLayout(baseLst []byte, code string) bool {
	if code == "" {
		return false
	}
	inLayout := false
	sc := bufio.NewScanner(bytes.NewReader(baseLst))
	for sc.Scan() {
		line := sc.Text()
		if strings.HasPrefix(line, "!") {
			inLayout = strings.TrimSpace(strings.TrimPrefix(line, "!")) == "layout"
			continue
		}
		if !inLayout {
			continue
		}
		if f := strings.Fields(line); len(f) > 0 && f[0] == code {
			return true
		}
	}
	return false
}

// ApplyKeyboard writes /etc/default/keyboard and applies it to the console.
// Applying it now is best effort: keyboard-setup.service applies the file on
// every boot, so a setupcon failure (an odd console) must not fail first boot.
func ApplyKeyboard(ctx context.Context, h Host, l Layout) error {
	// The file is sourced by a shell: refuse anything but plain XKB codes.
	if !SafeXKBCode(l.XKBLayout) || (l.XKBVariant != "" && !SafeXKBCode(l.XKBVariant)) {
		return fmt.Errorf("invalid keyboard layout %q / variant %q", l.XKBLayout, l.XKBVariant)
	}
	conf := fmt.Sprintf("XKBMODEL=\"pc105\"\nXKBLAYOUT=%q\nXKBVARIANT=%q\nXKBOPTIONS=\"\"\nBACKSPACE=\"guess\"\n",
		l.XKBLayout, l.XKBVariant)
	if err := h.WriteFile(KeyboardPath, []byte(conf), 0o644); err != nil {
		return fmt.Errorf("write %s: %w", KeyboardPath, err)
	}
	_, _ = h.Run(ctx, nil, "setupcon", "--force", "--keyboard-only")
	return nil
}
