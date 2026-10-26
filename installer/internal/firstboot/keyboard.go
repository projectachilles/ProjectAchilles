package firstboot

import (
	"bufio"
	"bytes"
	"context"
	"fmt"
	"strings"
)

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
func ApplyKeyboard(ctx context.Context, h Host, l Layout) error {
	conf := fmt.Sprintf("XKBMODEL=\"pc105\"\nXKBLAYOUT=%q\nXKBVARIANT=%q\nXKBOPTIONS=\"\"\nBACKSPACE=\"guess\"\n",
		l.XKBLayout, l.XKBVariant)
	if err := h.WriteFile(KeyboardPath, []byte(conf), 0o644); err != nil {
		return fmt.Errorf("write %s: %w", KeyboardPath, err)
	}
	if out, err := h.Run(ctx, nil, "setupcon", "--force", "--keyboard-only"); err != nil {
		return fmt.Errorf("setupcon: %w: %s", err, strings.TrimSpace(string(out)))
	}
	return nil
}
