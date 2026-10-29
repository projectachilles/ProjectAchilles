package service

import (
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func writeFile(t *testing.T, path, content string) {
	t.Helper()
	if err := os.WriteFile(path, []byte(content), 0755); err != nil {
		t.Fatal(err)
	}
}

func readFile(t *testing.T, path string) string {
	t.Helper()
	b, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	return string(b)
}

func onlyEntries(t *testing.T, dir string, want ...string) {
	t.Helper()
	entries, err := os.ReadDir(dir)
	if err != nil {
		t.Fatal(err)
	}
	var got []string
	for _, e := range entries {
		got = append(got, e.Name())
	}
	if strings.Join(got, ",") != strings.Join(want, ",") {
		t.Fatalf("%s holds %v, want %v", dir, got, want)
	}
}

// The elevated PowerShell the enroll one-liner runs in starts in
// C:\Windows\System32; the service must still end up in the agent folder.
func TestPlaceBinaryCopiesIntoAMissingAgentFolder(t *testing.T) {
	root := t.TempDir()
	src := filepath.Join(root, "Downloads", "achilles-agent")
	if err := os.MkdirAll(filepath.Dir(src), 0755); err != nil {
		t.Fatal(err)
	}
	writeFile(t, src, "agent v1")
	dst := filepath.Join(root, "f0", "achilles-agent")

	copied, err := placeBinary(src, dst)
	if err != nil {
		t.Fatalf("placeBinary: %v", err)
	}
	if !copied {
		t.Fatal("copied = false, want true")
	}
	if got := readFile(t, dst); got != "agent v1" {
		t.Fatalf("dst holds %q", got)
	}
	if got := readFile(t, src); got != "agent v1" {
		t.Fatalf("the downloaded file must be left alone, holds %q", got)
	}
	onlyEntries(t, filepath.Join(root, "f0"), "achilles-agent") // no temp file left
}

func TestPlaceBinaryIsANoOpWhenAlreadyInPlace(t *testing.T) {
	dir := t.TempDir()
	dst := filepath.Join(dir, "achilles-agent")
	writeFile(t, dst, "agent v1")
	before, _ := os.Stat(dst)

	copied, err := placeBinary(dst, dst)
	if err != nil || copied {
		t.Fatalf("placeBinary(dst, dst) = %v, %v; want false, nil", copied, err)
	}
	after, _ := os.Stat(dst)
	if !os.SameFile(before, after) {
		t.Fatal("the file in place was replaced")
	}
	onlyEntries(t, dir, "achilles-agent")
}

// os.Executable can return a path spelled differently from the canonical one
// (a symlinked folder, different case on Windows): the same file is not copied.
func TestPlaceBinaryRecognisesTheSameFileUnderAnotherPath(t *testing.T) {
	root := t.TempDir()
	real := filepath.Join(root, "f0")
	if err := os.MkdirAll(real, 0755); err != nil {
		t.Fatal(err)
	}
	dst := filepath.Join(real, "achilles-agent")
	writeFile(t, dst, "agent v1")
	link := filepath.Join(root, "link")
	if err := os.Symlink(real, link); err != nil {
		t.Skipf("symlinks unavailable: %v", err)
	}

	copied, err := placeBinary(filepath.Join(link, "achilles-agent"), dst)
	if err != nil || copied {
		t.Fatalf("placeBinary via link = %v, %v; want false, nil", copied, err)
	}
}

// Re-installing over an existing agent: Windows can rename but not overwrite
// a running executable, so the old file is moved aside first.
func TestPlaceBinaryReplacesAnExistingAgent(t *testing.T) {
	root := t.TempDir()
	src := filepath.Join(root, "new-agent")
	writeFile(t, src, "agent v2")
	dir := filepath.Join(root, "f0")
	if err := os.MkdirAll(dir, 0755); err != nil {
		t.Fatal(err)
	}
	dst := filepath.Join(dir, "achilles-agent")
	writeFile(t, dst, "agent v1")
	writeFile(t, dst+replacedSuffix, "leftover from an earlier install")

	copied, err := placeBinary(src, dst)
	if err != nil || !copied {
		t.Fatalf("placeBinary = %v, %v; want true, nil", copied, err)
	}
	if got := readFile(t, dst); got != "agent v2" {
		t.Fatalf("dst holds %q", got)
	}
	if got := readFile(t, dst+replacedSuffix); got != "agent v1" {
		t.Fatalf("the previous agent should be set aside, found %q", got)
	}

	removeReplaced(dst)
	onlyEntries(t, dir, "achilles-agent")
}

func TestPlaceBinaryRestoresTheOldAgentWhenTheSwapFails(t *testing.T) {
	root := t.TempDir()
	src := filepath.Join(root, "new-agent")
	writeFile(t, src, "agent v2")
	dir := filepath.Join(root, "f0")
	if err := os.MkdirAll(dir, 0755); err != nil {
		t.Fatal(err)
	}
	dst := filepath.Join(dir, "achilles-agent")
	writeFile(t, dst, "agent v1")

	orig := rename
	t.Cleanup(func() { rename = orig })
	rename = func(from, to string) error {
		if to == dst && from != dst+replacedSuffix {
			return errors.New("sharing violation")
		}
		return orig(from, to)
	}

	copied, err := placeBinary(src, dst)
	if err == nil || copied {
		t.Fatalf("placeBinary = %v, %v; want false and an error", copied, err)
	}
	if !strings.Contains(err.Error(), dst) {
		t.Errorf("error %q should name %s", err, dst)
	}
	if got := readFile(t, dst); got != "agent v1" {
		t.Fatalf("the old agent was not restored, dst holds %q", got)
	}
	onlyEntries(t, dir, "achilles-agent")
}

func TestPlaceBinaryRefusesANonFileAtTheCanonicalPath(t *testing.T) {
	root := t.TempDir()
	src := filepath.Join(root, "new-agent")
	writeFile(t, src, "agent v2")
	dst := filepath.Join(root, "achilles-agent")
	if err := os.Mkdir(dst, 0755); err != nil {
		t.Fatal(err)
	}

	if copied, err := placeBinary(src, dst); err == nil || copied {
		t.Fatalf("placeBinary onto a directory = %v, %v; want an error", copied, err)
	}
	if fi, err := os.Stat(dst); err != nil || !fi.IsDir() {
		t.Fatal("the directory at dst was touched")
	}
}

func TestPlaceBinaryFailsCleanlyWhenTheSourceIsMissing(t *testing.T) {
	root := t.TempDir()
	dst := filepath.Join(root, "f0", "achilles-agent")
	if copied, err := placeBinary(filepath.Join(root, "missing"), dst); err == nil || copied {
		t.Fatalf("placeBinary(missing) = %v, %v; want an error", copied, err)
	}
	if _, err := os.Stat(dst); !os.IsNotExist(err) {
		t.Fatal("dst should not exist")
	}
}

func TestOutOfPlaceWarning(t *testing.T) {
	root := t.TempDir()
	canonical := filepath.Join(root, "f0", "achilles-agent")
	if err := os.MkdirAll(filepath.Dir(canonical), 0755); err != nil {
		t.Fatal(err)
	}
	writeFile(t, canonical, "agent")
	other := filepath.Join(root, "achilles-agent")
	writeFile(t, other, "agent")

	if w := outOfPlaceWarning(canonical, canonical); w != "" {
		t.Errorf("warning for the canonical path: %q", w)
	}
	w := outOfPlaceWarning(other, canonical)
	for _, want := range []string{other, canonical, "--install"} {
		if !strings.Contains(w, want) {
			t.Errorf("warning %q should mention %q", w, want)
		}
	}
}
