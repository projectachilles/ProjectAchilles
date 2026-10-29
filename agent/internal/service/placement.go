package service

import (
	"bytes"
	"crypto/sha256"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"time"
)

// Kept free of build tags so the copy logic can be tested on any platform.

// replacedSuffix names the previous agent binary while a re-install puts a new
// one at the canonical path. Distinct from the updater's ".old" rollback file.
const replacedSuffix = ".replaced"

// rename is os.Rename, replaceable in tests to simulate a failed swap.
var rename = os.Rename

// sameFile reports whether a and b name the same existing file, however they
// are spelled (case, symlinked folders, short names on Windows).
func sameFile(a, b string) bool {
	if filepath.Clean(a) == filepath.Clean(b) {
		return true
	}
	fa, err := os.Stat(a)
	if err != nil {
		return false
	}
	fb, err := os.Stat(b)
	if err != nil {
		return false
	}
	return os.SameFile(fa, fb)
}

// placeBinary makes dst a verified copy of src, creating dst's folder. When
// src already is dst it changes nothing and returns false.
//
// The copy is written to a temporary file next to dst, checked against src's
// SHA-256, then renamed into place. An existing dst is first renamed to
// dst+replacedSuffix (Windows can rename a running executable but not
// overwrite it) and put back if the new file cannot take its place, so a
// failure leaves the previous agent where it was. The caller removes the
// set-aside file with removeReplaced once the old service has stopped.
func placeBinary(src, dst string) (copied bool, err error) {
	if sameFile(src, dst) {
		return false, nil
	}

	dir := filepath.Dir(dst)
	if err := os.MkdirAll(dir, 0755); err != nil {
		return false, fmt.Errorf("create %s: %w", dir, err)
	}
	if fi, err := os.Lstat(dst); err == nil && !fi.Mode().IsRegular() {
		return false, fmt.Errorf("%s exists and is not a regular file; remove it and re-run", dst)
	}

	tmp, err := copyVerified(src, dir)
	if err != nil {
		return false, err
	}
	defer os.Remove(tmp) // no-op once renamed into place

	aside := dst + replacedSuffix
	hadOld := false
	if _, err := os.Lstat(dst); err == nil {
		if err := os.Remove(aside); err != nil && !os.IsNotExist(err) {
			return false, fmt.Errorf("remove leftover %s: %w", aside, err)
		}
		if err := rename(dst, aside); err != nil {
			return false, fmt.Errorf("move the existing %s aside: %w", dst, err)
		}
		hadOld = true
	}
	if err := rename(tmp, dst); err != nil {
		if hadOld {
			if rbErr := rename(aside, dst); rbErr != nil {
				return false, fmt.Errorf("put the agent at %s: %w; restoring the previous agent also failed (it is at %s): %v", dst, err, aside, rbErr)
			}
		}
		return false, fmt.Errorf("put the agent at %s: %w", dst, err)
	}
	return true, nil
}

// copyVerified copies src to a new temporary file in dir and returns its path
// once its content matches src's SHA-256.
func copyVerified(src, dir string) (string, error) {
	in, err := os.Open(src)
	if err != nil {
		return "", fmt.Errorf("open %s: %w", src, err)
	}
	defer in.Close()

	out, err := os.CreateTemp(dir, ".achilles-agent-install-*")
	if err != nil {
		return "", fmt.Errorf("create a temporary file in %s: %w", dir, err)
	}
	tmp := out.Name()
	fail := func(err error) (string, error) {
		out.Close()
		os.Remove(tmp)
		return "", err
	}

	srcHash := sha256.New()
	if _, err := io.Copy(out, io.TeeReader(in, srcHash)); err != nil {
		return fail(fmt.Errorf("copy %s to %s: %w", src, tmp, err))
	}
	if err := out.Sync(); err != nil {
		return fail(fmt.Errorf("flush %s: %w", tmp, err))
	}
	if err := out.Close(); err != nil {
		return fail(fmt.Errorf("close %s: %w", tmp, err))
	}
	if err := os.Chmod(tmp, 0700); err != nil {
		return fail(fmt.Errorf("chmod %s: %w", tmp, err))
	}

	written, err := fileSHA256(tmp)
	if err != nil {
		return fail(err)
	}
	if !bytes.Equal(written, srcHash.Sum(nil)) {
		return fail(fmt.Errorf("the copy at %s does not match %s", tmp, src))
	}
	return tmp, nil
}

func fileSHA256(path string) ([]byte, error) {
	f, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	defer f.Close()
	h := sha256.New()
	if _, err := io.Copy(h, f); err != nil {
		return nil, fmt.Errorf("read %s: %w", path, err)
	}
	return h.Sum(nil), nil
}

// removeReplaced deletes the previous agent binary set aside by placeBinary.
// On Windows the old service process can hold it for a few seconds after it
// was told to stop, so the removal is retried before giving up with a hint.
func removeReplaced(dst string) {
	aside := dst + replacedSuffix
	var err error
	for i := 0; i < 20; i++ {
		if err = os.Remove(aside); err == nil || os.IsNotExist(err) {
			return
		}
		time.Sleep(500 * time.Millisecond)
	}
	fmt.Fprintf(os.Stderr, "warning: could not remove the previous agent binary %s (%v); delete it once it is no longer in use\n", aside, err)
}

// outOfPlaceWarning returns a warning when exe is not the canonical agent
// binary, or "" when it is.
func outOfPlaceWarning(exe, canonical string) string {
	if sameFile(exe, canonical) {
		return ""
	}
	return fmt.Sprintf("WARNING: the agent is running from %s, not %s. "+
		"The Defender ASR per-rule exclusion, the agent folder lock and the EDR exact-path rules only cover %s. "+
		"To move it there and keep this enrollment, run this as Administrator (Windows) or root: %s --install",
		exe, canonical, filepath.Dir(canonical), exe)
}

// OutOfPlaceWarning returns a warning when exe (the running agent binary) is
// not at the canonical install path, or "" when it is.
func OutOfPlaceWarning(exe string) string {
	return outOfPlaceWarning(exe, CanonicalBinaryPath())
}
