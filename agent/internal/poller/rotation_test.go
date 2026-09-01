package poller

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/f0rt1ka/achilles-agent/internal/config"
)

// writeConfig lays down a minimal on-disk config and loads it, so Persist()
// has a real path to write back to.
func writeConfig(t *testing.T, dir, key string) *config.Config {
	t.Helper()
	path := filepath.Join(dir, "config.yaml")
	contents := "server_url: https://example.com\nagent_id: agent-001\nagent_key: " + key + "\n"
	if err := os.WriteFile(path, []byte(contents), 0600); err != nil {
		t.Fatalf("seed config: %v", err)
	}
	cfg, err := config.Load(path)
	if err != nil {
		t.Fatalf("load config: %v", err)
	}
	return cfg
}

func TestAdoptRotatedKeyPersistsAndAdopts(t *testing.T) {
	dir := t.TempDir()
	cfg := writeConfig(t, dir, "ak_old")

	if err := adoptRotatedKey(cfg, "ak_new"); err != nil {
		t.Fatalf("adoptRotatedKey: %v", err)
	}

	if cfg.AgentKey != "ak_new" {
		t.Errorf("in-memory key = %q, want ak_new", cfg.AgentKey)
	}

	// The key the agent will load after a restart must be the same one it is
	// using now — that agreement is the entire point of this function.
	reloaded, err := config.Load(filepath.Join(dir, "config.yaml"))
	if err != nil {
		t.Fatalf("reload config: %v", err)
	}
	if reloaded.AgentKey != "ak_new" {
		t.Errorf("on-disk key = %q, want ak_new", reloaded.AgentKey)
	}
}

// Regression: the agent used to adopt the new key in memory and only log a
// warning if the write failed. The server, seeing the new key, would promote it
// and drop the old one — then the next restart loaded the stale key from disk
// and the endpoint was locked out permanently.
func TestAdoptRotatedKeyRollsBackWhenPersistFails(t *testing.T) {
	if os.Geteuid() == 0 {
		t.Skip("running as root: directory permissions are not enforced")
	}

	dir := t.TempDir()
	cfg := writeConfig(t, dir, "ak_old")

	// Make the config directory unwritable so the atomic write cannot create
	// its temp file.
	if err := os.Chmod(dir, 0500); err != nil {
		t.Fatalf("chmod dir: %v", err)
	}
	t.Cleanup(func() { _ = os.Chmod(dir, 0700) })

	err := adoptRotatedKey(cfg, "ak_new")
	if err == nil {
		t.Fatal("expected an error when the config cannot be written")
	}

	if cfg.AgentKey != "ak_old" {
		t.Errorf("in-memory key = %q after a failed persist, want ak_old — "+
			"adopting a key that never reached disk bricks the agent on restart", cfg.AgentKey)
	}

	// And the file on disk is untouched.
	_ = os.Chmod(dir, 0700)
	reloaded, err := config.Load(filepath.Join(dir, "config.yaml"))
	if err != nil {
		t.Fatalf("reload config: %v", err)
	}
	if reloaded.AgentKey != "ak_old" {
		t.Errorf("on-disk key = %q, want ak_old", reloaded.AgentKey)
	}
}

func TestAdoptRotatedKeyLeavesNoTempFiles(t *testing.T) {
	dir := t.TempDir()
	cfg := writeConfig(t, dir, "ak_old")

	for _, key := range []string{"ak_1", "ak_2", "ak_3"} {
		if err := adoptRotatedKey(cfg, key); err != nil {
			t.Fatalf("adoptRotatedKey(%s): %v", key, err)
		}
	}

	entries, err := os.ReadDir(dir)
	if err != nil {
		t.Fatalf("read dir: %v", err)
	}
	for _, e := range entries {
		if e.Name() != "config.yaml" {
			t.Errorf("stray file left behind: %s", e.Name())
		}
	}
}
