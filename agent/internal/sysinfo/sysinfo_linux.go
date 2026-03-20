//go:build linux

package sysinfo

import (
	"os"
	"strconv"
	"strings"
	"syscall"
	"time"
)

// Collect gathers system metrics on Linux.
func Collect() Info {
	var info Info

	// Uptime and memory via syscall.Sysinfo.
	var si syscall.Sysinfo_t
	if err := syscall.Sysinfo(&si); err == nil {
		info.UptimeSeconds = si.Uptime
		usedBytes := si.Totalram - si.Freeram - si.Bufferram
		info.MemoryMB = int(usedBytes * uint64(si.Unit) / (1024 * 1024))
	}

	// CPU usage: sample /proc/stat twice ~200ms apart.
	// Process CPU: sample /proc/self/stat in the same window.
	idle0, total0 := readCPUStat()
	pUtime0, pStime0 := readProcessCPUStat()
	wallStart := time.Now()

	time.Sleep(200 * time.Millisecond)

	idle1, total1 := readCPUStat()
	pUtime1, pStime1 := readProcessCPUStat()
	wallElapsed := time.Since(wallStart)

	idleDelta := idle1 - idle0
	totalDelta := total1 - total0
	if totalDelta > 0 {
		info.CPUPercent = int(((totalDelta - idleDelta) * 100) / totalDelta)
		if info.CPUPercent < 0 {
			info.CPUPercent = 0
		}
		if info.CPUPercent > 100 {
			info.CPUPercent = 100
		}
	}

	// Process CPU: delta ticks / wall-clock ticks. USER_HZ is 100 on Linux.
	const userHZ = 100
	pTicksDelta := (pUtime1 + pStime1) - (pUtime0 + pStime0)
	wallTicks := uint64(wallElapsed.Seconds() * userHZ)
	if wallTicks > 0 {
		info.ProcessCPUPercent = int((pTicksDelta * 100) / wallTicks)
		if info.ProcessCPUPercent < 0 {
			info.ProcessCPUPercent = 0
		}
		if info.ProcessCPUPercent > 100 {
			info.ProcessCPUPercent = 100
		}
	}

	// Process memory from /proc/self/status.
	info.ProcessMemoryMB = readProcessMemoryMB()

	// Disk free on /.
	var stat syscall.Statfs_t
	if err := syscall.Statfs("/", &stat); err == nil {
		info.DiskFreeMB = int(stat.Bavail * uint64(stat.Bsize) / (1024 * 1024))
	}

	return info
}

// readProcessCPUStat reads /proc/self/stat and returns utime and stime
// (fields 14 and 15, 1-indexed) as clock ticks.
func readProcessCPUStat() (utime, stime uint64) {
	data, err := os.ReadFile("/proc/self/stat")
	if err != nil {
		return 0, 0
	}
	// Fields are space-separated, but field 2 (comm) may contain spaces
	// and is wrapped in parens. Find the closing paren to skip it.
	s := string(data)
	idx := strings.LastIndex(s, ")")
	if idx < 0 || idx+2 >= len(s) {
		return 0, 0
	}
	// Fields after comm start at index 3 (state). utime=14, stime=15
	// relative to full line, so after ")" they are at offset 11 and 12
	// (fields 3..N after the closing paren).
	fields := strings.Fields(s[idx+2:])
	if len(fields) < 13 { // need at least fields 3..15 → 13 fields
		return 0, 0
	}
	utime, _ = strconv.ParseUint(fields[11], 10, 64) // field 14
	stime, _ = strconv.ParseUint(fields[12], 10, 64) // field 15
	return utime, stime
}

// readProcessMemoryMB reads VmRSS from /proc/self/status and returns MB.
func readProcessMemoryMB() int {
	data, err := os.ReadFile("/proc/self/status")
	if err != nil {
		return 0
	}
	for _, line := range strings.Split(string(data), "\n") {
		if strings.HasPrefix(line, "VmRSS:") {
			parts := strings.Fields(line)
			if len(parts) >= 2 {
				kb, _ := strconv.ParseUint(parts[1], 10, 64)
				return int(kb / 1024)
			}
		}
	}
	return 0
}

// readCPUStat parses the first "cpu" line from /proc/stat and returns
// idle ticks and total ticks across all cores.
func readCPUStat() (idle, total uint64) {
	data, err := os.ReadFile("/proc/stat")
	if err != nil {
		return 0, 0
	}
	// First line: "cpu  user nice system idle iowait irq softirq steal ..."
	line, _, _ := strings.Cut(string(data), "\n")
	fields := strings.Fields(line)
	if len(fields) < 5 || fields[0] != "cpu" {
		return 0, 0
	}
	var sum uint64
	for i, f := range fields[1:] {
		v, _ := strconv.ParseUint(f, 10, 64)
		sum += v
		if i == 3 { // 4th value (index 3) is idle
			idle = v
		}
	}
	return idle, sum
}
