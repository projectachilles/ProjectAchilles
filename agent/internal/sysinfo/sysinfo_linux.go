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
	idle0, total0 := readCPUStat()
	time.Sleep(200 * time.Millisecond)
	idle1, total1 := readCPUStat()

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

	// Disk free on /.
	var stat syscall.Statfs_t
	if err := syscall.Statfs("/", &stat); err == nil {
		info.DiskFreeMB = int(stat.Bavail * uint64(stat.Bsize) / (1024 * 1024))
	}

	return info
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
