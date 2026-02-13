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
func Enroll(serverURL, token, configPath, version string) error {
	// Validate server URL before sending credentials over the wire.
	if err := config.ValidateServerURL(serverURL); err != nil {
		return fmt.Errorf("refusing to enroll: %w", err)
	}

	hostname, err := os.Hostname()
	if err != nil {
		return fmt.Errorf("get hostname: %w", err)
	}

	reqBody := enrollRequest{
		Token:        token,
		Hostname:     hostname,
		OS:           runtime.GOOS,
		Arch:         runtime.GOARCH,
		AgentVersion: version,
	}

	bodyBytes, err := json.Marshal(reqBody)
	if err != nil {
		return fmt.Errorf("marshal enrollment request: %w", err)
	}

	// Use an http.Client with redirect downgrade protection instead of
	// the bare http.Post, which follows redirects blindly.
	client := &http.Client{
		Timeout:       30 * time.Second,
		CheckRedirect: checkRedirectDowngrade,
	}

	enrollURL := serverURL + "/api/agent/enroll"
	resp, err := client.Post(enrollURL, "application/json", bytes.NewReader(bodyBytes))
	if err != nil {
		return fmt.Errorf("network error contacting %s: %w", enrollURL, err)
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

	// Validate the server-returned URL before saving it — a misconfigured
	// backend could hand back http:// even when we connected via https://.
	if err := config.ValidateServerURL(data.ServerURL); err != nil {
		return fmt.Errorf("server returned insecure URL: %w", err)
	}

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

// checkRedirectDowngrade blocks HTTPS→HTTP redirect downgrades. It is used as
// an http.Client.CheckRedirect handler.
func checkRedirectDowngrade(req *http.Request, via []*http.Request) error {
	if len(via) >= 10 {
		return fmt.Errorf("too many redirects")
	}
	if len(via) > 0 && via[len(via)-1].URL.Scheme == "https" && req.URL.Scheme == "http" {
		return fmt.Errorf("refusing redirect from %s to %s: HTTPS to HTTP downgrade", via[len(via)-1].URL, req.URL)
	}
	return nil
}
