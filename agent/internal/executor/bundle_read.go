package executor

import (
	"fmt"
	"io"
	"os"
)

// bundleResultsName is the per-control results file a bundle test writes.
const bundleResultsName = "bundle_results.json"

// maxBundleResultsBytes caps bundle_results.json. Real files are a few hundred
// kilobytes at most; the cap stops a planted or runaway file from being read
// whole into the memory of the root agent.
const maxBundleResultsBytes = 16 << 20 // 16 MiB

// openBundleDir opens the folder a bundle_results.json may be read from.
//
// The task folder is created by the agent with mode 0700, so it is opened as
// it is. The shared legacy folder (C:\F0, /tmp/F0) is different: /tmp/F0 sits
// in world-writable /tmp, where a local user can create the folder, or a file
// or symlink in it, before a test runs. It is read only when openTrustedDir
// accepts it (a real directory, owned by root or the agent, not writable by
// group or others), the same rule the cleanup uses.
func openBundleDir(dir string, shared bool) *os.Root {
	if shared {
		return openTrustedDir(dir)
	}
	root, err := os.OpenRoot(dir)
	if err != nil {
		return nil
	}
	return root
}

// readBundleResults returns bundle_results.json from dir. found is false when
// there is no usable file there, so the caller tries the next folder. A file
// that exists but is refused (a symlink, not a regular file, too large) is
// reported as an error, never read.
//
// Everything goes through the opened folder (os.Root), so a path swapped
// after the checks can't redirect the read.
func readBundleResults(dir string, shared bool) (data []byte, found bool, err error) {
	root := openBundleDir(dir, shared)
	if root == nil {
		return nil, false, nil
	}
	defer root.Close()

	info, statErr := root.Lstat(bundleResultsName)
	if statErr != nil {
		return nil, false, nil
	}
	if !info.Mode().IsRegular() {
		return nil, true, fmt.Errorf("%s is not a regular file", bundleResultsName)
	}
	if info.Size() > maxBundleResultsBytes {
		return nil, true, fmt.Errorf("%s is %d bytes, over the %d byte limit", bundleResultsName, info.Size(), maxBundleResultsBytes)
	}

	f, openErr := root.Open(bundleResultsName)
	if openErr != nil {
		return nil, true, openErr
	}
	defer f.Close()

	// The size was checked above, but the file can still grow: read one byte
	// past the limit and refuse if it is there.
	data, readErr := io.ReadAll(io.LimitReader(f, maxBundleResultsBytes+1))
	if readErr != nil {
		return nil, true, readErr
	}
	if len(data) > maxBundleResultsBytes {
		return nil, true, fmt.Errorf("%s is over the %d byte limit", bundleResultsName, maxBundleResultsBytes)
	}
	return data, true, nil
}

// removeBundleResults deletes a processed bundle_results.json from dir.
func removeBundleResults(dir string, shared bool) {
	root := openBundleDir(dir, shared)
	if root == nil {
		return
	}
	defer root.Close()
	_ = root.Remove(bundleResultsName)
}
