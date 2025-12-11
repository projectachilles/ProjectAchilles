// test_logger.go - Comprehensive structured logging for F0RT1KA tests
// Provides detailed audit trail, forensic analysis, and reporting capabilities
// Build: Embedded in main test binary

//go:build windows
// +build windows

package main

import (
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"golang.org/x/sys/windows/registry"
)

// NOTE: Type declarations (MDEIdentifiers, MemoryPatchResult, APIInterceptionResult) are now in their
// respective module files since we compile all modules together into a single binary.

// Type alias for compatibility with api_interceptor.go
type NetworkTestSummary = APIInterceptionResult

// TestLog is the main structure containing all test execution data
type TestLog struct {
	TestID                string                  `json:"testId"`
	TestName              string                  `json:"testName"`
	StartTime             time.Time               `json:"startTime"`
	EndTime               time.Time               `json:"endTime"`
	Duration              int64                   `json:"durationMs"`
	ExitCode              int                     `json:"exitCode"`
	ExitReason            string                  `json:"exitReason"`
	Phases                []PhaseLog              `json:"phases"`
	MemoryPatch           *MemoryPatchLog         `json:"memoryPatch,omitempty"`
	NetworkTest           *APIInterceptionResult  `json:"networkTest,omitempty"`
	IdentifierExtraction  *IdentifierLog          `json:"identifierExtraction,omitempty"`
	SystemInfo            SystemInfo              `json:"systemInfo"`
	Messages              []LogEntry              `json:"messages"`
	FilesDropped          []FileDropLog           `json:"filesDropped"`
	ProcessesExecuted     []ProcessLog            `json:"processesExecuted"`
}

// PhaseLog tracks individual test phases
type PhaseLog struct {
	PhaseNumber int       `json:"phaseNumber"`
	PhaseName   string    `json:"phaseName"`
	StartTime   time.Time `json:"startTime"`
	EndTime     time.Time `json:"endTime"`
	DurationMs  int64     `json:"durationMs"`
	Status      string    `json:"status"` // "success", "failed", "blocked", "skipped"
	Details     string    `json:"details"`
	Errors      []string  `json:"errors,omitempty"`
}

// MemoryPatchLog tracks memory patching attempts
type MemoryPatchLog struct {
	FunctionName   string    `json:"functionName"`
	Mode           string    `json:"mode"`
	Attempted      bool      `json:"attempted"`
	Success        bool      `json:"success"`
	Blocked        bool      `json:"blocked"`
	BlockedBy      string    `json:"blockedBy,omitempty"`
	PatchApplied   bool      `json:"patchApplied"`
	PatchVerified  bool      `json:"patchVerified"`
	Restored       bool      `json:"restored"`
	PatchAddress   string    `json:"patchAddress,omitempty"`
	Timestamp      time.Time `json:"timestamp"`
}

// IdentifierLog tracks MDE identifier extraction
type IdentifierLog struct {
	Method       string    `json:"method"` // "registry", "config", "wmi", "simulated"
	MDEInstalled bool      `json:"mdeInstalled"`
	Success      bool      `json:"success"`
	MachineID    string    `json:"machineId"`
	TenantID     string    `json:"tenantId"`
	SenseID      string    `json:"senseId,omitempty"`
	Timestamp    time.Time `json:"timestamp"`
}

// LogEntry represents a single log entry
type LogEntry struct {
	Timestamp time.Time `json:"timestamp"`
	Level     string    `json:"level"` // "INFO", "WARN", "ERROR", "CRITICAL"
	Phase     string    `json:"phase"`
	Message   string    `json:"message"`
}

// SystemInfo captures system context
type SystemInfo struct {
	Hostname          string `json:"hostname"`
	OSVersion         string `json:"osVersion"`
	Architecture      string `json:"architecture"`
	DefenderRunning   bool   `json:"defenderRunning"`
	MDEInstalled      bool   `json:"mdeInstalled"`
	MDEVersion        string `json:"mdeVersion,omitempty"`
	ProcessID         int    `json:"processId"`
	Username          string `json:"username"`
	IsAdmin           bool   `json:"isAdmin"`
}

// FileDropLog tracks files dropped during test
type FileDropLog struct {
	Filename     string    `json:"filename"`
	Path         string    `json:"path"`
	Size         int64     `json:"size"`
	Quarantined  bool      `json:"quarantined"`
	Timestamp    time.Time `json:"timestamp"`
}

// ProcessLog tracks processes executed during test
type ProcessLog struct {
	ProcessName string    `json:"processName"`
	CommandLine string    `json:"commandLine"`
	PID         int       `json:"pid,omitempty"`
	Success     bool      `json:"success"`
	ExitCode    int       `json:"exitCode,omitempty"`
	Timestamp   time.Time `json:"timestamp"`
	ErrorMsg    string    `json:"errorMsg,omitempty"`
}

var (
	globalLog *TestLog
	logMutex  sync.Mutex
)

// InitLogger initializes the global test logger
func InitLogger(testID, testName string) *TestLog {
	logMutex.Lock()
	defer logMutex.Unlock()

	globalLog = &TestLog{
		TestID:            testID,
		TestName:          testName,
		StartTime:         time.Now(),
		Phases:            []PhaseLog{},
		Messages:          []LogEntry{},
		FilesDropped:      []FileDropLog{},
		ProcessesExecuted: []ProcessLog{},
	}

	// Capture system info
	globalLog.SystemInfo = captureSystemInfo()

	// Use addMessage() directly since we already hold the lock
	addMessage("INFO", "Initialization", fmt.Sprintf("Test logger initialized for %s", testName))
	addMessage("INFO", "Initialization", fmt.Sprintf("Running as: %s (Admin: %v)",
		globalLog.SystemInfo.Username, globalLog.SystemInfo.IsAdmin))

	return globalLog
}

// LogPhaseStart starts tracking a new phase
func LogPhaseStart(phaseNumber int, phaseName string) {
	logMutex.Lock()
	defer logMutex.Unlock()

	phase := PhaseLog{
		PhaseNumber: phaseNumber,
		PhaseName:   phaseName,
		StartTime:   time.Now(),
		Status:      "in_progress",
		Errors:      []string{},
	}

	globalLog.Phases = append(globalLog.Phases, phase)
	addMessage("INFO", phaseName, fmt.Sprintf("Phase %d started: %s", phaseNumber, phaseName))
}

// LogPhaseEnd completes a phase with status and details
func LogPhaseEnd(phaseNumber int, status string, details string) {
	logMutex.Lock()
	defer logMutex.Unlock()

	if phaseNumber > 0 && phaseNumber <= len(globalLog.Phases) {
		idx := phaseNumber - 1
		globalLog.Phases[idx].EndTime = time.Now()
		globalLog.Phases[idx].Status = status
		globalLog.Phases[idx].Details = details
		globalLog.Phases[idx].DurationMs = globalLog.Phases[idx].EndTime.Sub(globalLog.Phases[idx].StartTime).Milliseconds()

		addMessage("INFO", globalLog.Phases[idx].PhaseName,
			fmt.Sprintf("Phase %d completed: %s (%d ms)", phaseNumber, status, globalLog.Phases[idx].DurationMs))
	}
}

// LogPhaseError adds an error to the current phase
func LogPhaseError(phaseNumber int, errorMsg string) {
	logMutex.Lock()
	defer logMutex.Unlock()

	if phaseNumber > 0 && phaseNumber <= len(globalLog.Phases) {
		idx := phaseNumber - 1
		globalLog.Phases[idx].Errors = append(globalLog.Phases[idx].Errors, errorMsg)
		addMessage("ERROR", globalLog.Phases[idx].PhaseName, errorMsg)
	}
}

// LogMessage adds a message to the log (thread-safe)
func LogMessage(level, phase, message string) {
	logMutex.Lock()
	defer logMutex.Unlock()

	addMessage(level, phase, message)
}

// addMessage internal function (assumes lock is held)
func addMessage(level, phase, message string) {
	msg := LogEntry{
		Timestamp: time.Now(),
		Level:     level,
		Phase:     phase,
		Message:   message,
	}

	globalLog.Messages = append(globalLog.Messages, msg)
}

// LogMemoryPatch logs memory patching attempt details
func LogMemoryPatch(result *MemoryPatchResult) {
	logMutex.Lock()
	defer logMutex.Unlock()

	globalLog.MemoryPatch = &MemoryPatchLog{
		FunctionName:  result.FunctionName,
		Mode:          result.PatchMode,
		Attempted:     true,
		Success:       result.Success,
		Blocked:       result.Blocked,
		BlockedBy:     result.BlockedBy,
		PatchApplied:  result.PatchApplied,
		PatchVerified: result.PatchVerified,
		Restored:      result.Restored,
		PatchAddress:  fmt.Sprintf("0x%X", result.FunctionAddress),
		Timestamp:     time.Now(),
	}

	addMessage("INFO", "Memory Patch", fmt.Sprintf("Function: %s, Mode: %s, Success: %v, Blocked: %v",
		result.FunctionName, result.PatchMode, result.Success, result.Blocked))
}

// LogAPIInterception logs API interception results
func LogAPIInterception(summary *APIInterceptionResult) {
	logMutex.Lock()
	defer logMutex.Unlock()

	globalLog.NetworkTest = summary

	addMessage("INFO", "API Interception", fmt.Sprintf("Total requests: %d, Commands intercepted: %d, Vulnerability: %v",
		summary.TotalRequests, summary.CommandsIntercepted, summary.VulnerabilityFound))
}

// LogIdentifierExtraction logs identifier extraction results
func LogIdentifierExtraction(ids *MDEIdentifiers) {
	logMutex.Lock()
	defer logMutex.Unlock()

	globalLog.IdentifierExtraction = &IdentifierLog{
		Method:       ids.Source,
		MDEInstalled: ids.MDEInstalled,
		Success:      ids.ExtractionSuccess,
		MachineID:    ids.MachineID,
		TenantID:     ids.TenantID,
		SenseID:      ids.SenseID,
		Timestamp:    time.Now(),
	}

	addMessage("INFO", "Identifier Extraction", fmt.Sprintf("Method: %s, Success: %v, MDE: %v",
		ids.Source, ids.ExtractionSuccess, ids.MDEInstalled))
}

// LogFileDropped logs a file drop operation
func LogFileDropped(filename, path string, size int64, quarantined bool) {
	logMutex.Lock()
	defer logMutex.Unlock()

	fileDrop := FileDropLog{
		Filename:    filename,
		Path:        path,
		Size:        size,
		Quarantined: quarantined,
		Timestamp:   time.Now(),
	}

	globalLog.FilesDropped = append(globalLog.FilesDropped, fileDrop)

	status := "dropped"
	if quarantined {
		status = "quarantined"
	}
	addMessage("INFO", "File Operations", fmt.Sprintf("File %s: %s (%d bytes)", status, filename, size))
}

// LogProcessExecution logs a process execution
func LogProcessExecution(processName, commandLine string, pid int, success bool, exitCode int, errorMsg string) {
	logMutex.Lock()
	defer logMutex.Unlock()

	procLog := ProcessLog{
		ProcessName: processName,
		CommandLine: commandLine,
		PID:         pid,
		Success:     success,
		ExitCode:    exitCode,
		Timestamp:   time.Now(),
		ErrorMsg:    errorMsg,
	}

	globalLog.ProcessesExecuted = append(globalLog.ProcessesExecuted, procLog)

	if success {
		addMessage("INFO", "Process Execution", fmt.Sprintf("Executed: %s (PID: %d)", processName, pid))
	} else {
		addMessage("ERROR", "Process Execution", fmt.Sprintf("Failed: %s - %s", processName, errorMsg))
	}
}

// SaveLog saves the complete log to disk
func SaveLog(exitCode int, exitReason string) error {
	logMutex.Lock()
	defer logMutex.Unlock()

	globalLog.EndTime = time.Now()
	globalLog.Duration = globalLog.EndTime.Sub(globalLog.StartTime).Milliseconds()
	globalLog.ExitCode = exitCode
	globalLog.ExitReason = exitReason

	targetDir := "C:\\F0"
	os.MkdirAll(targetDir, 0755)

	// Save JSON log
	jsonPath := filepath.Join(targetDir, "test_execution_log.json")
	jsonData, err := json.MarshalIndent(globalLog, "", "  ")
	if err != nil {
		return fmt.Errorf("failed to marshal JSON: %v", err)
	}

	if err := os.WriteFile(jsonPath, jsonData, 0644); err != nil {
		return fmt.Errorf("failed to write JSON log: %v", err)
	}

	// Save human-readable text log
	txtPath := filepath.Join(targetDir, "test_execution_log.txt")
	txtData := formatTextLog(globalLog)
	if err := os.WriteFile(txtPath, []byte(txtData), 0644); err != nil {
		return fmt.Errorf("failed to write text log: %v", err)
	}

	fmt.Printf("\n[*] ========================================\n")
	fmt.Printf("[*] Execution logs saved:\n")
	fmt.Printf("[*]   JSON: %s\n", jsonPath)
	fmt.Printf("[*]   TEXT: %s\n", txtPath)
	fmt.Printf("[*] ========================================\n\n")

	return nil
}

// formatTextLog creates human-readable text log
func formatTextLog(log *TestLog) string {
	var out strings.Builder

	out.WriteString(strings.Repeat("=", 80) + "\n")
	out.WriteString("F0RT1KA SECURITY TEST - EXECUTION LOG\n")
	out.WriteString(strings.Repeat("=", 80) + "\n\n")

	// Test information
	out.WriteString(fmt.Sprintf("Test ID:      %s\n", log.TestID))
	out.WriteString(fmt.Sprintf("Test Name:    %s\n", log.TestName))
	out.WriteString(fmt.Sprintf("Start Time:   %s\n", log.StartTime.Format("2006-01-02 15:04:05.000")))
	out.WriteString(fmt.Sprintf("End Time:     %s\n", log.EndTime.Format("2006-01-02 15:04:05.000")))
	out.WriteString(fmt.Sprintf("Duration:     %d ms (%.2f seconds)\n", log.Duration, float64(log.Duration)/1000))
	out.WriteString(fmt.Sprintf("Exit Code:    %d\n", log.ExitCode))
	out.WriteString(fmt.Sprintf("Exit Reason:  %s\n\n", log.ExitReason))

	// System information
	out.WriteString("SYSTEM INFORMATION\n")
	out.WriteString(strings.Repeat("-", 80) + "\n")
	out.WriteString(fmt.Sprintf("Hostname:          %s\n", log.SystemInfo.Hostname))
	out.WriteString(fmt.Sprintf("OS Version:        %s\n", log.SystemInfo.OSVersion))
	out.WriteString(fmt.Sprintf("Architecture:      %s\n", log.SystemInfo.Architecture))
	out.WriteString(fmt.Sprintf("Username:          %s\n", log.SystemInfo.Username))
	out.WriteString(fmt.Sprintf("Administrator:     %v\n", log.SystemInfo.IsAdmin))
	out.WriteString(fmt.Sprintf("Process ID:        %d\n", log.SystemInfo.ProcessID))
	out.WriteString(fmt.Sprintf("Defender Running:  %v\n", log.SystemInfo.DefenderRunning))
	out.WriteString(fmt.Sprintf("MDE Installed:     %v\n", log.SystemInfo.MDEInstalled))
	if log.SystemInfo.MDEVersion != "" {
		out.WriteString(fmt.Sprintf("MDE Version:       %s\n", log.SystemInfo.MDEVersion))
	}
	out.WriteString("\n")

	// Phase execution
	out.WriteString("PHASE EXECUTION\n")
	out.WriteString(strings.Repeat("-", 80) + "\n")
	for _, phase := range log.Phases {
		out.WriteString(fmt.Sprintf("\nPhase %d: %s\n", phase.PhaseNumber, phase.PhaseName))
		out.WriteString(fmt.Sprintf("  Status:   %s\n", phase.Status))
		out.WriteString(fmt.Sprintf("  Duration: %d ms\n", phase.DurationMs))
		if phase.Details != "" {
			out.WriteString(fmt.Sprintf("  Details:  %s\n", phase.Details))
		}
		if len(phase.Errors) > 0 {
			out.WriteString("  Errors:\n")
			for _, err := range phase.Errors {
				out.WriteString(fmt.Sprintf("    - %s\n", err))
			}
		}
	}

	// Identifier extraction
	if log.IdentifierExtraction != nil {
		out.WriteString("\n\nIDENTIFIER EXTRACTION\n")
		out.WriteString(strings.Repeat("-", 80) + "\n")
		out.WriteString(fmt.Sprintf("Method:           %s\n", log.IdentifierExtraction.Method))
		out.WriteString(fmt.Sprintf("MDE Installed:    %v\n", log.IdentifierExtraction.MDEInstalled))
		out.WriteString(fmt.Sprintf("Success:          %v\n", log.IdentifierExtraction.Success))
		out.WriteString(fmt.Sprintf("Machine ID:       %s\n", log.IdentifierExtraction.MachineID))
		out.WriteString(fmt.Sprintf("Tenant ID:        %s\n", log.IdentifierExtraction.TenantID))
		if log.IdentifierExtraction.SenseID != "" {
			out.WriteString(fmt.Sprintf("Sense ID:         %s\n", log.IdentifierExtraction.SenseID))
		}
	}

	// Memory patching
	if log.MemoryPatch != nil {
		out.WriteString("\n\nMEMORY PATCH ATTEMPT\n")
		out.WriteString(strings.Repeat("-", 80) + "\n")
		out.WriteString(fmt.Sprintf("Function:         %s\n", log.MemoryPatch.FunctionName))
		out.WriteString(fmt.Sprintf("Mode:             %s\n", log.MemoryPatch.Mode))
		out.WriteString(fmt.Sprintf("Success:          %v\n", log.MemoryPatch.Success))
		out.WriteString(fmt.Sprintf("Blocked:          %v\n", log.MemoryPatch.Blocked))
		if log.MemoryPatch.BlockedBy != "" {
			out.WriteString(fmt.Sprintf("Blocked By:       %s\n", log.MemoryPatch.BlockedBy))
		}
		if log.MemoryPatch.PatchAddress != "" {
			out.WriteString(fmt.Sprintf("Patch Address:    %s\n", log.MemoryPatch.PatchAddress))
		}
		out.WriteString(fmt.Sprintf("Patch Applied:    %v\n", log.MemoryPatch.PatchApplied))
		out.WriteString(fmt.Sprintf("Patch Verified:   %v\n", log.MemoryPatch.PatchVerified))
		out.WriteString(fmt.Sprintf("Restored:         %v\n", log.MemoryPatch.Restored))
	}

	// API Interception testing
	if log.NetworkTest != nil {
		out.WriteString("\n\nAPI INTERCEPTION SUMMARY\n")
		out.WriteString(strings.Repeat("-", 80) + "\n")
		out.WriteString(fmt.Sprintf("Total Requests:        %d\n", log.NetworkTest.TotalRequests))
		out.WriteString(fmt.Sprintf("Successful Requests:   %d\n", log.NetworkTest.SuccessfulRequests))
		out.WriteString(fmt.Sprintf("Failed Requests:       %d\n", log.NetworkTest.TotalRequests - log.NetworkTest.SuccessfulRequests))
		out.WriteString(fmt.Sprintf("Commands Intercepted:  %d\n", log.NetworkTest.CommandsIntercepted))
		out.WriteString(fmt.Sprintf("Vulnerability Found:   %v\n", log.NetworkTest.VulnerabilityFound))
		out.WriteString(fmt.Sprintf("Auth Bypass Works:     %v\n", log.NetworkTest.AuthBypassWorks))
		out.WriteString(fmt.Sprintf("Test Duration:         %.2fs\n", log.NetworkTest.TestDuration))

		if len(log.NetworkTest.Commands) > 0 {
			out.WriteString(fmt.Sprintf("\nIntercepted Commands: %d command(s)\n", len(log.NetworkTest.Commands)))
			for i, cmd := range log.NetworkTest.Commands {
				interceptedStatus := "Failed"
				if cmd.Intercepted {
					interceptedStatus = "Intercepted"
				}
				out.WriteString(fmt.Sprintf("  [%d] Type: %s, HTTP: %d, Status: %s\n", i+1, cmd.CommandType, cmd.HTTPStatus, interceptedStatus))
			}
		}

		if len(log.NetworkTest.ErrorMessages) > 0 {
			out.WriteString(fmt.Sprintf("\nErrors: %d error(s)\n", len(log.NetworkTest.ErrorMessages)))
			for i, errMsg := range log.NetworkTest.ErrorMessages {
				out.WriteString(fmt.Sprintf("  [%d] %s\n", i+1, errMsg))
			}
		}
	}

	// Files dropped
	if len(log.FilesDropped) > 0 {
		out.WriteString("\n\nFILES DROPPED\n")
		out.WriteString(strings.Repeat("-", 80) + "\n")
		for i, file := range log.FilesDropped {
			status := "OK"
			if file.Quarantined {
				status = "QUARANTINED"
			}
			out.WriteString(fmt.Sprintf("%d. %s [%s]\n", i+1, file.Filename, status))
			out.WriteString(fmt.Sprintf("   Path: %s\n", file.Path))
			out.WriteString(fmt.Sprintf("   Size: %d bytes\n", file.Size))
		}
	}

	// Processes executed
	if len(log.ProcessesExecuted) > 0 {
		out.WriteString("\n\nPROCESSES EXECUTED\n")
		out.WriteString(strings.Repeat("-", 80) + "\n")
		for i, proc := range log.ProcessesExecuted {
			status := "SUCCESS"
			if !proc.Success {
				status = "FAILED"
			}
			out.WriteString(fmt.Sprintf("%d. %s [%s]\n", i+1, proc.ProcessName, status))
			if proc.PID > 0 {
				out.WriteString(fmt.Sprintf("   PID: %d\n", proc.PID))
			}
			if proc.CommandLine != "" {
				out.WriteString(fmt.Sprintf("   CMD: %s\n", proc.CommandLine))
			}
			if proc.ErrorMsg != "" {
				out.WriteString(fmt.Sprintf("   Error: %s\n", proc.ErrorMsg))
			}
		}
	}

	// Detailed message log
	out.WriteString("\n\nDETAILED MESSAGE LOG\n")
	out.WriteString(strings.Repeat("-", 80) + "\n")
	for _, msg := range log.Messages {
		timestamp := msg.Timestamp.Format("15:04:05.000")
		out.WriteString(fmt.Sprintf("[%s] [%-8s] [%-25s] %s\n",
			timestamp, msg.Level, truncateString(msg.Phase, 25), msg.Message))
	}

	out.WriteString("\n" + strings.Repeat("=", 80) + "\n")
	out.WriteString("END OF LOG\n")
	out.WriteString(strings.Repeat("=", 80) + "\n")

	return out.String()
}

// captureSystemInfo gathers system context information
func captureSystemInfo() SystemInfo {
	hostname, _ := os.Hostname()

	info := SystemInfo{
		Hostname:        hostname,
		OSVersion:       getOSVersion(),
		Architecture:    getArchitecture(),
		DefenderRunning: isDefenderRunning(),
		MDEInstalled:    isMDEInstalled(),
		ProcessID:       os.Getpid(),
		Username:        os.Getenv("USERNAME"),
		IsAdmin:         isAdmin(),
	}

	if info.MDEInstalled {
		info.MDEVersion = getMDEVersion()
	}

	return info
}

// Helper functions

func getOSVersion() string {
	cmd := exec.Command("cmd", "/C", "ver")
	output, err := cmd.Output()
	if err != nil {
		return "Unknown"
	}
	return strings.TrimSpace(string(output))
}

func getArchitecture() string {
	if os.Getenv("PROCESSOR_ARCHITECTURE") != "" {
		return os.Getenv("PROCESSOR_ARCHITECTURE")
	}
	return "Unknown"
}

func isDefenderRunning() bool {
	cmd := exec.Command("sc", "query", "WinDefend")
	output, err := cmd.Output()
	if err != nil {
		return false
	}
	return strings.Contains(string(output), "RUNNING")
}

func isMDEInstalled() bool {
	key, err := registry.OpenKey(registry.LOCAL_MACHINE,
		`SOFTWARE\Microsoft\Windows Advanced Threat Protection`, registry.QUERY_VALUE)
	if err != nil {
		return false
	}
	defer key.Close()
	return true
}

func getMDEVersion() string {
	key, err := registry.OpenKey(registry.LOCAL_MACHINE,
		`SOFTWARE\Microsoft\Windows Advanced Threat Protection`, registry.QUERY_VALUE)
	if err != nil {
		return ""
	}
	defer key.Close()

	version, _, err := key.GetStringValue("Version")
	if err != nil {
		return "Unknown"
	}
	return version
}

func isAdmin() bool {
	cmd := exec.Command("net", "session")
	err := cmd.Run()
	return err == nil
}

func truncateString(s string, maxLen int) string {
	if len(s) <= maxLen {
		return s
	}
	return s[:maxLen-3] + "..."
}
