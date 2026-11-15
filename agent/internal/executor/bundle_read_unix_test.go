//go:build !windows

package executor

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// The legacy bundle_results.json lives in /tmp/F0, under world-writable /tmp.
// A local user must not be able to feed the root agent a file through it: not
// by owning or opening up the folder, not by a symlink, not by a huge file.

func writeBundle(t *testing.T, dir, content string) {
	t.Helper()
	if err := os.WriteFile(filepath.Join(dir, bundleResultsName), []byte(content), 0o644); err != nil {
		t.Fatal(err)
	}
}

func trustedDir(t *testing.T) string {
	t.Helper()
	dir := t.TempDir()
	if err := os.Chmod(dir, 0o755); err != nil {
		t.Fatal(err)
	}
	return dir
}

func TestReadBundleResultsReadsATrustedSharedDir(t *testing.T) {
	dir := trustedDir(t)
	writeBundle(t, dir, `{"bundle_id":"x"}`)

	data, found, err := readBundleResults(dir, true)
	if !found || err != nil || string(data) != `{"bundle_id":"x"}` {
		t.Fatalf("got data=%q found=%v err=%v", data, found, err)
	}

	removeBundleResults(dir, true)
	if _, statErr := os.Stat(filepath.Join(dir, bundleResultsName)); !os.IsNotExist(statErr) {
		t.Fatalf("processed file was not removed: %v", statErr)
	}
}

func TestReadBundleResultsReportsNothingWhenTheFileIsAbsent(t *testing.T) {
	if _, found, err := readBundleResults(trustedDir(t), true); found || err != nil {
		t.Fatalf("found=%v err=%v for an empty dir", found, err)
	}
	if _, found, err := readBundleResults(filepath.Join(t.TempDir(), "missing"), false); found || err != nil {
		t.Fatalf("found=%v err=%v for a missing dir", found, err)
	}
}

func TestReadBundleResultsIgnoresASharedDirOthersCanWrite(t *testing.T) {
	for _, mode := range []os.FileMode{0o777, 0o775, 0o757} {
		dir := t.TempDir()
		writeBundle(t, dir, `{"bundle_id":"planted"}`)
		if err := os.Chmod(dir, mode); err != nil {
			t.Fatal(err)
		}
		if data, found, _ := readBundleResults(dir, true); found || data != nil {
			t.Errorf("mode %o: read %q from a shared dir others can write", mode, data)
		}
	}
}

func TestReadBundleResultsIgnoresASymlinkedSharedDir(t *testing.T) {
	target := trustedDir(t)
	writeBundle(t, target, `{"bundle_id":"planted"}`)
	link := filepath.Join(t.TempDir(), "F0")
	if err := os.Symlink(target, link); err != nil {
		t.Fatal(err)
	}
	if data, found, _ := readBundleResults(link, true); found || data != nil {
		t.Fatalf("followed a symlinked shared dir: %q", data)
	}
}

func TestReadBundleResultsRefusesASymlinkedFile(t *testing.T) {
	secret := filepath.Join(t.TempDir(), "secret")
	if err := os.WriteFile(secret, []byte("root-only content"), 0o600); err != nil {
		t.Fatal(err)
	}
	for _, shared := range []bool{true, false} {
		dir := trustedDir(t)
		if err := os.Symlink(secret, filepath.Join(dir, bundleResultsName)); err != nil {
			t.Fatal(err)
		}
		data, found, err := readBundleResults(dir, shared)
		if !found || err == nil || data != nil {
			t.Errorf("shared=%v: a symlinked file must be refused, got data=%q found=%v err=%v", shared, data, found, err)
		}
	}
}

func TestReadBundleResultsRefusesAnOversizedFile(t *testing.T) {
	dir := trustedDir(t)
	f, err := os.Create(filepath.Join(dir, bundleResultsName))
	if err != nil {
		t.Fatal(err)
	}
	// Sparse: the size is over the limit without writing the bytes.
	if err := f.Truncate(maxBundleResultsBytes + 1); err != nil {
		t.Fatal(err)
	}
	f.Close()

	data, found, err := readBundleResults(dir, false)
	if !found || err == nil || data != nil {
		t.Fatalf("an oversized file must be refused, got %d bytes found=%v err=%v", len(data), found, err)
	}
	if !strings.Contains(err.Error(), "limit") {
		t.Fatalf("error should name the limit: %v", err)
	}
}

func TestReadBundleResultsRefusesADirectoryNamedLikeTheFile(t *testing.T) {
	dir := trustedDir(t)
	if err := os.Mkdir(filepath.Join(dir, bundleResultsName), 0o755); err != nil {
		t.Fatal(err)
	}
	if _, found, err := readBundleResults(dir, false); !found || err == nil {
		t.Fatalf("a directory must be refused, found=%v err=%v", found, err)
	}
}
