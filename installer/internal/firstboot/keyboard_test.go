package firstboot

import (
	"context"
	"errors"
	"reflect"
	"strings"
	"testing"
)

func TestApplyKeyboardWritesDefaultsAndRunsSetupcon(t *testing.T) {
	h := newFakeHost()
	if err := ApplyKeyboard(context.Background(), h, Layouts[1]); err != nil {
		t.Fatal(err)
	}
	got := string(h.files[KeyboardPath])
	for _, want := range []string{`XKBLAYOUT="latam"`, `XKBVARIANT=""`, `XKBMODEL="pc105"`} {
		if !strings.Contains(got, want) {
			t.Errorf("%s missing %s:\n%s", KeyboardPath, want, got)
		}
	}
	calls := h.calls()
	if len(calls) != 1 || !reflect.DeepEqual(calls[0].argv, []string{"setupcon", "--force", "--keyboard-only"}) {
		t.Fatalf("calls = %+v", calls)
	}
	if len(h.log) != 2 || h.log[0].write != KeyboardPath {
		t.Fatalf("file must be written before setupcon runs: %+v", h.log)
	}
}

func TestLayoutsOrder(t *testing.T) {
	var ids []string
	for _, l := range Layouts {
		ids = append(ids, l.ID)
	}
	if want := []string{"us", "latam", "es", "gb", "de", "fr"}; !reflect.DeepEqual(ids, want) {
		t.Fatalf("got %v", ids)
	}
}

const baseLstFixture = `! model
  pc104           Generic 104-key PC
  pc105           Generic 105-key PC

! layout
  us              English (US)
  latam           Spanish (Latin American)

! variant
  intl            us: English (US, intl., with dead keys)
`

func TestKnownXKBLayout(t *testing.T) {
	for code, want := range map[string]bool{"latam": true, "us": true, "xx": false, "pc105": false, "intl": false, "": false} {
		if got := KnownXKBLayout([]byte(baseLstFixture), code); got != want {
			t.Errorf("KnownXKBLayout(%q) = %v, want %v", code, got, want)
		}
	}
}

func TestApplyKeyboardRejectsShellMetacharacters(t *testing.T) {
	for _, l := range []Layout{
		{XKBLayout: "us\"; rm -rf /; \""},
		{XKBLayout: "us$(id)"},
		{XKBLayout: "US"},
		{XKBLayout: ""},
		{XKBLayout: "us", XKBVariant: "a b"},
		{XKBLayout: "us", XKBVariant: "`id`"},
	} {
		f := newFakeHost()
		if err := ApplyKeyboard(context.Background(), f, l); err == nil {
			t.Errorf("accepted %+v", l)
		}
		if f.Exists(KeyboardPath) {
			t.Errorf("wrote file for %+v", l)
		}
	}
	f := newFakeHost()
	if err := ApplyKeyboard(context.Background(), f, Layout{XKBLayout: "latam", XKBVariant: "dvorak-intl_1"}); err != nil {
		t.Fatal(err)
	}
}

// The file is what matters (keyboard-setup applies it on the next boot):
// setupcon failing on an odd console must not restart first boot.
func TestApplyKeyboardSetupconFailureIsNonFatal(t *testing.T) {
	h := newFakeHost()
	h.on([]string{"setupcon"}, "setupcon: cannot open /dev/tty0", errors.New("exit status 1"))
	if err := ApplyKeyboard(context.Background(), h, Layouts[1]); err != nil {
		t.Fatalf("err = %v", err)
	}
	if !strings.Contains(string(h.files[KeyboardPath]), `XKBLAYOUT="latam"`) {
		t.Fatalf("%s = %q", KeyboardPath, h.files[KeyboardPath])
	}
}
