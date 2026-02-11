package executor

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"time"

	"github.com/f0rt1ka/achilles-agent/internal/config"
	"github.com/f0rt1ka/achilles-agent/internal/httpclient"
)

const (
	// maxOutputBytes is the maximum bytes captured from stdout/stderr (1 MB).
	maxOutputBytes = 1 << 20

	// exitCodeTimeout is returned when execution exceeds the deadline.
	exitCodeTimeout = 259 // STATUS_STILL_ACTIVE / timeout sentinel

	// exitCodeUnexpected is returned on unexpected execution errors.
	exitCodeUnexpected = 999
)

// patchStatus sends a PATCH to update the task status on the server.
func patchStatus(ctx context.Context, client *httpclient.Client, taskID, status string) error {
	resp, err := client.Do(ctx, http.MethodPatch,
		fmt.Sprintf("/api/agent/tasks/%s/status", taskID),
		map[string]string{"status": status},
	)
	if err != nil {
		return fmt.Errorf("patch status %q: %w", status, err)
	}
	resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return fmt.Errorf("patch status %q: unexpected status %d", status, resp.StatusCode)
	}
	return nil
}

// downloadBinary fetches the test binary and saves it to destPath, returning
// the SHA256 hex digest of the downloaded content.
func downloadBinary(ctx context.Context, client *httpclient.Client, task Task, destPath string, maxSize int64) (string, int64, error) {
	path := fmt.Sprintf("/api/agent/binary/%s?test_uuid=%s",
		task.Payload.BinaryName, task.Payload.TestUUID)

	resp, err := client.Do(ctx, http.MethodGet, path, nil)
	if err != nil {
		return "", 0, fmt.Errorf("download binary: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return "", 0, fmt.Errorf("download binary: unexpected status %d", resp.StatusCode)
	}

	f, err := os.Create(destPath)
	if err != nil {
		return "", 0, fmt.Errorf("create binary file: %w", err)
	}
	defer f.Close()

	hasher := sha256.New()
	// Limit read to maxSize + 1 to detect oversized binaries.
	limitedReader := io.LimitReader(resp.Body, maxSize+1)
	written, err := io.Copy(f, io.TeeReader(limitedReader, hasher))
	if err != nil {
		return "", 0, fmt.Errorf("write binary: %w", err)
	}

	if written > maxSize {
		return "", 0, fmt.Errorf("binary exceeds max allowed size (%d bytes)", maxSize)
	}

	digest := hex.EncodeToString(hasher.Sum(nil))
	return digest, written, nil
}

// Execute downloads the test binary for the given task, verifies its integrity,
// runs it with the specified arguments and timeout, and returns the execution result.
func Execute(ctx context.Context, client *httpclient.Client, task Task, cfg *config.Config) (*Result, error) {
	// Step 1: Notify server we are downloading.
	if err := patchStatus(ctx, client, task.ID, "downloading"); err != nil {
		return nil, err
	}

	// Create an isolated temp directory under WorkDir.
	if err := os.MkdirAll(cfg.WorkDir, 0755); err != nil {
		return nil, fmt.Errorf("create work dir: %w", err)
	}

	tempDir, err := os.MkdirTemp(cfg.WorkDir, "task-"+task.ID+"-")
	if err != nil {
		return nil, fmt.Errorf("create temp dir: %w", err)
	}
	defer os.RemoveAll(tempDir)

	// Step 2: Download the binary.
	binaryPath := filepath.Join(tempDir, task.Payload.BinaryName)
	digest, written, err := downloadBinary(ctx, client, task, binaryPath, cfg.MaxBinarySize)
	if err != nil {
		return nil, err
	}

	// Step 3: Verify SHA256.
	if digest != task.Payload.BinarySHA256 {
		return nil, fmt.Errorf("SHA256 mismatch: expected %s, got %s", task.Payload.BinarySHA256, digest)
	}

	// Step 4: Verify file size.
	if written != task.Payload.BinarySize {
		return nil, fmt.Errorf("size mismatch: expected %d bytes, got %d", task.Payload.BinarySize, written)
	}

	// Step 5: Make executable on Linux/macOS.
	if runtime.GOOS != "windows" {
		if err := os.Chmod(binaryPath, 0755); err != nil {
			return nil, fmt.Errorf("chmod binary: %w", err)
		}
	}

	// Step 6: Notify server we are executing.
	if err := patchStatus(ctx, client, task.ID, "executing"); err != nil {
		return nil, err
	}

	// Step 7: Build the command with timeout.
	timeout := time.Duration(task.Payload.ExecutionTimeout) * time.Second
	if timeout <= 0 {
		timeout = cfg.MaxExecutionTime
	}
	execCtx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()

	cmd := exec.CommandContext(execCtx, binaryPath, task.Payload.Arguments...)
	cmd.Dir = tempDir

	var stdoutBuf, stderrBuf bytes.Buffer
	cmd.Stdout = &limitedWriter{buf: &stdoutBuf, remaining: maxOutputBytes}
	cmd.Stderr = &limitedWriter{buf: &stderrBuf, remaining: maxOutputBytes}

	// Step 8: Run and capture exit code.
	startedAt := time.Now().UTC()
	runErr := cmd.Run()
	completedAt := time.Now().UTC()

	exitCode := 0
	if runErr != nil {
		var exitErr *exec.ExitError
		if errors.As(runErr, &exitErr) {
			exitCode = exitErr.ExitCode()
		} else if errors.Is(execCtx.Err(), context.DeadlineExceeded) {
			exitCode = exitCodeTimeout
		} else {
			exitCode = exitCodeUnexpected
		}
	}

	// Step 9: Build result.
	hostname, _ := os.Hostname()

	result := &Result{
		TaskID:              task.ID,
		TestUUID:            task.Payload.TestUUID,
		ExitCode:            exitCode,
		Stdout:              stdoutBuf.String(),
		Stderr:              stderrBuf.String(),
		StartedAt:           startedAt.Format(time.RFC3339),
		CompletedAt:         completedAt.Format(time.RFC3339),
		ExecutionDurationMs: completedAt.Sub(startedAt).Milliseconds(),
		BinarySHA256:        digest,
		Hostname:            hostname,
		OS:                  runtime.GOOS,
		Arch:                runtime.GOARCH,
	}

	// Steps 10-11: Cleanup handled by defer; return result.
	return result, nil
}

// ExecuteCommand runs an arbitrary shell command for execute_command tasks.
// Unlike Execute, it skips binary download/verify and goes straight to execution.
func ExecuteCommand(ctx context.Context, client *httpclient.Client, task Task, cfg *config.Config) (*Result, error) {
	// Step 1: Notify server we are executing (skip "downloading" phase).
	if err := patchStatus(ctx, client, task.ID, "executing"); err != nil {
		return nil, err
	}

	// Create an isolated temp directory under WorkDir.
	if err := os.MkdirAll(cfg.WorkDir, 0755); err != nil {
		return nil, fmt.Errorf("create work dir: %w", err)
	}

	tempDir, err := os.MkdirTemp(cfg.WorkDir, "cmd-"+task.ID+"-")
	if err != nil {
		return nil, fmt.Errorf("create temp dir: %w", err)
	}
	defer os.RemoveAll(tempDir)

	// Step 2: Build the shell command with timeout.
	timeout := time.Duration(task.Payload.ExecutionTimeout) * time.Second
	if timeout <= 0 {
		timeout = cfg.MaxExecutionTime
	}
	execCtx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()

	var cmd *exec.Cmd
	if runtime.GOOS == "windows" {
		// Write command to a batch file to avoid Go's argument escaping
		// issues with cmd.exe — backslashes before quotes get mangled
		// (e.g., "dir c:\" becomes "dir c:" due to \" escape sequence).
		batPath := filepath.Join(tempDir, "cmd.bat")
		if err := os.WriteFile(batPath, []byte(task.Payload.Command+"\r\n"), 0644); err != nil {
			return nil, fmt.Errorf("write command batch file: %w", err)
		}
		cmd = exec.CommandContext(execCtx, "cmd.exe", "/C", batPath)
	} else {
		cmd = exec.CommandContext(execCtx, "sh", "-c", task.Payload.Command)
	}

	// Use system root as working directory so commands see useful output
	// by default (e.g. "dir" shows C:\, "ls" shows /).
	if runtime.GOOS == "windows" {
		cmd.Dir = `C:\`
	} else {
		cmd.Dir = "/"
	}

	var stdoutBuf, stderrBuf bytes.Buffer
	cmd.Stdout = &limitedWriter{buf: &stdoutBuf, remaining: maxOutputBytes}
	cmd.Stderr = &limitedWriter{buf: &stderrBuf, remaining: maxOutputBytes}

	// Step 3: Run and capture exit code.
	startedAt := time.Now().UTC()
	runErr := cmd.Run()
	completedAt := time.Now().UTC()

	exitCode := 0
	if runErr != nil {
		var exitErr *exec.ExitError
		if errors.As(runErr, &exitErr) {
			exitCode = exitErr.ExitCode()
		} else if errors.Is(execCtx.Err(), context.DeadlineExceeded) {
			exitCode = exitCodeTimeout
		} else {
			exitCode = exitCodeUnexpected
		}
	}

	// Step 4: Build result.
	hostname, _ := os.Hostname()

	result := &Result{
		TaskID:              task.ID,
		TestUUID:            "",
		ExitCode:            exitCode,
		Stdout:              stdoutBuf.String(),
		Stderr:              stderrBuf.String(),
		StartedAt:           startedAt.Format(time.RFC3339),
		CompletedAt:         completedAt.Format(time.RFC3339),
		ExecutionDurationMs: completedAt.Sub(startedAt).Milliseconds(),
		BinarySHA256:        "",
		Hostname:            hostname,
		OS:                  runtime.GOOS,
		Arch:                runtime.GOARCH,
	}

	return result, nil
}

// limitedWriter writes up to a maximum number of bytes to an underlying buffer,
// silently discarding any excess.
type limitedWriter struct {
	buf       *bytes.Buffer
	remaining int64
}

func (lw *limitedWriter) Write(p []byte) (int, error) {
	if lw.remaining <= 0 {
		return len(p), nil // discard silently
	}
	n := int64(len(p))
	if n > lw.remaining {
		n = lw.remaining
	}
	written, err := lw.buf.Write(p[:n])
	lw.remaining -= int64(written)
	// Return original len(p) so the caller (exec) doesn't see a short write error.
	return len(p), err
}
