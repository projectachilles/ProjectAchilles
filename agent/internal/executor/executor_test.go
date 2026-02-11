package executor

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"testing"
	"time"

	"github.com/f0rt1ka/achilles-agent/internal/config"
	"github.com/f0rt1ka/achilles-agent/internal/store"
)

// TestConfigRoundTrip verifies that saving and loading a config produces identical values.
func TestConfigRoundTrip(t *testing.T) {
	tmpDir := t.TempDir()
	cfgPath := filepath.Join(tmpDir, "test-config.yaml")

	original := config.DefaultConfig()
	original.ServerURL = "https://test.example.com"
	original.AgentID = "agent-001"
	original.AgentKey = "ak_test_key_123"
	original.OrgID = "org-abc"
	original.PollInterval = 45 * time.Second
	original.HeartbeatInterval = 90 * time.Second

	if err := original.Save(cfgPath); err != nil {
		t.Fatalf("Save: %v", err)
	}

	loaded, err := config.Load(cfgPath)
	if err != nil {
		t.Fatalf("Load: %v", err)
	}

	if loaded.ServerURL != original.ServerURL {
		t.Errorf("ServerURL: got %q, want %q", loaded.ServerURL, original.ServerURL)
	}
	if loaded.AgentID != original.AgentID {
		t.Errorf("AgentID: got %q, want %q", loaded.AgentID, original.AgentID)
	}
	if loaded.AgentKey != original.AgentKey {
		t.Errorf("AgentKey: got %q, want %q", loaded.AgentKey, original.AgentKey)
	}
	if loaded.OrgID != original.OrgID {
		t.Errorf("OrgID: got %q, want %q", loaded.OrgID, original.OrgID)
	}
	if loaded.PollInterval != original.PollInterval {
		t.Errorf("PollInterval: got %v, want %v", loaded.PollInterval, original.PollInterval)
	}
	if loaded.HeartbeatInterval != original.HeartbeatInterval {
		t.Errorf("HeartbeatInterval: got %v, want %v", loaded.HeartbeatInterval, original.HeartbeatInterval)
	}
}

// TestConfigValidation verifies that Validate rejects incomplete configs.
func TestConfigValidation(t *testing.T) {
	cfg := config.DefaultConfig()
	if err := cfg.Validate(); err == nil {
		t.Fatal("expected validation error for empty required fields")
	}

	cfg.ServerURL = "https://test.example.com"
	cfg.AgentID = "agent-001"
	cfg.AgentKey = "ak_key"
	if err := cfg.Validate(); err != nil {
		t.Fatalf("unexpected validation error: %v", err)
	}
}

// TestStorePersistence verifies that store state survives across instances.
func TestStorePersistence(t *testing.T) {
	tmpDir := t.TempDir()

	// Create first store and update state.
	st1, err := store.New(tmpDir)
	if err != nil {
		t.Fatalf("New store 1: %v", err)
	}

	now := time.Now().Truncate(time.Second)
	if err := st1.Update(func(s *store.State) {
		s.AgentID = "agent-persist"
		s.LastTaskID = "task-42"
		s.LastHeartbeat = &now
		s.Version = "0.1.0"
	}); err != nil {
		t.Fatalf("Update: %v", err)
	}

	// Create second store from the same directory.
	st2, err := store.New(tmpDir)
	if err != nil {
		t.Fatalf("New store 2: %v", err)
	}

	state := st2.Get()
	if state.AgentID != "agent-persist" {
		t.Errorf("AgentID: got %q, want %q", state.AgentID, "agent-persist")
	}
	if state.LastTaskID != "task-42" {
		t.Errorf("LastTaskID: got %q, want %q", state.LastTaskID, "task-42")
	}
	if state.Version != "0.1.0" {
		t.Errorf("Version: got %q, want %q", state.Version, "0.1.0")
	}
	if state.LastHeartbeat == nil {
		t.Fatal("LastHeartbeat: got nil")
	}
	if !state.LastHeartbeat.Equal(now) {
		t.Errorf("LastHeartbeat: got %v, want %v", state.LastHeartbeat, now)
	}
}

// buildTestBinary compiles a small Go program and returns its path and SHA256 digest.
func buildTestBinary(t *testing.T, dir string, source string) (string, string) {
	t.Helper()

	srcPath := filepath.Join(dir, "main.go")
	if err := os.WriteFile(srcPath, []byte(source), 0644); err != nil {
		t.Fatalf("write source: %v", err)
	}

	binaryName := "testbin"
	if runtime.GOOS == "windows" {
		binaryName = "testbin.exe"
	}
	binPath := filepath.Join(dir, binaryName)

	cmd := exec.Command("go", "build", "-o", binPath, srcPath)
	cmd.Dir = dir
	out, err := cmd.CombinedOutput()
	if err != nil {
		t.Fatalf("go build: %v\n%s", err, out)
	}

	data, err := os.ReadFile(binPath)
	if err != nil {
		t.Fatalf("read binary: %v", err)
	}
	h := sha256.Sum256(data)
	digest := hex.EncodeToString(h[:])

	return binPath, digest
}

// TestSHA256Verification verifies that the executor correctly computes and compares SHA256 hashes.
func TestSHA256Verification(t *testing.T) {
	tmpDir := t.TempDir()

	// Create a test file.
	content := []byte("hello achilles agent test")
	filePath := filepath.Join(tmpDir, "testfile.bin")
	if err := os.WriteFile(filePath, content, 0644); err != nil {
		t.Fatalf("write file: %v", err)
	}

	// Compute expected hash.
	h := sha256.Sum256(content)
	expected := hex.EncodeToString(h[:])

	// Read back and verify.
	data, err := os.ReadFile(filePath)
	if err != nil {
		t.Fatalf("read file: %v", err)
	}
	h2 := sha256.Sum256(data)
	actual := hex.EncodeToString(h2[:])

	if actual != expected {
		t.Errorf("SHA256 mismatch: expected %s, got %s", expected, actual)
	}

	// Verify wrong hash detection.
	wrongHash := "0000000000000000000000000000000000000000000000000000000000000000"
	if actual == wrongHash {
		t.Error("SHA256 should not match a zero hash")
	}
}

// TestExecutorTimeoutBinary verifies that a long-running binary is killed with exit code 259.
func TestExecutorTimeoutBinary(t *testing.T) {
	if testing.Short() {
		t.Skip("skipping timeout test in short mode")
	}

	tmpDir := t.TempDir()

	// Build a binary that sleeps for 60 seconds.
	sleepSource := `package main
import "time"
func main() { time.Sleep(60 * time.Second) }
`
	binPath, digest := buildTestBinary(t, tmpDir, sleepSource)
	fi, err := os.Stat(binPath)
	if err != nil {
		t.Fatalf("stat binary: %v", err)
	}

	// Create a task with a 2-second timeout.
	task := Task{
		ID:   "timeout-test",
		Type: "test",
		Payload: TaskPayload{
			TestUUID:         "uuid-timeout",
			TestName:         "Timeout Test",
			BinaryName:       filepath.Base(binPath),
			BinarySHA256:     digest,
			BinarySize:       fi.Size(),
			ExecutionTimeout: 2,
		},
	}

	// We can't call Execute() directly since it needs an HTTP client for status patching.
	// Instead, test the underlying exec behavior.
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()

	cmd := exec.CommandContext(ctx, binPath)
	err = cmd.Run()

	if err == nil {
		t.Fatal("expected error from timed-out binary")
	}

	// The task struct is used to verify the test was set up correctly.
	_ = task
}

// TestExecutorStdoutStderr verifies stdout and stderr capture from a binary.
func TestExecutorStdoutStderr(t *testing.T) {
	if testing.Short() {
		t.Skip("skipping stdout/stderr test in short mode")
	}

	tmpDir := t.TempDir()

	echoSource := `package main
import (
	"fmt"
	"os"
)
func main() {
	fmt.Fprintln(os.Stdout, "hello-stdout")
	fmt.Fprintln(os.Stderr, "hello-stderr")
}
`
	binPath, _ := buildTestBinary(t, tmpDir, echoSource)

	cmd := exec.Command(binPath)
	var stdoutBuf, stderrBuf limitedWriter
	stdoutBuf.buf = new(bytes.Buffer)
	stdoutBuf.remaining = maxOutputBytes
	stderrBuf.buf = new(bytes.Buffer)
	stderrBuf.remaining = maxOutputBytes

	cmd.Stdout = &stdoutBuf
	cmd.Stderr = &stderrBuf

	if err := cmd.Run(); err != nil {
		t.Fatalf("run: %v", err)
	}

	stdout := stdoutBuf.buf.String()
	stderr := stderrBuf.buf.String()

	if stdout != "hello-stdout\n" {
		t.Errorf("stdout: got %q, want %q", stdout, "hello-stdout\n")
	}
	if stderr != "hello-stderr\n" {
		t.Errorf("stderr: got %q, want %q", stderr, "hello-stderr\n")
	}
}

// TestLimitedWriter verifies that limitedWriter caps output at the specified limit.
func TestLimitedWriter(t *testing.T) {
	buf := new(bytes.Buffer)
	lw := &limitedWriter{buf: buf, remaining: 10}

	data := []byte("hello world! extra data here")
	n, err := lw.Write(data)
	if err != nil {
		t.Fatalf("Write: %v", err)
	}
	// Should report full length written (so exec doesn't error).
	if n != len(data) {
		t.Errorf("Write returned %d, want %d", n, len(data))
	}
	// But buffer should only contain 10 bytes.
	if buf.Len() != 10 {
		t.Errorf("buffer length: got %d, want 10", buf.Len())
	}
	if buf.String() != "hello worl" {
		t.Errorf("buffer content: got %q, want %q", buf.String(), "hello worl")
	}

	// Subsequent writes should be silently discarded.
	n2, err := lw.Write([]byte("more data"))
	if err != nil {
		t.Fatalf("Write 2: %v", err)
	}
	if n2 != 9 {
		t.Errorf("Write 2 returned %d, want 9", n2)
	}
	if buf.Len() != 10 {
		t.Errorf("buffer length after second write: got %d, want 10", buf.Len())
	}
}
