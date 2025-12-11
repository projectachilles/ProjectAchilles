package main

// Organization Registry Helper for F0RT1KA Tests
//
// This file provides helper functions to resolve organization identifiers
// from the organization registry. Include this in your test alongside test_logger.go
//
// Usage in test code:
//   orgInfo := ResolveOrganization("sb")  // or UUID
//   executionContext := ExecutionContext{
//       ExecutionID:            uuid.New().String(),
//       Organization:           orgInfo.UUID,
//       OrganizationShortName:  orgInfo.ShortName,
//       OrganizationFullName:   orgInfo.FullName,
//       Environment:            "lab",
//   }

import (
	"encoding/json"
	"os"
	"path/filepath"
	"regexp"
	"strings"
)

// OrganizationInfo contains details about an organization
type OrganizationInfo struct {
	UUID            string `json:"uuid"`
	ShortName       string `json:"shortName"`
	FullName        string `json:"fullName"`
	CertificateFile string `json:"certificateFile"`
	Enabled         bool   `json:"enabled"`
}

// OrganizationRegistry represents the registry file structure
type OrganizationRegistry struct {
	Version             string             `json:"version"`
	DefaultOrganization string             `json:"defaultOrganization"`
	AutoDetectSingleOrg bool               `json:"autoDetectSingleOrg"`
	Organizations       []OrganizationInfo `json:"organizations"`
}

// Registry cache
var (
	cachedRegistry *OrganizationRegistry
	registryLoaded bool
)

// loadRegistry loads the organization registry from the standard location
func loadRegistry() (*OrganizationRegistry, error) {
	if registryLoaded && cachedRegistry != nil {
		return cachedRegistry, nil
	}

	// Try multiple potential locations for the registry file
	registryPaths := []string{
		"c:\\F0\\organization-registry.json",                     // Runtime location (Windows)
		"/etc/f0rt1ka/organization-registry.json",               // Runtime location (Linux)
		"../../signing-certs/organization-registry.json",        // Build time (from test dir)
		"../signing-certs/organization-registry.json",           // Build time (from sample_tests)
		"signing-certs/organization-registry.json",              // Build time (from root)
	}

	var registryData []byte
	var err error

	for _, path := range registryPaths {
		registryData, err = os.ReadFile(path)
		if err == nil {
			break
		}
	}

	if err != nil {
		// Registry not found - return error for caller to handle
		return nil, err
	}

	var registry OrganizationRegistry
	if err := json.Unmarshal(registryData, &registry); err != nil {
		return nil, err
	}

	// Cache the registry
	cachedRegistry = &registry
	registryLoaded = true

	// Optional: log registry loaded (comment out for production)
	// fmt.Printf("Loaded organization registry successfully\n")

	return &registry, nil
}

// isValidUUID checks if a string is a valid UUID format
func isValidUUID(s string) bool {
	uuidPattern := regexp.MustCompile(`^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$`)
	return uuidPattern.MatchString(strings.ToLower(s))
}

// findOrganizationByUUID finds an organization by UUID
func findOrganizationByUUID(registry *OrganizationRegistry, uuid string) *OrganizationInfo {
	for _, org := range registry.Organizations {
		if strings.EqualFold(org.UUID, uuid) && org.Enabled {
			return &org
		}
	}
	return nil
}

// findOrganizationByShortName finds an organization by short name
func findOrganizationByShortName(registry *OrganizationRegistry, shortName string) *OrganizationInfo {
	for _, org := range registry.Organizations {
		if strings.EqualFold(org.ShortName, shortName) && org.Enabled {
			return &org
		}
	}
	return nil
}

// getDefaultOrganization returns the default organization from the registry
func getDefaultOrganization(registry *OrganizationRegistry) *OrganizationInfo {
	// Check if auto-detect single org is enabled
	if registry.AutoDetectSingleOrg {
		enabledOrgs := make([]OrganizationInfo, 0)
		for _, org := range registry.Organizations {
			if org.Enabled {
				enabledOrgs = append(enabledOrgs, org)
			}
		}

		if len(enabledOrgs) == 1 {
			return &enabledOrgs[0]
		}
	}

	// Return default organization if set
	if registry.DefaultOrganization != "" {
		return findOrganizationByShortName(registry, registry.DefaultOrganization)
	}

	// Return first enabled organization marked as default
	for _, org := range registry.Organizations {
		if org.Enabled {
			// Check if this is the default org (we'd need to add a Default field to OrganizationInfo)
			// For now, just return the first enabled org
			return &org
		}
	}

	return nil
}

// ResolveOrganization resolves an organization identifier (UUID or short name) to full organization info
//
// Parameters:
//   - orgIdentifier: UUID, short name, or empty string (uses default)
//
// Returns:
//   - OrganizationInfo with resolved details
//   - If registry not found or identifier invalid, returns a fallback with the identifier as-is
func ResolveOrganization(orgIdentifier string) OrganizationInfo {
	// Try to load registry
	registry, err := loadRegistry()

	// If registry not available, return fallback with identifier as-is
	if err != nil {
		return OrganizationInfo{
			UUID:      orgIdentifier,
			ShortName: orgIdentifier,
			FullName:  orgIdentifier,
			Enabled:   true,
		}
	}

	// If empty identifier, use default
	if orgIdentifier == "" {
		defaultOrg := getDefaultOrganization(registry)
		if defaultOrg != nil {
			return *defaultOrg
		}
		// No default available, return empty fallback
		return OrganizationInfo{
			UUID:      "unknown",
			ShortName: "unknown",
			FullName:  "Unknown Organization",
			Enabled:   true,
		}
	}

	// Check if identifier is a UUID
	if isValidUUID(orgIdentifier) {
		org := findOrganizationByUUID(registry, orgIdentifier)
		if org != nil {
			return *org
		}
		// UUID not found, return as-is
		return OrganizationInfo{
			UUID:      orgIdentifier,
			ShortName: "unknown",
			FullName:  "Unknown Organization",
			Enabled:   true,
		}
	}

	// Try to find by short name
	org := findOrganizationByShortName(registry, orgIdentifier)
	if org != nil {
		return *org
	}

	// Not found, return as-is
	return OrganizationInfo{
		UUID:      orgIdentifier,
		ShortName: orgIdentifier,
		FullName:  orgIdentifier,
		Enabled:   true,
	}
}

// GetCertificatePathForOrg returns the certificate file path for a given organization
// This can be used by cert_installer logic if needed
func GetCertificatePathForOrg(orgIdentifier string) string {
	orgInfo := ResolveOrganization(orgIdentifier)

	if orgInfo.CertificateFile != "" {
		// Check common certificate locations
		certPaths := []string{
			filepath.Join("c:\\F0", orgInfo.CertificateFile),
			filepath.Join("signing-certs", orgInfo.CertificateFile),
			filepath.Join("..", "..", "signing-certs", orgInfo.CertificateFile),
		}

		for _, path := range certPaths {
			if _, err := os.Stat(path); err == nil {
				return path
			}
		}

		// Return the filename even if file doesn't exist
		return orgInfo.CertificateFile
	}

	return ""
}

// Example usage (commented out for production):
// func main() {
// 	// Example 1: Resolve by short name
// 	orgInfo := ResolveOrganization("sb")
// 	fmt.Printf("UUID: %s, Short: %s, Full: %s\n", orgInfo.UUID, orgInfo.ShortName, orgInfo.FullName)
//
// 	// Example 2: Resolve by UUID
// 	orgInfo2 := ResolveOrganization("09b59276-9efb-4d3d-bbdd-4b4663ef0c42")
// 	fmt.Printf("UUID: %s, Short: %s, Full: %s\n", orgInfo2.UUID, orgInfo2.ShortName, orgInfo2.FullName)
//
// 	// Example 3: Use default (empty string)
// 	orgInfo3 := ResolveOrganization("")
// 	fmt.Printf("UUID: %s, Short: %s, Full: %s\n", orgInfo3.UUID, orgInfo3.ShortName, orgInfo3.FullName)
// }
