// fake_mssense.go - Simulates legitimate MsSense.exe behavior for testing
// Build: go build -o fake_mssense.exe fake_mssense.go

package main

import (
	"encoding/json"
	"fmt"
	"os"
	"time"
)

type SensorData struct {
	ProcessName   string    `json:"processName"`
	MachineID     string    `json:"machineId"`
	TenantID      string    `json:"tenantId"`
	Version       string    `json:"version"`
	LastHeartbeat time.Time `json:"lastHeartbeat"`
	Status        string    `json:"status"`
}

func main() {
	// Simulate MsSense.exe startup
	fmt.Println("Microsoft Defender for Endpoint Sensor Service")
	fmt.Println("Version: 10.8040.19042.1234")
	fmt.Println("Initializing...")

	// Create fake sensor data
	sensor := SensorData{
		ProcessName:   "MsSense.exe",
		MachineID:     "FAKE-MACHINE-ID-123456",
		TenantID:      "FAKE-TENANT-ID-789012",
		Version:       "10.8040.19042.1234",
		LastHeartbeat: time.Now(),
		Status:        "Running",
	}

	// Write sensor status to file
	statusFile := "C:\\F0\\fake_mssense_status.json"
	data, _ := json.MarshalIndent(sensor, "", "  ")
	os.WriteFile(statusFile, data, 0644)

	// Simulate cloud communication attempts
	fmt.Println("Attempting to connect to MDE cloud services...")
	time.Sleep(2 * time.Second)

	// Simulate certificate pinning bypass
	fmt.Println("Certificate validation: BYPASSED (simulated)")

	// Keep running for a short period
	for i := 0; i < 5; i++ {
		time.Sleep(1 * time.Second)
		fmt.Printf("Heartbeat %d: Active\n", i+1)
	}

	fmt.Println("Simulation complete")
}