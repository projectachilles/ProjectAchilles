//go:build darwin

package sysinfo

import (
	"encoding/binary"
	"os/exec"
	"runtime"
	"strconv"
	"strings"
	"syscall"
	"time"
	"unsafe"
)

// Collect gathers system metrics on macOS.
func Collect() Info {
	var info Info

	// Uptime via sysctl kern.boottime → timeval struct.
	info.UptimeSeconds = getUptime()

	// CPU usage: approximate from load average scaled by CPU count.
	info.CPUPercent = getCPUPercent()

	// Memory: hw.memsize for total, vm_stat for usage.
	info.MemoryMB = getMemoryMB()

	// Disk free on /.
	var stat syscall.Statfs_t
	if err := syscall.Statfs("/", &stat); err == nil {
		info.DiskFreeMB = int(stat.Bavail * uint64(stat.Bsize) / (1024 * 1024))
	}

	return info
}

// getUptime reads kern.boottime via sysctl and computes seconds since boot.
func getUptime() int64 {
	raw, err := syscall.Sysctl("kern.boottime")
	if err != nil || len(raw) < int(unsafe.Sizeof(syscall.Timeval{})) {
		return 0
	}
	// kern.boottime is a timeval: {sec int64, usec int32} on darwin/amd64
	// and {sec int64, usec int32} on darwin/arm64.
	// Parse the seconds field (first 8 bytes, little-endian on both archs).
	tv_sec := int64(binary.LittleEndian.Uint64([]byte(raw[:8])))
	return time.Now().Unix() - tv_sec
}

// getCPUPercent approximates CPU usage from the 1-minute load average
// scaled to the number of logical CPUs. This avoids CGO and /proc.
func getCPUPercent() int {
	out, err := exec.Command("sysctl", "-n", "vm.loadavg").Output()
	if err != nil {
		return 0
	}

	// Output format: "{ 1.23 4.56 7.89 }"
	s := strings.Trim(strings.TrimSpace(string(out)), "{}")
	fields := strings.Fields(s)
	if len(fields) < 1 {
		return 0
	}

	load1, err := strconv.ParseFloat(fields[0], 64)
	if err != nil {
		return 0
	}

	numCPU := runtime.NumCPU()
	if numCPU < 1 {
		numCPU = 1
	}

	pct := int((load1 / float64(numCPU)) * 100)
	if pct < 0 {
		pct = 0
	}
	if pct > 100 {
		pct = 100
	}
	return pct
}

// getMemoryMB computes used memory in MB from hw.memsize and vm_stat output.
func getMemoryMB() int {
	// Total physical memory via sysctl.
	out, err := exec.Command("sysctl", "-n", "hw.memsize").Output()
	if err != nil {
		return 0
	}
	totalBytes, err := strconv.ParseUint(strings.TrimSpace(string(out)), 10, 64)
	if err != nil {
		return 0
	}

	// Parse vm_stat for free + inactive pages.
	vmOut, err := exec.Command("vm_stat").Output()
	if err != nil {
		return int(totalBytes / (1024 * 1024)) // fallback: report total
	}

	pageSize := uint64(4096) // default macOS page size
	var free, inactive uint64

	for _, line := range strings.Split(string(vmOut), "\n") {
		if strings.HasPrefix(line, "Mach Virtual Memory Statistics") {
			// Parse page size from header: "...page size of 16384 bytes)"
			if idx := strings.Index(line, "page size of "); idx >= 0 {
				sizeStr := strings.Fields(line[idx+len("page size of "):])[0]
				if ps, err := strconv.ParseUint(sizeStr, 10, 64); err == nil {
					pageSize = ps
				}
			}
			continue
		}
		if strings.HasPrefix(line, "Pages free:") {
			free = parseVmStatValue(line)
		} else if strings.HasPrefix(line, "Pages inactive:") {
			inactive = parseVmStatValue(line)
		}
	}

	freeBytes := (free + inactive) * pageSize
	if freeBytes > totalBytes {
		return 0
	}
	usedBytes := totalBytes - freeBytes
	return int(usedBytes / (1024 * 1024))
}

// parseVmStatValue extracts the numeric page count from a vm_stat line like
// "Pages free:     12345."
func parseVmStatValue(line string) uint64 {
	parts := strings.SplitN(line, ":", 2)
	if len(parts) < 2 {
		return 0
	}
	s := strings.TrimSpace(parts[1])
	s = strings.TrimSuffix(s, ".")
	v, _ := strconv.ParseUint(s, 10, 64)
	return v
}
