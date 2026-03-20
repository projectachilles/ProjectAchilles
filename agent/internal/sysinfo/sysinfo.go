// Package sysinfo collects basic system metrics for heartbeat reporting.
package sysinfo

// Info holds system metrics collected from the host.
type Info struct {
	UptimeSeconds     int64
	CPUPercent        int
	MemoryMB          int
	DiskFreeMB        int
	ProcessCPUPercent int // agent process CPU usage (0-100)
	ProcessMemoryMB   int // agent process RSS in MB
}

// Collect gathers system metrics. Implemented per-platform.
// The CPU measurement takes ~200ms due to sampling two snapshots.
