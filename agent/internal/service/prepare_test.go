package service

import (
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// A binary already at the canonical path but owned by someone untrusted is
// rewritten as a new file (created by the installer), never reused in place.
func TestPlaceBinaryForceRewritesTheFileInPlace(t *testing.T) {
	dir := t.TempDir()
	dst := filepath.Join(dir, "achilles-agent")
	writeFile(t, dst, "agent v1")
	before, _ := os.Stat(dst)

	copied, err := placeBinary(dst, dst, true)
	if err != nil || !copied {
		t.Fatalf("placeBinary(dst, dst, force) = %v, %v; want true, nil", copied, err)
	}
	after, _ := os.Stat(dst)
	if os.SameFile(before, after) {
		t.Fatal("dst is still the original file")
	}
	if got := readFile(t, dst); got != "agent v1" {
		t.Fatalf("dst holds %q", got)
	}
	removeReplaced(dst)
	onlyEntries(t, dir, "achilles-agent")
}

type prepCalls struct {
	checked []string
	locks   int
}

func fakePrep(c *prepCalls, foreign string, lockErr error) (func(string) error, func() error) {
	check := func(p string) error {
		c.checked = append(c.checked, p)
		if p == foreign {
			return errors.New(p + " is owned by S-1-5-21-1")
		}
		return nil
	}
	lock := func() error {
		c.locks++
		return lockErr
	}
	return check, lock
}

func TestPrepareInstallDirCreatesLocksThenVerifies(t *testing.T) {
	dir := filepath.Join(t.TempDir(), "f0")
	var c prepCalls
	check, lock := fakePrep(&c, "", nil)
	if err := prepareInstallDir(dir, check, lock); err != nil {
		t.Fatalf("prepareInstallDir = %v", err)
	}
	if fi, err := os.Stat(dir); err != nil || !fi.IsDir() {
		t.Fatal("dir not created")
	}
	if c.locks != 1 || strings.Join(c.checked, ",") != dir {
		t.Fatalf("calls = %+v; want one lock, then one owner check of %s", c, dir)
	}
}

// A folder someone else created is never adopted: its owner may already have
// planted files or kept rights the lock does not remove.
func TestPrepareInstallDirRefusesAForeignOwnedFolderBeforeLocking(t *testing.T) {
	dir := t.TempDir()
	var c prepCalls
	check, lock := fakePrep(&c, dir, nil)
	err := prepareInstallDir(dir, check, lock)
	if err == nil || !strings.Contains(err.Error(), dir) {
		t.Fatalf("prepareInstallDir(foreign) = %v, want an error naming %s", err, dir)
	}
	if c.locks != 0 {
		t.Fatal("a foreign-owned folder must not be locked and adopted")
	}
}

func TestPrepareInstallDirChecksAnExistingFolderAgainAfterLocking(t *testing.T) {
	dir := t.TempDir()
	var c prepCalls
	check, lock := fakePrep(&c, "", nil)
	if err := prepareInstallDir(dir, check, lock); err != nil {
		t.Fatalf("prepareInstallDir = %v", err)
	}
	if c.locks != 1 || strings.Join(c.checked, ",") != dir+","+dir {
		t.Fatalf("calls = %+v; want owner check, lock, owner check", c)
	}
}

func TestPrepareInstallDirFailsWhenTheLockFails(t *testing.T) {
	dir := t.TempDir()
	var c prepCalls
	check, lock := fakePrep(&c, "", errors.New("icacls failed"))
	if err := prepareInstallDir(dir, check, lock); err == nil || !strings.Contains(err.Error(), "icacls failed") {
		t.Fatalf("prepareInstallDir = %v, want the lock error", err)
	}
}

func TestPrepareInstallDirRefusesLinksAndFiles(t *testing.T) {
	root := t.TempDir()
	file := filepath.Join(root, "file")
	writeFile(t, file, "x")
	link := filepath.Join(root, "link")
	if err := os.Symlink(t.TempDir(), link); err != nil {
		t.Skipf("symlinks unavailable: %v", err)
	}
	for _, p := range []string{file, link} {
		var c prepCalls
		check, lock := fakePrep(&c, "", nil)
		if err := prepareInstallDir(p, check, lock); err == nil {
			t.Errorf("prepareInstallDir(%s) = nil, want an error", p)
		}
		if c.locks != 0 {
			t.Errorf("%s was locked", p)
		}
	}
}
