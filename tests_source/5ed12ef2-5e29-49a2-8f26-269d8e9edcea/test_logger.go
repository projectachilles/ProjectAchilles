// test_logger.go - Enhanced logging with multi-stage support for F0RT1KA tests
// Provides structured audit trail with support for multi-stage killchain tracking

//go:build windows
// +build windows

package main

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"
)

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
	Stages                []StageLog              `json:"stages,omitempty"`
	SystemInfo            SystemInfo              `json:"systemInfo"`
	Messages              []LogEntry              `json:"messages"`
	FilesDropped          []FileDropLog           `json:"filesDropped"`
	ProcessesExecuted     []ProcessLog            `json:"processesExecuted"`
	Result                string                  `json:"result"`
	BlockedAtStage        int                     `json:"blockedAtStage,omitempty"`
	BlockedTechnique      string                  `json:"blockedTechnique,omitempty"`
}

// StageLog tracks multi-stage execution
type StageLog struct {
	StageID       int       `json:"stageId"`
	Technique     string    `json:"technique"`
	Name          string    `json:"name"`
	StartTime     time.Time `json:"startTime"`
	EndTime       time.Time `json:"endTime"`
	DurationMs    int64     `json:"durationMs"`
	Status        string    `json:"status"`
	ExitCode      int       `json:"exitCode"`
	BlockedReason string    `json:"blockedReason,omitempty"`
}

// PhaseLog tracks individual test phases
type PhaseLog struct {
	PhaseNumber int       `json:"phaseNumber"`
	PhaseName   string    `json:"phaseName"`
	StartTime   time.Time `json:"startTime"`
	EndTime     time.Time `json:"endTime"`
	DurationMs  int64     `json:"durationMs"`
	Status      string    `json:"status"`
	Details     string    `json:"details"`
	Errors      []string  `json:"errors,omitempty"`
}

// LogEntry represents a single log entry
type LogEntry struct {
	Timestamp time.Time `json:"timestamp"`
	Level     string    `json:"level"`
	Phase     string    `json:"phase"`
	Message   string    `json:"message"`
}

// SystemInfo captures system context
type SystemInfo struct {
	Hostname          string `json:"hostname"`
	OSVersion         string `json:"osVersion"`
	Architecture      string `json:"architecture"`
	ProcessID         int    `json:"processId"`
	Username          string `json:"username"`
	TestDirectory     string `json:"testDirectory"`
}

// FileDropLog tracks file operations
type FileDropLog struct {
	Timestamp    time.Time `json:"timestamp"`
	FileName     string    `json:"fileName"`
	FilePath     string    `json:"filePath"`
	FileSize     int64     `json:"fileSize"`
	Quarantined  bool      `json:"quarantined"`
	Purpose      string    `json:"purpose,omitempty"`
}

// ProcessLog tracks process execution
type ProcessLog struct {
	Timestamp    time.Time `json:"timestamp"`
	ProcessName  string    `json:"processName"`
	CommandLine  string    `json:"commandLine"`
	PID          int       `json:"pid"`
	Success      bool      `json:"success"`
	ExitCode     int       `json:"exitCode"`
	ErrorMessage string    `json:"errorMessage,omitempty"`
}

var (
	globalLog     *TestLog
	logMutex      sync.Mutex
	currentPhases map[int]*PhaseLog
	currentStages map[int]*StageLog
	logInitialized bool
)

func init() {
	currentPhases = make(map[int]*PhaseLog)
	currentStages = make(map[int]*StageLog)
}

// InitLogger initializes the global test logger (main orchestrator)
func InitLogger(testID, testName string) {
	logMutex.Lock()
	defer logMutex.Unlock()

	globalLog = &TestLog{
		TestID:    testID,
		TestName:  testName,
		StartTime: time.Now(),
		Phases:    []PhaseLog{},
		Stages:    []StageLog{},
		Messages:  []LogEntry{},
		FilesDropped: []FileDropLog{},
		ProcessesExecuted: []ProcessLog{},
	}

	globalLog.SystemInfo = gatherSystemInfo()
	logInitialized = true

	// Note: Don't call LogMessage() here while holding mutex - would cause deadlock
	// Caller should log initialization message after InitLogger() returns
}

// AttachLogger attaches a stage to existing log (for stage binaries)
func AttachLogger(testID, stageName string) error {
	logMutex.Lock()
	defer logMutex.Unlock()

	// Load existing log from shared file
	logFile := filepath.Join("c:\\F0", "test_execution_log.json")
	data, err := os.ReadFile(logFile)
	if err != nil {
		// If no existing log, initialize minimal logger
		globalLog = &TestLog{
			TestID:    testID,
			TestName:  stageName,
			StartTime: time.Now(),
			Messages:  []LogEntry{},
		}
		logInitialized = true
		return nil
	}

	// Parse existing log
	if err := json.Unmarshal(data, &globalLog); err != nil {
		return fmt.Errorf("failed to parse existing log: %v", err)
	}

	logInitialized = true
	LogMessage("INFO", stageName, fmt.Sprintf("Stage %s attached to log", stageName))
	return nil
}

// logMessageInternal logs a message without acquiring mutex (caller must hold lock)
func logMessageInternal(level, phase, message string) {
	if !logInitialized || globalLog == nil {
		return
	}

	entry := LogEntry{
		Timestamp: time.Now(),
		Level:     level,
		Phase:     phase,
		Message:   message,
	}

	globalLog.Messages = append(globalLog.Messages, entry)

	// Also output to console for real-time visibility
	fmt.Printf("[%s] %s - %s: %s\n",
		entry.Timestamp.Format("15:04:05.000"),
		level, phase, message)
}

// LogMessage adds a message to the log
func LogMessage(level, phase, message string) {
	if !logInitialized || globalLog == nil {
		return
	}

	logMutex.Lock()
	defer logMutex.Unlock()

	logMessageInternal(level, phase, message)
}

// LogPhaseStart marks the beginning of a test phase
func LogPhaseStart(phaseNumber int, phaseName string) {
	if !logInitialized || globalLog == nil {
		return
	}

	logMutex.Lock()
	defer logMutex.Unlock()

	phase := &PhaseLog{
		PhaseNumber: phaseNumber,
		PhaseName:   phaseName,
		StartTime:   time.Now(),
		Status:      "in_progress",
	}

	currentPhases[phaseNumber] = phase
	logMessageInternal("INFO", phaseName, fmt.Sprintf("Phase %d started: %s", phaseNumber, phaseName))
}

// LogPhaseEnd marks the end of a test phase
func LogPhaseEnd(phaseNumber int, status, details string) {
	if !logInitialized || globalLog == nil {
		return
	}

	logMutex.Lock()
	defer logMutex.Unlock()

	phase, exists := currentPhases[phaseNumber]
	if !exists {
		logMessageInternal("ERROR", "Logging", fmt.Sprintf("Phase %d not found", phaseNumber))
		return
	}

	phase.EndTime = time.Now()
	phase.DurationMs = phase.EndTime.Sub(phase.StartTime).Milliseconds()
	phase.Status = status
	phase.Details = details

	globalLog.Phases = append(globalLog.Phases, *phase)
	delete(currentPhases, phaseNumber)

	logMessageInternal("INFO", phase.PhaseName,
		fmt.Sprintf("Phase %d completed (%s): %s", phaseNumber, status, details))
}

// LogStageStart marks the beginning of a killchain stage
func LogStageStart(stageID int, technique, name string) {
	if !logInitialized || globalLog == nil {
		return
	}

	logMutex.Lock()
	defer logMutex.Unlock()

	stage := &StageLog{
		StageID:   stageID,
		Technique: technique,
		Name:      name,
		StartTime: time.Now(),
		Status:    "in_progress",
	}

	currentStages[stageID] = stage
	logMessageInternal("INFO", technique, fmt.Sprintf("Stage %d started: %s (%s)", stageID, name, technique))
}

// LogStageEnd marks the end of a killchain stage
func LogStageEnd(stageID int, status string, exitCode int, blockedReason string) {
	if !logInitialized || globalLog == nil {
		return
	}

	logMutex.Lock()
	defer logMutex.Unlock()

	stage, exists := currentStages[stageID]
	if !exists {
		logMessageInternal("ERROR", "Logging", fmt.Sprintf("Stage %d not found", stageID))
		return
	}

	stage.EndTime = time.Now()
	stage.DurationMs = stage.EndTime.Sub(stage.StartTime).Milliseconds()
	stage.Status = status
	stage.ExitCode = exitCode
	stage.BlockedReason = blockedReason

	globalLog.Stages = append(globalLog.Stages, *stage)
	delete(currentStages, stageID)

	logMessageInternal("INFO", stage.Technique,
		fmt.Sprintf("Stage %d completed (%s): %s", stageID, status, stage.Name))
}

// LogFileDropped logs a file drop operation
func LogFileDropped(fileName, filePath string, fileSize int64, quarantined bool) {
	if !logInitialized || globalLog == nil {
		return
	}

	logMutex.Lock()
	defer logMutex.Unlock()

	entry := FileDropLog{
		Timestamp:   time.Now(),
		FileName:    fileName,
		FilePath:    filePath,
		FileSize:    fileSize,
		Quarantined: quarantined,
	}

	globalLog.FilesDropped = append(globalLog.FilesDropped, entry)

	status := "dropped"
	if quarantined {
		status = "quarantined"
	}
	logMessageInternal("INFO", "File Operations",
		fmt.Sprintf("File %s: %s (%d bytes)", status, fileName, fileSize))
}

// LogProcessExecution logs process execution
func LogProcessExecution(processName, commandLine string, pid int, success bool, exitCode int, errorMsg string) {
	if !logInitialized || globalLog == nil {
		return
	}

	logMutex.Lock()
	defer logMutex.Unlock()

	entry := ProcessLog{
		Timestamp:    time.Now(),
		ProcessName:  processName,
		CommandLine:  commandLine,
		PID:          pid,
		Success:      success,
		ExitCode:     exitCode,
		ErrorMessage: errorMsg,
	}

	globalLog.ProcessesExecuted = append(globalLog.ProcessesExecuted, entry)

	status := "success"
	if !success {
		status = "failed"
	}
	logMessageInternal("INFO", "Process Execution",
		fmt.Sprintf("Process %s: %s (PID: %d, Exit: %d)", processName, status, pid, exitCode))
}

// SaveLog finalizes and saves the log to disk
func SaveLog(exitCode int, exitReason string) {
	if !logInitialized || globalLog == nil {
		return
	}

	logMutex.Lock()
	defer logMutex.Unlock()

	globalLog.EndTime = time.Now()
	globalLog.Duration = globalLog.EndTime.Sub(globalLog.StartTime).Milliseconds()
	globalLog.ExitCode = exitCode
	globalLog.ExitReason = exitReason

	// Determine result based on exit code
	switch exitCode {
	case 101:
		globalLog.Result = "VULNERABLE"
	case 105, 126:
		globalLog.Result = "PROTECTED"
	case 999:
		globalLog.Result = "ERROR"
	default:
		globalLog.Result = "UNKNOWN"
	}

	// Save JSON log
	jsonData, _ := json.MarshalIndent(globalLog, "", "  ")
	jsonFile := filepath.Join("c:\\F0", "test_execution_log.json")
	os.WriteFile(jsonFile, jsonData, 0644)

	// Save text log
	textFile := filepath.Join("c:\\F0", "test_execution_log.txt")
	textLog := formatTextLog()
	os.WriteFile(textFile, []byte(textLog), 0644)

	logMessageInternal("INFO", "Logging", fmt.Sprintf("Test logs saved to %s", jsonFile))
}

// AppendToSharedLog appends stage data to shared log (thread-safe)
func AppendToSharedLog(stageData StageLog) error {
	logMutex.Lock()
	defer logMutex.Unlock()

	// Read existing log
	logFile := filepath.Join("c:\\F0", "test_execution_log.json")
	data, err := os.ReadFile(logFile)
	if err != nil {
		return fmt.Errorf("failed to read shared log: %v", err)
	}

	var log TestLog
	if err := json.Unmarshal(data, &log); err != nil {
		return fmt.Errorf("failed to parse shared log: %v", err)
	}

	// Append stage data
	log.Stages = append(log.Stages, stageData)

	// Check if this stage was blocked
	if stageData.Status == "blocked" {
		log.BlockedAtStage = stageData.StageID
		log.BlockedTechnique = stageData.Technique
	}

	// Save updated log
	jsonData, _ := json.MarshalIndent(log, "", "  ")
	return os.WriteFile(logFile, jsonData, 0644)
}

// gatherSystemInfo collects system information
func gatherSystemInfo() SystemInfo {
	hostname, _ := os.Hostname()
	username := os.Getenv("USERNAME")

	return SystemInfo{
		Hostname:      hostname,
		OSVersion:     "Windows",
		Architecture:  os.Getenv("PROCESSOR_ARCHITECTURE"),
		ProcessID:     os.Getpid(),
		Username:      username,
		TestDirectory: "C:\\F0",
	}
}

// formatTextLog creates a human-readable text log
func formatTextLog() string {
	var sb strings.Builder

	sb.WriteString("=" + strings.Repeat("=", 78) + "\n")
	sb.WriteString(fmt.Sprintf("F0RT1KA TEST EXECUTION LOG\n"))
	sb.WriteString("=" + strings.Repeat("=", 78) + "\n\n")

	sb.WriteString(fmt.Sprintf("Test ID:     %s\n", globalLog.TestID))
	sb.WriteString(fmt.Sprintf("Test Name:   %s\n", globalLog.TestName))
	sb.WriteString(fmt.Sprintf("Start Time:  %s\n", globalLog.StartTime.Format("2006-01-02 15:04:05")))
	sb.WriteString(fmt.Sprintf("End Time:    %s\n", globalLog.EndTime.Format("2006-01-02 15:04:05")))
	sb.WriteString(fmt.Sprintf("Duration:    %d ms\n", globalLog.Duration))
	sb.WriteString(fmt.Sprintf("Exit Code:   %d\n", globalLog.ExitCode))
	sb.WriteString(fmt.Sprintf("Exit Reason: %s\n", globalLog.ExitReason))
	sb.WriteString(fmt.Sprintf("Result:      %s\n\n", globalLog.Result))

	if len(globalLog.Stages) > 0 {
		sb.WriteString("KILLCHAIN STAGES\n")
		sb.WriteString("-" + strings.Repeat("-", 78) + "\n")
		for _, stage := range globalLog.Stages {
			sb.WriteString(fmt.Sprintf("  Stage %d: %s (%s)\n", stage.StageID, stage.Name, stage.Technique))
			sb.WriteString(fmt.Sprintf("    Status: %s (Exit: %d)\n", stage.Status, stage.ExitCode))
			if stage.BlockedReason != "" {
				sb.WriteString(fmt.Sprintf("    Blocked: %s\n", stage.BlockedReason))
			}
			sb.WriteString(fmt.Sprintf("    Duration: %d ms\n", stage.DurationMs))
		}
		sb.WriteString("\n")
	}

	if globalLog.BlockedAtStage > 0 {
		sb.WriteString(fmt.Sprintf("BLOCKED AT STAGE: %d\n", globalLog.BlockedAtStage))
		sb.WriteString(fmt.Sprintf("BLOCKED TECHNIQUE: %s\n\n", globalLog.BlockedTechnique))
	}

	if len(globalLog.Phases) > 0 {
		sb.WriteString("TEST PHASES\n")
		sb.WriteString("-" + strings.Repeat("-", 78) + "\n")
		for _, phase := range globalLog.Phases {
			sb.WriteString(fmt.Sprintf("  Phase %d: %s\n", phase.PhaseNumber, phase.PhaseName))
			sb.WriteString(fmt.Sprintf("    Status: %s\n", phase.Status))
			sb.WriteString(fmt.Sprintf("    Details: %s\n", phase.Details))
			sb.WriteString(fmt.Sprintf("    Duration: %d ms\n", phase.DurationMs))
		}
		sb.WriteString("\n")
	}

	if len(globalLog.FilesDropped) > 0 {
		sb.WriteString("FILES DROPPED\n")
		sb.WriteString("-" + strings.Repeat("-", 78) + "\n")
		for _, file := range globalLog.FilesDropped {
			status := "OK"
			if file.Quarantined {
				status = "QUARANTINED"
			}
			sb.WriteString(fmt.Sprintf("  %s: %s (%d bytes) [%s]\n",
				file.FileName, file.FilePath, file.FileSize, status))
		}
		sb.WriteString("\n")
	}

	if len(globalLog.ProcessesExecuted) > 0 {
		sb.WriteString("PROCESSES EXECUTED\n")
		sb.WriteString("-" + strings.Repeat("-", 78) + "\n")
		for _, proc := range globalLog.ProcessesExecuted {
			status := "SUCCESS"
			if !proc.Success {
				status = "FAILED"
			}
			sb.WriteString(fmt.Sprintf("  %s (PID: %d): %s (Exit: %d)\n",
				proc.ProcessName, proc.PID, status, proc.ExitCode))
		}
		sb.WriteString("\n")
	}

	sb.WriteString("SYSTEM INFORMATION\n")
	sb.WriteString("-" + strings.Repeat("-", 78) + "\n")
	sb.WriteString(fmt.Sprintf("  Hostname:     %s\n", globalLog.SystemInfo.Hostname))
	sb.WriteString(fmt.Sprintf("  OS:           %s\n", globalLog.SystemInfo.OSVersion))
	sb.WriteString(fmt.Sprintf("  Architecture: %s\n", globalLog.SystemInfo.Architecture))
	sb.WriteString(fmt.Sprintf("  Username:     %s\n", globalLog.SystemInfo.Username))
	sb.WriteString(fmt.Sprintf("  Process ID:   %d\n", globalLog.SystemInfo.ProcessID))
	sb.WriteString("\n")

	sb.WriteString("=" + strings.Repeat("=", 78) + "\n")

	return sb.String()
}