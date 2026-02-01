package enrollment

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"runtime"
	"time"

	"github.com/f0rt1ka/achilles-agent/internal/config"
)

const agentVersion = "0.1.0"

// enrollRequest is the JSON body sent to the enrollment endpoint.
type enrollRequest struct {
	Token        string `json:"token"`
	Hostname     string `json:"hostname"`
	OS           string `json:"os"`
	Arch         string `json:"arch"`
	AgentVersion string `json:"agent_version"`
}

// enrollResponseData holds the fields returned on successful enrollment.
type enrollResponseData struct {
	AgentID      string `json:"agent_id"`
	AgentKey     string `json:"agent_key"`
	OrgID        string `json:"org_id"`
	ServerURL    string `json:"server_url"`
	PollInterval int    `json:"poll_interval"`
}

// enrollResponse is the top-level JSON envelope from the server.
type enrollResponse struct {
	Success bool               `json:"success"`
	Error   string             `json:"error,omitempty"`
	Data    enrollResponseData `json:"data"`
}

// Enroll performs the one-time enrollment handshake with the server.
// It POSTs system information and the enrollment token, then saves the
// returned configuration to configPath.
func Enroll(serverURL, token, configPath string) error {
	hostname, err := os.Hostname()
	if err != nil {
		return fmt.Errorf("get hostname: %w", err)
	}

	reqBody := enrollRequest{
		Token:        token,
		Hostname:     hostname,
		OS:           runtime.GOOS,
		Arch:         runtime.GOARCH,
		AgentVersion: agentVersion,
	}

	bodyBytes, err := json.Marshal(reqBody)
	if err != nil {
		return fmt.Errorf("marshal enrollment request: %w", err)
	}

	url := serverURL + "/api/agent/enroll"
	resp, err := http.Post(url, "application/json", bytes.NewReader(bodyBytes))
	if err != nil {
		return fmt.Errorf("network error contacting %s: %w", url, err)
	}
	defer resp.Body.Close()

	respBytes, err := io.ReadAll(resp.Body)
	if err != nil {
		return fmt.Errorf("read response body: %w", err)
	}

	switch resp.StatusCode {
	case http.StatusOK, http.StatusCreated:
		// success, continue below
	case http.StatusUnauthorized:
		return fmt.Errorf("enrollment failed: invalid token (HTTP 401)")
	case http.StatusGone:
		return fmt.Errorf("enrollment failed: token expired or already used (HTTP 410)")
	default:
		return fmt.Errorf("enrollment failed: server returned HTTP %d: %s", resp.StatusCode, string(respBytes))
	}

	var enrollResp enrollResponse
	if err := json.Unmarshal(respBytes, &enrollResp); err != nil {
		return fmt.Errorf("parse enrollment response: %w", err)
	}

	if !enrollResp.Success {
		return fmt.Errorf("enrollment failed: %s", enrollResp.Error)
	}

	data := enrollResp.Data

	cfg := config.DefaultConfig()
	cfg.AgentID = data.AgentID
	cfg.AgentKey = data.AgentKey
	cfg.OrgID = data.OrgID
	cfg.ServerURL = data.ServerURL
	if data.PollInterval > 0 {
		cfg.PollInterval = time.Duration(data.PollInterval) * time.Second
	}

	if err := cfg.Save(configPath); err != nil {
		return fmt.Errorf("save config: %w", err)
	}

	fmt.Printf("Enrolled successfully. Agent ID: %s\n", data.AgentID)
	return nil
}
