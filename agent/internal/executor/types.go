package executor

// Task represents a test execution task received from the server.
type Task struct {
	ID      string      `json:"id"`
	Type    string      `json:"type"`
	Payload TaskPayload `json:"payload"`
}

// TaskPayload contains the details needed to download and execute a test binary.
type TaskPayload struct {
	TestUUID         string   `json:"test_uuid"`
	TestName         string   `json:"test_name"`
	BinaryName       string   `json:"binary_name"`
	BinarySHA256     string   `json:"binary_sha256"`
	BinarySize       int64    `json:"binary_size"`
	ExecutionTimeout int      `json:"execution_timeout"`
	Arguments        []string `json:"arguments"`
}

// Result captures the outcome of a test binary execution.
type Result struct {
	TaskID              string `json:"task_id"`
	TestUUID            string `json:"test_uuid"`
	ExitCode            int    `json:"exit_code"`
	Stdout              string `json:"stdout"`
	Stderr              string `json:"stderr"`
	StartedAt           string `json:"started_at"`
	CompletedAt         string `json:"completed_at"`
	ExecutionDurationMs int64  `json:"execution_duration_ms"`
	BinarySHA256        string `json:"binary_sha256"`
	Hostname            string `json:"hostname"`
	OS                  string `json:"os"`
	Arch                string `json:"arch"`
}
