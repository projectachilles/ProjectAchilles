package config

import (
	"runtime"
	"testing"
)

// Every installer, the ASR per-rule exclusion, the C:\F0 folder lock and the
// EDR guides name these exact paths, so the agent must install itself there.
func TestBinaryPathFor(t *testing.T) {
	cases := map[string]string{
		"windows": `C:\F0\achilles-agent.exe`,
		"linux":   "/opt/f0/achilles-agent",
		"darwin":  "/opt/f0/achilles-agent",
	}
	for goos, want := range cases {
		if got := binaryPathFor(goos); got != want {
			t.Errorf("binaryPathFor(%q) = %q, want %q", goos, got, want)
		}
	}
}

func TestDefaultBinaryPathSharesTheConfigFolder(t *testing.T) {
	if got, want := DefaultBinaryPath(), binaryPathFor(runtime.GOOS); got != want {
		t.Fatalf("DefaultBinaryPath() = %q, want %q", got, want)
	}
	// The binary, its config and the work dir live in one folder: the folder
	// lock (winacl.AgentDir) only applies to that layout.
	dir := func(p string) string {
		for i := len(p) - 1; i >= 0; i-- {
			if p[i] == '/' || p[i] == '\\' {
				return p[:i]
			}
		}
		return ""
	}
	bin := dir(DefaultBinaryPath())
	if c := dir(DefaultConfigPath()); c != bin {
		t.Errorf("config folder %q != binary folder %q", c, bin)
	}
	if w := dir(DefaultConfig().WorkDir); w != bin {
		t.Errorf("work dir parent %q != binary folder %q", w, bin)
	}
}
