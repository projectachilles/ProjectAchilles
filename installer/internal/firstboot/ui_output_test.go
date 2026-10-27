package firstboot

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

// achilles-firstboot.service gives first boot tty1 as stdin/stdout and sends
// stderr to the journal. huh draws on stderr unless told otherwise, so a
// first-boot form must draw on stdout or tty1 stays blank.
func TestFormUIDrawsOnStdoutNotStderr(t *testing.T) {
	dir := t.TempDir()
	out, err := os.Create(filepath.Join(dir, "stdout"))
	if err != nil {
		t.Fatal(err)
	}
	errf, err := os.Create(filepath.Join(dir, "stderr"))
	if err != nil {
		t.Fatal(err)
	}
	in, inW, err := os.Pipe() // stays open and empty: the form waits for input
	if err != nil {
		t.Fatal(err)
	}
	defer inW.Close()
	oldIn, oldOut, oldErr := os.Stdin, os.Stdout, os.Stderr
	os.Stdin, os.Stdout, os.Stderr = in, out, errf
	defer func() { os.Stdin, os.Stdout, os.Stderr = oldIn, oldOut, oldErr }()

	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	_ = FormUI{}.Notice(ctx, "drawn-on-tty1")

	os.Stdin, os.Stdout, os.Stderr = oldIn, oldOut, oldErr
	gotOut, _ := os.ReadFile(out.Name())
	gotErr, _ := os.ReadFile(errf.Name())
	// A file has no window size, so only the terminal setup is drawn; the
	// hide-cursor sequence proves the program writes to stdout.
	if !strings.Contains(string(gotOut), "\x1b[?25l") {
		t.Errorf("form did not draw on stdout (tty1); stdout=%q", gotOut)
	}
	if len(gotErr) != 0 {
		t.Errorf("form wrote to stderr (the journal): %q", gotErr)
	}
}
