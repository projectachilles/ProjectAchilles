package executor

// Task represents a test execution task received from the server.
type Task struct {
	ID      string      `json:"id"`
	Type    string      `json:"type"`
	Payload TaskPayload `json:"payload"`
}

// TaskPayload contains the details needed to download and execute a test binary,
// or the shell command to run for execute_command tasks.
type TaskPayload struct {
	TestUUID         string            `json:"test_uuid"`
	TestName         string            `json:"test_name"`
	BinaryName       string            `json:"binary_name"`
	BinarySHA256     string            `json:"binary_sha256"`
	BinarySize       int64             `json:"binary_size"`
	ExecutionTimeout int               `json:"execution_timeout"`
	Arguments        []string          `json:"arguments"`
	Command          string            `json:"command"`
	EnvVars          map[string]string `json:"env_vars,omitempty"`
}

// Result captures the outcome of a test binary execution.
type Result struct {
	TaskID              string         `json:"task_id"`
	TestUUID            string         `json:"test_uuid"`
	ExitCode            int            `json:"exit_code"`
	Stdout              string         `json:"stdout"`
	Stderr              string         `json:"stderr"`
	StartedAt           string         `json:"started_at"`
	CompletedAt         string         `json:"completed_at"`
	ExecutionDurationMs int64          `json:"execution_duration_ms"`
	BinarySHA256        string         `json:"binary_sha256"`
	Hostname            string         `json:"hostname"`
	OS                  string         `json:"os"`
	Arch                string         `json:"arch"`
	BundleResults       *BundleResults `json:"bundle_results,omitempty"`
}

// BundleControlResult represents a single control outcome from a cyber-hygiene bundle.
type BundleControlResult struct {
	ControlID    string   `json:"control_id"`
	ControlName  string   `json:"control_name"`
	Validator    string   `json:"validator"`
	ExitCode     int      `json:"exit_code"`
	Compliant    bool     `json:"compliant"`
	Severity     string   `json:"severity"`
	Category     string   `json:"category"`
	Subcategory  string   `json:"subcategory"`
	Techniques   []string `json:"techniques"`
	Tactics      []string `json:"tactics"`
	Expected     string   `json:"expected"`
	Actual       string   `json:"actual"`
	Details      string   `json:"details"`
	Skipped      bool     `json:"skipped"`
	ErrorMessage string   `json:"error_message"`
}

// BundleResults represents the complete output of a cyber-hygiene bundle.
type BundleResults struct {
	SchemaVersion     string                `json:"schema_version"`
	BundleID          string                `json:"bundle_id"`
	BundleName        string                `json:"bundle_name"`
	BundleCategory    string                `json:"bundle_category"`
	BundleSubcategory string                `json:"bundle_subcategory"`
	ExecutionID       string                `json:"execution_id"`
	StartedAt         string                `json:"started_at"`
	CompletedAt       string                `json:"completed_at"`
	OverallExitCode   int                   `json:"overall_exit_code"`
	TotalControls     int                   `json:"total_controls"`
	PassedControls    int                   `json:"passed_controls"`
	FailedControls    int                   `json:"failed_controls"`
	Controls          []BundleControlResult `json:"controls"`
}
