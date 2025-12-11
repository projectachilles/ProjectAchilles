// test_logger.go - F0RT1KA Test Results Schema v2.0 Compliant Logger
// Provides comprehensive structured logging conforming to test-results-schema-v2.0.json
// Supports both standard and multi-stage test architectures
//
// SCHEMA v2.0 FEATURES:
// - Schema versioning for backward compatibility
// - Rich metadata (MITRE ATT&CK, scoring, categorization)
// - Execution context (organization, environment, batch correlation)
// - Computed outcomes (protection status, detection phase)
// - Pre-computed metrics for dashboard performance
// - ISO 8601 UTC timestamps for time-series analysis
//
// MULTI-STAGE SUPPORT:
// - AttachLogger() for stage binaries to attach to existing log
// - LogStageStart(), LogStageEnd(), LogStageBlocked() for stage-specific logging
// - Thread-safe log file operations for concurrent stage execution
// - Stage result tracking with technique-level precision

//go:build windows
// +build windows

package main

import (
	"bytes"
	"crypto/sha256"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"golang.org/x/sys/windows/registry"
)

// ==============================================================================
// SCHEMA VERSION - DO NOT MODIFY
// ==============================================================================

const SCHEMA_VERSION = "2.0"

// ==============================================================================
// DATA STRUCTURES - F0RT1KA Test Results Schema v2.0
// ==============================================================================

// TestLog is the main structure containing all test execution data
// Conforms to test-results-schema-v2.0.json
type TestLog struct {
	// Schema identification
	SchemaVersion string `json:"schemaVersion"`

	// Core identifiers
	TestID   string `json:"testId"`
	TestName string `json:"testName"`

	// Test metadata (REQUIRED in v2.0)
	TestMetadata TestMetadata `json:"testMetadata"`

	// Execution context (REQUIRED in v2.0)
	ExecutionContext ExecutionContext `json:"executionContext"`

	// Timing (ISO 8601 UTC)
	StartTime  JSONTime `json:"startTime"`
	EndTime    JSONTime `json:"endTime"`
	DurationMs int64    `json:"durationMs"`

	// Exit information
	ExitCode   int    `json:"exitCode"`
	ExitReason string `json:"exitReason"`

	// Computed outcome (NEW in v2.0)
	Outcome Outcome `json:"outcome"`

	// Multi-stage support
	IsMultiStage     bool      `json:"isMultiStage,omitempty"`
	Stages           []Stage   `json:"stages,omitempty"`
	BlockedAtStage   int       `json:"blockedAtStage,omitempty"`
	BlockedTechnique string    `json:"blockedTechnique,omitempty"`

	// System information
	SystemInfo SystemInfo `json:"systemInfo"`

	// Execution details
	Phases            []Phase     `json:"phases"`
	Messages          []LogEntry  `json:"messages"`
	FilesDropped      []FileDrop  `json:"filesDropped"`
	ProcessesExecuted []Process   `json:"processesExecuted"`

	// Test-specific data (optional)
	CertBypass           *CertBypassLog       `json:"certBypass,omitempty"`
	NetworkTest          *NetworkTestSummary  `json:"networkTest,omitempty"`
	IdentifierExtraction *IdentifierLog       `json:"identifierExtraction,omitempty"`

	// Aggregation metrics (NEW in v2.0)
	Metrics *Metrics `json:"metrics,omitempty"`

	// Artifacts (NEW in v2.0)
	Artifacts *Artifacts `json:"artifacts,omitempty"`

	// Export status (v2.1) - tracks direct ES export attempts
	ExportStatus *ExportStatus `json:"exportStatus,omitempty"`
}

// TestMetadata contains test classification and attribution
type TestMetadata struct {
	Version        string         `json:"version"`        // Test version (semantic versioning)
	Category       string         `json:"category"`       // Test category
	Severity       string         `json:"severity"`       // Threat severity
	Techniques     []string       `json:"techniques"`     // MITRE ATT&CK technique IDs
	Tactics        []string       `json:"tactics"`        // MITRE ATT&CK tactic names
	Score          float64        `json:"score,omitempty"`          // Overall test quality score (0-10)
	ScoreBreakdown *ScoreBreakdown `json:"scoreBreakdown,omitempty"` // Detailed scoring
	Tags           []string       `json:"tags,omitempty"`           // Additional classification tags
}

// ScoreBreakdown provides detailed test quality scoring
type ScoreBreakdown struct {
	RealWorldAccuracy       float64 `json:"realWorldAccuracy"`       // 0-3
	TechnicalSophistication float64 `json:"technicalSophistication"` // 0-3
	SafetyMechanisms        float64 `json:"safetyMechanisms"`        // 0-2
	DetectionOpportunities  float64 `json:"detectionOpportunities"`  // 0-1
	LoggingObservability    float64 `json:"loggingObservability"`    // 0-1
}

// ExecutionContext provides execution environment details
type ExecutionContext struct {
	ExecutionID    string                  `json:"executionId"`              // Unique execution run ID (UUID)
	BatchID        string                  `json:"batchId,omitempty"`        // Optional batch identifier
	Organization   string                  `json:"organization"`             // Organization ID (sb, tpsgl, rga)
	Environment    string                  `json:"environment"`              // Deployment environment
	DeploymentType string                  `json:"deploymentType,omitempty"` // How test was deployed
	TriggeredBy    string                  `json:"triggeredBy,omitempty"`    // Who/what initiated test
	Configuration  *ExecutionConfiguration `json:"configuration,omitempty"`  // Test configuration
}

// ExecutionConfiguration contains test execution settings
type ExecutionConfiguration struct {
	TimeoutMs         int    `json:"timeoutMs,omitempty"`         // Configured timeout
	CertificateMode   string `json:"certificateMode,omitempty"`   // Certificate installation mode
	MultiStageEnabled bool   `json:"multiStageEnabled,omitempty"` // Multi-stage flag
}

// Outcome contains computed outcome metrics
type Outcome struct {
	Protected            bool     `json:"protected"`                      // Whether endpoint was protected
	Category             string   `json:"category"`                       // Outcome categorization
	DetectionPhase       *string  `json:"detectionPhase"`                 // Phase where detection occurred (null if unprotected)
	BlockedTechniques    []string `json:"blockedTechniques,omitempty"`    // ATT&CK techniques blocked
	SuccessfulTechniques []string `json:"successfulTechniques,omitempty"` // ATT&CK techniques succeeded
}

// Stage tracks individual stage execution in multi-stage tests
type Stage struct {
	StageID      int      `json:"stageId"`
	Technique    string   `json:"technique"` // MITRE ATT&CK ID
	Name         string   `json:"name"`
	StartTime    JSONTime `json:"startTime"`
	EndTime      JSONTime `json:"endTime"`
	DurationMs   int64    `json:"durationMs"`
	Status       string   `json:"status"` // "success", "blocked", "error", "skipped"
	ExitCode     int      `json:"exitCode"`
	BlockedBy    string   `json:"blockedBy,omitempty"`
	ErrorMessage string   `json:"errorMessage,omitempty"`
}

// Phase tracks individual test phases
type Phase struct {
	PhaseNumber int      `json:"phaseNumber"`
	PhaseName   string   `json:"phaseName"`
	StartTime   JSONTime `json:"startTime"`
	EndTime     JSONTime `json:"endTime"`
	DurationMs  int64    `json:"durationMs"`
	Status      string   `json:"status"` // "success", "failed", "blocked", "skipped", "in_progress"
	Details     string   `json:"details,omitempty"`
	Errors      []string `json:"errors,omitempty"`
}

// LogEntry represents a single log message
type LogEntry struct {
	Timestamp JSONTime `json:"timestamp"`
	Level     string   `json:"level"` // "INFO", "WARN", "ERROR", "CRITICAL", "SUCCESS", "DEBUG"
	Phase     string   `json:"phase"`
	Message   string   `json:"message"`
}

// SystemInfo captures target system context
type SystemInfo struct {
	Hostname        string         `json:"hostname"`
	OSVersion       string         `json:"osVersion"`
	Architecture    string         `json:"architecture"`
	DefenderRunning bool           `json:"defenderRunning"`
	MDEInstalled    bool           `json:"mdeInstalled"`
	MDEVersion      string         `json:"mdeVersion,omitempty"`
	ProcessID       int            `json:"processId"`
	Username        string         `json:"username"`
	IsAdmin         bool           `json:"isAdmin"`
	EDRProducts     []EDRProduct   `json:"edrProducts,omitempty"`
}

// EDRProduct represents detected EDR/AV product
type EDRProduct struct {
	Name    string `json:"name"`
	Version string `json:"version,omitempty"`
	Running bool   `json:"running"`
}

// FileDrop tracks files dropped during test
type FileDrop struct {
	Filename    string   `json:"filename"`
	Path        string   `json:"path"`
	Size        int64    `json:"size"`
	Quarantined bool     `json:"quarantined"`
	Timestamp   JSONTime `json:"timestamp"`
	SHA256      string   `json:"sha256,omitempty"`
	FileType    string   `json:"fileType,omitempty"`
}

// Process tracks processes executed during test
type Process struct {
	ProcessName string   `json:"processName"`
	CommandLine string   `json:"commandLine,omitempty"`
	PID         int      `json:"pid,omitempty"`
	Success     bool     `json:"success"`
	ExitCode    int      `json:"exitCode,omitempty"`
	Timestamp   JSONTime `json:"timestamp"`
	ErrorMsg    string   `json:"errorMsg,omitempty"`
	ParentPID   int      `json:"parentPid,omitempty"`
}

// CertBypassLog tracks certificate bypass attempts
type CertBypassLog struct {
	Mode           string   `json:"mode"`
	Attempted      bool     `json:"attempted"`
	Success        bool     `json:"success"`
	Blocked        bool     `json:"blocked"`
	BlockedBy      string   `json:"blockedBy,omitempty"`
	WatchdogActive bool     `json:"watchdogActive"`
	RestoreSuccess bool     `json:"restoreSuccess"`
	DurationMs     int64    `json:"durationMs"`
	PatchAddress   string   `json:"patchAddress,omitempty"`
	Timestamp      JSONTime `json:"timestamp"`
}

// IdentifierLog tracks identifier extraction
type IdentifierLog struct {
	Method       string   `json:"method"` // "registry", "config", "wmi", "api", "simulated"
	MDEInstalled bool     `json:"mdeInstalled"`
	Success      bool     `json:"success"`
	MachineID    string   `json:"machineId,omitempty"`
	TenantID     string   `json:"tenantId,omitempty"`
	SenseID      string   `json:"senseId,omitempty"`
	OrgID        string   `json:"orgId,omitempty"`
	Timestamp    JSONTime `json:"timestamp"`
}

// NetworkTestSummary tracks network testing details
type NetworkTestSummary struct {
	TotalEndpoints    int           `json:"totalEndpoints"`
	SuccessfulTests   int           `json:"successfulTests"`
	FailedTests       int           `json:"failedTests"`
	VulnerableCount   int           `json:"vulnerableCount"`
	ProtectedCount    int           `json:"protectedCount"`
	OverallVulnerable bool          `json:"overallVulnerable"`
	Results           []interface{} `json:"results,omitempty"`
}

// Metrics provides pre-computed aggregation metrics
type Metrics struct {
	TotalPhases        int `json:"totalPhases"`
	SuccessfulPhases   int `json:"successfulPhases"`
	FailedPhases       int `json:"failedPhases"`
	TotalFilesDropped  int `json:"totalFilesDropped"`
	FilesQuarantined   int `json:"filesQuarantined"`
	TotalProcesses     int `json:"totalProcesses"`
	SuccessfulProcesses int `json:"successfulProcesses"`
	TotalLogMessages   int `json:"totalLogMessages"`
	ErrorCount         int `json:"errorCount"`
	CriticalCount      int `json:"criticalCount"`
}

// Artifacts contains paths to test artifacts
type Artifacts struct {
	LogFilePath       string   `json:"logFilePath,omitempty"`
	JSONFilePath      string   `json:"jsonFilePath,omitempty"`
	ScreenshotPaths   []string `json:"screenshotPaths,omitempty"`
	PacketCapturePath string   `json:"packetCapturePath,omitempty"`
}

// ExportStatus tracks Elasticsearch export attempts (v2.1)
// This enables the collector to skip already-exported results and retry failures
type ExportStatus struct {
	Attempted     bool   `json:"attempted"`               // Whether export was attempted
	Success       bool   `json:"success"`                 // Whether export succeeded
	Timestamp     string `json:"timestamp,omitempty"`     // When export was attempted (ISO 8601)
	Endpoint      string `json:"endpoint,omitempty"`      // ES endpoint URL (without API key)
	Index         string `json:"index,omitempty"`         // Target index name
	DocumentID    string `json:"documentId,omitempty"`    // ES document ID
	Error         string `json:"error,omitempty"`         // Error message if failed
	RetryEligible bool   `json:"retryEligible"`           // Whether collector should retry
}

// ==============================================================================
// JSON TIME HANDLING - ISO 8601 UTC
// ==============================================================================

// JSONTime wraps time.Time to provide ISO 8601 UTC JSON marshaling
type JSONTime struct {
	time.Time
}

// MarshalJSON implements json.Marshaler for ISO 8601 UTC format
func (t JSONTime) MarshalJSON() ([]byte, error) {
	if t.Time.IsZero() {
		return []byte("null"), nil
	}
	// Format as ISO 8601 UTC: 2024-11-14T15:30:45.123Z
	formatted := fmt.Sprintf("\"%s\"", t.UTC().Format("2006-01-02T15:04:05.000Z"))
	return []byte(formatted), nil
}

// UnmarshalJSON implements json.Unmarshaler for ISO 8601 parsing
func (t *JSONTime) UnmarshalJSON(data []byte) error {
	if string(data) == "null" {
		return nil
	}
	str := strings.Trim(string(data), "\"")
	parsed, err := time.Parse("2006-01-02T15:04:05.000Z", str)
	if err != nil {
		// Try alternative format without milliseconds
		parsed, err = time.Parse("2006-01-02T15:04:05Z", str)
		if err != nil {
			return err
		}
	}
	t.Time = parsed
	return nil
}

// NewJSONTime creates a JSONTime from time.Time
func NewJSONTime(t time.Time) JSONTime {
	return JSONTime{Time: t}
}

// ==============================================================================
// GLOBAL STATE
// ==============================================================================

var (
	globalLog *TestLog
	logMutex  sync.Mutex
	isStage   bool = false // true if this is a stage binary
)

// ==============================================================================
// INITIALIZATION FUNCTIONS
// ==============================================================================

// InitLogger initializes the global test logger (main orchestrator only)
// metadata and executionContext must be provided to conform to schema v2.0
func InitLogger(testID, testName string, metadata TestMetadata, executionContext ExecutionContext) *TestLog {
	logMutex.Lock()
	defer logMutex.Unlock()

	globalLog = &TestLog{
		SchemaVersion:     SCHEMA_VERSION,
		TestID:            testID,
		TestName:          testName,
		TestMetadata:      metadata,
		ExecutionContext:  executionContext,
		StartTime:         NewJSONTime(time.Now().UTC()),
		IsMultiStage:      false,
		Phases:            []Phase{},
		Stages:            []Stage{},
		Messages:          []LogEntry{},
		FilesDropped:      []FileDrop{},
		ProcessesExecuted: []Process{},
		SystemInfo:        captureSystemInfo(),
	}

	addMessage("INFO", "Initialization", fmt.Sprintf("Test logger initialized for %s (Schema v%s)", testName, SCHEMA_VERSION))
	addMessage("INFO", "Initialization", fmt.Sprintf("Running as: %s (Admin: %v)", globalLog.SystemInfo.Username, globalLog.SystemInfo.IsAdmin))
	addMessage("INFO", "Initialization", fmt.Sprintf("Execution ID: %s", executionContext.ExecutionID))
	addMessage("INFO", "Initialization", fmt.Sprintf("Organization: %s | Environment: %s", executionContext.Organization, executionContext.Environment))

	return globalLog
}

// AttachLogger attaches a stage binary to existing shared log
// Stage binaries call this instead of InitLogger()
func AttachLogger(testID, stageName string) {
	logMutex.Lock()
	defer logMutex.Unlock()

	isStage = true

	// Load existing log if available
	logPath := filepath.Join("C:\\F0", "test_execution_log.json")
	if data, err := os.ReadFile(logPath); err == nil {
		if err := json.Unmarshal(data, &globalLog); err == nil {
			addMessage("INFO", stageName, "Stage attached to shared log")
			return
		}
	}

	// Create minimal log if file doesn't exist yet (shouldn't happen in normal flow)
	globalLog = &TestLog{
		SchemaVersion:     SCHEMA_VERSION,
		TestID:            testID,
		TestName:          "Multi-Stage Test",
		IsMultiStage:      true,
		StartTime:         NewJSONTime(time.Now().UTC()),
		Phases:            []Phase{},
		Stages:            []Stage{},
		Messages:          []LogEntry{},
		FilesDropped:      []FileDrop{},
		ProcessesExecuted: []Process{},
		SystemInfo:        captureSystemInfo(),
		// Metadata and ExecutionContext will be set by main orchestrator
		TestMetadata:     TestMetadata{},
		ExecutionContext: ExecutionContext{},
	}

	addMessage("WARN", stageName, "Stage created new log (orchestrator not started yet)")
}

// ==============================================================================
// MULTI-STAGE LOGGING FUNCTIONS
// ==============================================================================

// LogStageStart starts tracking a stage execution
func LogStageStart(stageID int, technique, name string) {
	logMutex.Lock()
	defer logMutex.Unlock()

	globalLog.IsMultiStage = true

	stage := Stage{
		StageID:   stageID,
		Technique: technique,
		Name:      name,
		StartTime: NewJSONTime(time.Now().UTC()),
		Status:    "in_progress",
	}

	globalLog.Stages = append(globalLog.Stages, stage)
	addMessage("INFO", technique, fmt.Sprintf("Stage %d started: %s", stageID, name))
}

// LogStageEnd completes a stage with status
func LogStageEnd(stageID int, technique, status, details string) {
	logMutex.Lock()
	defer logMutex.Unlock()

	for i := range globalLog.Stages {
		if globalLog.Stages[i].StageID == stageID && globalLog.Stages[i].Technique == technique {
			globalLog.Stages[i].EndTime = NewJSONTime(time.Now().UTC())
			globalLog.Stages[i].Status = status
			globalLog.Stages[i].DurationMs = time.Now().UTC().Sub(globalLog.Stages[i].StartTime.Time).Milliseconds()

			addMessage("INFO", technique, fmt.Sprintf("Stage %d completed: %s (%dms)", stageID, status, globalLog.Stages[i].DurationMs))

			if isStage {
				persistLog()
			}
			return
		}
	}
}

// LogStageBlocked logs a stage being blocked by EDR
func LogStageBlocked(stageID int, technique, reason string) {
	logMutex.Lock()
	defer logMutex.Unlock()

	for i := range globalLog.Stages {
		if globalLog.Stages[i].StageID == stageID && globalLog.Stages[i].Technique == technique {
			globalLog.Stages[i].EndTime = NewJSONTime(time.Now().UTC())
			globalLog.Stages[i].Status = "blocked"
			globalLog.Stages[i].BlockedBy = reason
			globalLog.Stages[i].DurationMs = time.Now().UTC().Sub(globalLog.Stages[i].StartTime.Time).Milliseconds()
			globalLog.Stages[i].ExitCode = 126

			globalLog.BlockedAtStage = stageID
			globalLog.BlockedTechnique = technique

			addMessage("ERROR", technique, fmt.Sprintf("Stage %d BLOCKED: %s", stageID, reason))

			if isStage {
				persistLog()
			}
			return
		}
	}
}

// ==============================================================================
// STANDARD LOGGING FUNCTIONS
// ==============================================================================

// LogPhaseStart starts tracking a new phase
func LogPhaseStart(phaseNumber int, phaseName string) {
	logMutex.Lock()
	defer logMutex.Unlock()

	phase := Phase{
		PhaseNumber: phaseNumber,
		PhaseName:   phaseName,
		StartTime:   NewJSONTime(time.Now().UTC()),
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

	if phaseNumber >= 0 && phaseNumber < len(globalLog.Phases) {
		globalLog.Phases[phaseNumber].EndTime = NewJSONTime(time.Now().UTC())
		globalLog.Phases[phaseNumber].Status = status
		globalLog.Phases[phaseNumber].Details = details
		globalLog.Phases[phaseNumber].DurationMs = time.Now().UTC().Sub(globalLog.Phases[phaseNumber].StartTime.Time).Milliseconds()

		addMessage("INFO", globalLog.Phases[phaseNumber].PhaseName,
			fmt.Sprintf("Phase %d completed: %s (%d ms)", phaseNumber, status, globalLog.Phases[phaseNumber].DurationMs))
	}
}

// LogPhaseError adds an error to a phase
func LogPhaseError(phaseNumber int, errorMsg string) {
	logMutex.Lock()
	defer logMutex.Unlock()

	if phaseNumber >= 0 && phaseNumber < len(globalLog.Phases) {
		globalLog.Phases[phaseNumber].Errors = append(globalLog.Phases[phaseNumber].Errors, errorMsg)
		addMessage("ERROR", globalLog.Phases[phaseNumber].PhaseName, errorMsg)
	}
}

// LogMessage adds a message to the log (thread-safe)
func LogMessage(level, phase, message string) {
	logMutex.Lock()
	defer logMutex.Unlock()

	addMessage(level, phase, message)

	if isStage {
		persistLog()
	}
}

// addMessage internal function (assumes lock is held)
func addMessage(level, phase, message string) {
	msg := LogEntry{
		Timestamp: NewJSONTime(time.Now().UTC()),
		Level:     level,
		Phase:     phase,
		Message:   message,
	}

	globalLog.Messages = append(globalLog.Messages, msg)
}

// LogFileDropped logs a file drop operation
func LogFileDropped(filename, path string, size int64, quarantined bool) {
	logMutex.Lock()
	defer logMutex.Unlock()

	ext := filepath.Ext(filename)
	if len(ext) > 0 {
		ext = ext[1:] // Remove leading dot
	}

	fileDrop := FileDrop{
		Filename:    filename,
		Path:        path,
		Size:        size,
		Quarantined: quarantined,
		Timestamp:   NewJSONTime(time.Now().UTC()),
		FileType:    ext,
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

	proc := Process{
		ProcessName: processName,
		CommandLine: commandLine,
		PID:         pid,
		Success:     success,
		ExitCode:    exitCode,
		Timestamp:   NewJSONTime(time.Now().UTC()),
		ErrorMsg:    errorMsg,
		ParentPID:   os.Getpid(), // Current process is parent
	}

	globalLog.ProcessesExecuted = append(globalLog.ProcessesExecuted, proc)

	if success {
		addMessage("INFO", "Process Execution", fmt.Sprintf("Executed: %s (PID: %d)", processName, pid))
	} else {
		addMessage("ERROR", "Process Execution", fmt.Sprintf("Failed: %s - %s", processName, errorMsg))
	}
}

// ==============================================================================
// SAVE FUNCTIONS
// ==============================================================================

// SaveLog saves the complete log to disk with computed outcomes and metrics
// Also attempts direct Elasticsearch export if configured at build time
func SaveLog(exitCode int, exitReason string) error {
	logMutex.Lock()
	defer logMutex.Unlock()

	globalLog.EndTime = NewJSONTime(time.Now().UTC())
	globalLog.DurationMs = time.Now().UTC().Sub(globalLog.StartTime.Time).Milliseconds()
	globalLog.ExitCode = exitCode
	globalLog.ExitReason = exitReason

	// Compute outcome
	globalLog.Outcome = computeOutcome(exitCode)

	// Compute metrics
	globalLog.Metrics = computeMetrics()

	// Set artifacts
	globalLog.Artifacts = &Artifacts{
		LogFilePath:  "C:\\F0\\test_execution_log.txt",
		JSONFilePath: "C:\\F0\\test_execution_log.json",
	}

	// Step 1: Persist to disk FIRST (ensures data is saved before network operations)
	if err := persistLog(); err != nil {
		return err
	}

	// Step 2: Attempt Elasticsearch export (if configured at build time)
	// This runs AFTER local persistence succeeds to ensure data is never lost
	exportStatus := exportToElasticsearch(globalLog)

	// Step 3: Update JSON with export status (re-write with exportStatus field)
	if exportStatus != nil {
		globalLog.ExportStatus = exportStatus

		// Re-persist to include export status in JSON
		if err := persistLog(); err != nil {
			// Log warning but don't fail - the original JSON was already saved
			fmt.Printf("[!] Warning: Failed to update export status in JSON: %v\n", err)
		}

		// Console feedback (main orchestrator only)
		if !isStage {
			if exportStatus.Success {
				fmt.Printf("[+] Results exported to Elasticsearch: %s/%s\n", exportStatus.Index, exportStatus.DocumentID)
			} else {
				fmt.Printf("[!] ES export failed (collector will retry): %s\n", exportStatus.Error)
			}
		}
	}

	return nil
}

// computeOutcome calculates outcome based on exit code and test execution
func computeOutcome(exitCode int) Outcome {
	outcome := Outcome{
		Protected:            exitCode == 105 || exitCode == 126 || exitCode == 127,
		BlockedTechniques:    []string{},
		SuccessfulTechniques: []string{},
	}

	// Categorize outcome
	switch exitCode {
	case 105:
		outcome.Category = "quarantined_on_extraction"
		phase := "file_drop"
		outcome.DetectionPhase = &phase
	case 126:
		outcome.Category = "execution_prevented"
		phase := "pre_execution"
		outcome.DetectionPhase = &phase
	case 127:
		outcome.Category = "quarantined_on_execution"
		phase := "during_execution"
		outcome.DetectionPhase = &phase
	case 101:
		outcome.Category = "unprotected"
		outcome.DetectionPhase = nil
	case 102:
		outcome.Category = "timeout"
		outcome.DetectionPhase = nil
	case 999, 1:
		outcome.Category = "test_error"
		outcome.DetectionPhase = nil
	default:
		outcome.Category = "unknown"
		outcome.DetectionPhase = nil
	}

	// For multi-stage tests, populate blocked/successful techniques
	if globalLog.IsMultiStage {
		for _, stage := range globalLog.Stages {
			if stage.Status == "blocked" {
				outcome.BlockedTechniques = append(outcome.BlockedTechniques, stage.Technique)
			} else if stage.Status == "success" {
				outcome.SuccessfulTechniques = append(outcome.SuccessfulTechniques, stage.Technique)
			}
		}
	} else {
		// For standard tests, use metadata techniques
		if outcome.Protected {
			outcome.BlockedTechniques = globalLog.TestMetadata.Techniques
		} else {
			outcome.SuccessfulTechniques = globalLog.TestMetadata.Techniques
		}
	}

	return outcome
}

// computeMetrics calculates aggregation metrics for dashboard performance
func computeMetrics() *Metrics {
	metrics := &Metrics{
		TotalPhases:        len(globalLog.Phases),
		TotalFilesDropped:  len(globalLog.FilesDropped),
		TotalProcesses:     len(globalLog.ProcessesExecuted),
		TotalLogMessages:   len(globalLog.Messages),
	}

	// Count successful/failed phases
	for _, phase := range globalLog.Phases {
		if phase.Status == "success" {
			metrics.SuccessfulPhases++
		} else if phase.Status == "failed" || phase.Status == "blocked" {
			metrics.FailedPhases++
		}
	}

	// Count quarantined files
	for _, file := range globalLog.FilesDropped {
		if file.Quarantined {
			metrics.FilesQuarantined++
		}
	}

	// Count successful processes
	for _, proc := range globalLog.ProcessesExecuted {
		if proc.Success {
			metrics.SuccessfulProcesses++
		}
	}

	// Count errors and criticals
	for _, msg := range globalLog.Messages {
		if msg.Level == "ERROR" {
			metrics.ErrorCount++
		} else if msg.Level == "CRITICAL" {
			metrics.CriticalCount++
		}
	}

	return metrics
}

// ==============================================================================
// ELASTICSEARCH EXPORT FUNCTIONS (v2.1)
// ==============================================================================

// ES configuration is set via es_config.go which is generated by build_all.sh
// When building with --es flag, the script generates es_config.go with actual values
// When building without --es flag, the script generates es_config.go with disabled values
//
// The es_config.go file defines these constants:
//   const ES_ENABLED = true/false
//   const ES_ENDPOINT = "..."
//   const ES_INDEX = "..."
//   const ES_APIKEY = "..."
//
// This file (test_logger.go) uses those constants in exportToElasticsearch()

// exportToElasticsearch attempts to send test results directly to Elasticsearch
// Returns ExportStatus for audit trail; nil if ES is not enabled
func exportToElasticsearch(log *TestLog) *ExportStatus {
	// Check if ES export is enabled (build-time constant from es_config.go)
	if !ES_ENABLED || ES_ENDPOINT == "" {
		return nil // ES not configured, no export attempted
	}

	status := &ExportStatus{
		Attempted:     true,
		Timestamp:     time.Now().UTC().Format(time.RFC3339),
		Endpoint:      ES_ENDPOINT,
		RetryEligible: true,
	}

	// Generate unique document ID
	docID := generateESDocumentID(log)
	status.DocumentID = docID

	// Build index name with date suffix (e.g., f0-test-results-2025.11.28)
	indexName := fmt.Sprintf("%s-%s", ES_INDEX, time.Now().UTC().Format("2006.01.02"))
	status.Index = indexName

	// Prepare enriched document for ES
	doc := enrichForElasticsearch(log)
	jsonData, err := json.Marshal(doc)
	if err != nil {
		status.Success = false
		status.Error = fmt.Sprintf("marshal error: %v", err)
		return status
	}

	// Build ES URL: PUT /{index}/_doc/{id}
	url := fmt.Sprintf("%s/%s/_doc/%s", ES_ENDPOINT, indexName, docID)

	// Create HTTP request
	req, err := http.NewRequest("PUT", url, bytes.NewReader(jsonData))
	if err != nil {
		status.Success = false
		status.Error = fmt.Sprintf("request creation error: %v", err)
		return status
	}

	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "ApiKey "+ES_APIKEY)

	// Send request with timeout
	client := &http.Client{Timeout: 30 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		status.Success = false
		status.Error = fmt.Sprintf("connection error: %v", err)
		return status
	}
	defer resp.Body.Close()

	// Check response status
	if resp.StatusCode >= 200 && resp.StatusCode < 300 {
		status.Success = true
		status.RetryEligible = false // Successfully exported, no retry needed
	} else {
		status.Success = false
		status.Error = fmt.Sprintf("ES returned HTTP %d", resp.StatusCode)
		// 4xx errors (except 429) are not retryable
		if resp.StatusCode >= 400 && resp.StatusCode < 500 && resp.StatusCode != 429 {
			status.RetryEligible = false
		}
	}

	return status
}

// generateESDocumentID creates a unique, deterministic document ID
// Uses hash of testId + executionId + startTime for idempotency
func generateESDocumentID(log *TestLog) string {
	data := fmt.Sprintf("%s-%s-%s",
		log.TestID,
		log.ExecutionContext.ExecutionID,
		log.StartTime.Format(time.RFC3339))
	hash := sha256.Sum256([]byte(data))
	return fmt.Sprintf("%x", hash[:16]) // First 16 bytes = 32 hex chars
}

// enrichForElasticsearch adds @timestamp and collection metadata for Kibana
func enrichForElasticsearch(log *TestLog) map[string]interface{} {
	// Convert TestLog to map for enrichment
	data, _ := json.Marshal(log)
	var enriched map[string]interface{}
	json.Unmarshal(data, &enriched)

	// Add @timestamp for Kibana (uses test start time)
	enriched["@timestamp"] = log.StartTime.Format(time.RFC3339)

	// Add collection metadata
	hostname, _ := os.Hostname()
	enriched["collectionMetadata"] = map[string]interface{}{
		"exportedAt":   time.Now().UTC().Format(time.RFC3339),
		"exportMethod": "direct", // vs "collector" for f0_collector
		"sourceHost":   hostname,
	}

	return enriched
}

// persistLog writes log to disk (assumes lock is held)
func persistLog() error {
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

	// Only print confirmation if main orchestrator (not stage)
	if !isStage {
		fmt.Printf("\n[*] ========================================\n")
		fmt.Printf("[*] Execution logs saved (Schema v%s):\n", SCHEMA_VERSION)
		fmt.Printf("[*]   JSON: %s\n", jsonPath)
		fmt.Printf("[*]   TEXT: %s\n", txtPath)
		fmt.Printf("[*] ========================================\n\n")
	}

	return nil
}

// formatTextLog creates human-readable text log
func formatTextLog(log *TestLog) string {
	var out strings.Builder

	out.WriteString(strings.Repeat("=", 80) + "\n")
	out.WriteString("F0RT1KA SECURITY TEST - EXECUTION LOG\n")
	out.WriteString(fmt.Sprintf("Schema Version: %s\n", log.SchemaVersion))
	out.WriteString(strings.Repeat("=", 80) + "\n\n")

	// Test information
	out.WriteString(fmt.Sprintf("Test ID:      %s\n", log.TestID))
	out.WriteString(fmt.Sprintf("Test Name:    %s\n", log.TestName))
	out.WriteString(fmt.Sprintf("Version:      %s\n", log.TestMetadata.Version))
	out.WriteString(fmt.Sprintf("Category:     %s\n", log.TestMetadata.Category))
	out.WriteString(fmt.Sprintf("Severity:     %s\n", log.TestMetadata.Severity))
	out.WriteString(fmt.Sprintf("Techniques:   %s\n", strings.Join(log.TestMetadata.Techniques, ", ")))
	out.WriteString(fmt.Sprintf("Tactics:      %s\n", strings.Join(log.TestMetadata.Tactics, ", ")))
	if log.TestMetadata.Score > 0 {
		out.WriteString(fmt.Sprintf("Test Score:   %.1f/10\n", log.TestMetadata.Score))
	}
	out.WriteString(fmt.Sprintf("Multi-Stage:  %v\n\n", log.IsMultiStage))

	// Execution context
	out.WriteString("EXECUTION CONTEXT\n")
	out.WriteString(strings.Repeat("-", 80) + "\n")
	out.WriteString(fmt.Sprintf("Execution ID:  %s\n", log.ExecutionContext.ExecutionID))
	if log.ExecutionContext.BatchID != "" {
		out.WriteString(fmt.Sprintf("Batch ID:      %s\n", log.ExecutionContext.BatchID))
	}
	out.WriteString(fmt.Sprintf("Organization:  %s\n", log.ExecutionContext.Organization))
	out.WriteString(fmt.Sprintf("Environment:   %s\n", log.ExecutionContext.Environment))
	if log.ExecutionContext.TriggeredBy != "" {
		out.WriteString(fmt.Sprintf("Triggered By:  %s\n", log.ExecutionContext.TriggeredBy))
	}
	out.WriteString("\n")

	// Timing
	out.WriteString("EXECUTION TIMING\n")
	out.WriteString(strings.Repeat("-", 80) + "\n")
	out.WriteString(fmt.Sprintf("Start Time:   %s\n", log.StartTime.Format("2006-01-02 15:04:05.000 UTC")))
	out.WriteString(fmt.Sprintf("End Time:     %s\n", log.EndTime.Format("2006-01-02 15:04:05.000 UTC")))
	out.WriteString(fmt.Sprintf("Duration:     %d ms (%.2f seconds)\n\n", log.DurationMs, float64(log.DurationMs)/1000))

	// Outcome
	out.WriteString("TEST OUTCOME\n")
	out.WriteString(strings.Repeat("-", 80) + "\n")
	out.WriteString(fmt.Sprintf("Exit Code:    %d\n", log.ExitCode))
	out.WriteString(fmt.Sprintf("Exit Reason:  %s\n", log.ExitReason))
	out.WriteString(fmt.Sprintf("Protected:    %v\n", log.Outcome.Protected))
	out.WriteString(fmt.Sprintf("Category:     %s\n", log.Outcome.Category))
	if log.Outcome.DetectionPhase != nil {
		out.WriteString(fmt.Sprintf("Detection:    %s\n", *log.Outcome.DetectionPhase))
	}
	if len(log.Outcome.BlockedTechniques) > 0 {
		out.WriteString(fmt.Sprintf("Blocked:      %s\n", strings.Join(log.Outcome.BlockedTechniques, ", ")))
	}
	if len(log.Outcome.SuccessfulTechniques) > 0 {
		out.WriteString(fmt.Sprintf("Successful:   %s\n", strings.Join(log.Outcome.SuccessfulTechniques, ", ")))
	}
	out.WriteString("\n")

	// Multi-stage information
	if log.IsMultiStage && len(log.Stages) > 0 {
		out.WriteString("STAGE EXECUTION SUMMARY\n")
		out.WriteString(strings.Repeat("-", 80) + "\n")
		out.WriteString(fmt.Sprintf("Total Stages: %d\n", len(log.Stages)))
		if log.BlockedAtStage > 0 {
			out.WriteString(fmt.Sprintf("Blocked At:   Stage %d (%s)\n", log.BlockedAtStage, log.BlockedTechnique))
		}
		out.WriteString("\nStage Details:\n")
		for _, stage := range log.Stages {
			out.WriteString(fmt.Sprintf("\nStage %d: %s (%s)\n", stage.StageID, stage.Name, stage.Technique))
			out.WriteString(fmt.Sprintf("  Status:    %s\n", stage.Status))
			out.WriteString(fmt.Sprintf("  Duration:  %d ms\n", stage.DurationMs))
			out.WriteString(fmt.Sprintf("  Exit Code: %d\n", stage.ExitCode))
			if stage.BlockedBy != "" {
				out.WriteString(fmt.Sprintf("  Blocked:   %s\n", stage.BlockedBy))
			}
			if stage.ErrorMessage != "" {
				out.WriteString(fmt.Sprintf("  Error:     %s\n", stage.ErrorMessage))
			}
		}
		out.WriteString("\n")
	}

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

	// Metrics summary
	if log.Metrics != nil {
		out.WriteString("METRICS SUMMARY\n")
		out.WriteString(strings.Repeat("-", 80) + "\n")
		out.WriteString(fmt.Sprintf("Phases:       %d total, %d successful, %d failed\n",
			log.Metrics.TotalPhases, log.Metrics.SuccessfulPhases, log.Metrics.FailedPhases))
		out.WriteString(fmt.Sprintf("Files:        %d dropped, %d quarantined\n",
			log.Metrics.TotalFilesDropped, log.Metrics.FilesQuarantined))
		out.WriteString(fmt.Sprintf("Processes:    %d total, %d successful\n",
			log.Metrics.TotalProcesses, log.Metrics.SuccessfulProcesses))
		out.WriteString(fmt.Sprintf("Messages:     %d total (%d errors, %d critical)\n\n",
			log.Metrics.TotalLogMessages, log.Metrics.ErrorCount, log.Metrics.CriticalCount))
	}

	// Phase execution
	if len(log.Phases) > 0 {
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
		out.WriteString("\n")
	}

	// Files dropped
	if len(log.FilesDropped) > 0 {
		out.WriteString("FILES DROPPED\n")
		out.WriteString(strings.Repeat("-", 80) + "\n")
		for i, file := range log.FilesDropped {
			status := "OK"
			if file.Quarantined {
				status = "QUARANTINED"
			}
			out.WriteString(fmt.Sprintf("%d. %s [%s]\n", i+1, file.Filename, status))
			out.WriteString(fmt.Sprintf("   Path: %s\n", file.Path))
			out.WriteString(fmt.Sprintf("   Size: %d bytes\n", file.Size))
			if file.FileType != "" {
				out.WriteString(fmt.Sprintf("   Type: %s\n", file.FileType))
			}
		}
		out.WriteString("\n")
	}

	// Processes executed
	if len(log.ProcessesExecuted) > 0 {
		out.WriteString("PROCESSES EXECUTED\n")
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
		out.WriteString("\n")
	}

	// Detailed message log
	out.WriteString("DETAILED MESSAGE LOG\n")
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

// ==============================================================================
// HELPER FUNCTIONS
// ==============================================================================

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
		EDRProducts:     []EDRProduct{},
	}

	if info.MDEInstalled {
		info.MDEVersion = getMDEVersion()
		// Add MDE to EDR products list
		info.EDRProducts = append(info.EDRProducts, EDRProduct{
			Name:    "Microsoft Defender for Endpoint",
			Version: info.MDEVersion,
			Running: info.DefenderRunning,
		})
	}

	return info
}

func getOSVersion() string {
	cmd := exec.Command("cmd", "/C", "ver")
	output, err := cmd.Output()
	if err != nil {
		return "Unknown"
	}
	return strings.TrimSpace(string(output))
}

func getArchitecture() string {
	arch := os.Getenv("PROCESSOR_ARCHITECTURE")
	if arch != "" {
		return arch
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

// ==============================================================================
// BACKWARDS COMPATIBILITY STUBS
// ==============================================================================

// MDEIdentifiers stub for compatibility with existing tests
type MDEIdentifiers struct {
	Source            string
	MDEInstalled      bool
	ExtractionSuccess bool
	MachineID         string
	TenantID          string
	SenseID           string
	OrgID             string
}

// BypassResult stub for compatibility with existing tests
type BypassResult struct {
	Success      bool
	Blocked      bool
	BlockedBy    string
	TestDuration time.Duration
}
