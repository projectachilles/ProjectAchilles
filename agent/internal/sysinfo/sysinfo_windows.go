//go:build windows

package sysinfo

import (
	"time"
	"unsafe"

	"golang.org/x/sys/windows"
)

var (
	modkernel32                = windows.NewLazySystemDLL("kernel32.dll")
	procGetSystemTimes         = modkernel32.NewProc("GetSystemTimes")
	procGetTickCount64         = modkernel32.NewProc("GetTickCount64")
	procGlobalMemoryStatusEx   = modkernel32.NewProc("GlobalMemoryStatusEx")
	procK32GetProcessMemoryInfo = modkernel32.NewProc("K32GetProcessMemoryInfo")
)

// processMemoryCounters corresponds to PROCESS_MEMORY_COUNTERS from psapi.h.
type processMemoryCounters struct {
	CB                         uint32
	PageFaultCount             uint32
	PeakWorkingSetSize         uintptr
	WorkingSetSize             uintptr
	QuotaPeakPagedPoolUsage    uintptr
	QuotaPagedPoolUsage        uintptr
	QuotaPeakNonPagedPoolUsage uintptr
	QuotaNonPagedPoolUsage     uintptr
	PagefileUsage              uintptr
	PeakPagefileUsage          uintptr
}

type memoryStatusEx struct {
	Length               uint32
	MemoryLoad           uint32
	TotalPhys            uint64
	AvailPhys            uint64
	TotalPageFile        uint64
	AvailPageFile        uint64
	TotalVirtual         uint64
	AvailVirtual         uint64
	AvailExtendedVirtual uint64
}

// Collect gathers system metrics on Windows.
func Collect() Info {
	var info Info

	// Uptime via GetTickCount64 (milliseconds since boot).
	ret, _, _ := procGetTickCount64.Call()
	info.UptimeSeconds = int64(ret) / 1000

	// CPU usage: sample GetSystemTimes twice ~200ms apart.
	// Process CPU: sample GetProcessTimes in the same window.
	idle0, kernel0, user0 := getSystemTimes()
	pKernel0, pUser0 := getProcessTimes()
	wallStart := time.Now()

	time.Sleep(200 * time.Millisecond)

	idle1, kernel1, user1 := getSystemTimes()
	pKernel1, pUser1 := getProcessTimes()
	wallElapsed := time.Since(wallStart)

	idleDelta := idle1 - idle0
	totalDelta := (kernel1 - kernel0) + (user1 - user0)
	if totalDelta > 0 {
		busyDelta := totalDelta - idleDelta
		info.CPUPercent = int((busyDelta * 100) / totalDelta)
		if info.CPUPercent < 0 {
			info.CPUPercent = 0
		}
		if info.CPUPercent > 100 {
			info.CPUPercent = 100
		}
	}

	// Process CPU: delta (kernel+user) in 100ns units → percentage via wall-clock.
	pDelta := (pKernel1 + pUser1) - (pKernel0 + pUser0)
	wallHns := uint64(wallElapsed.Nanoseconds() / 100) // wall-clock in 100ns units
	if wallHns > 0 {
		info.ProcessCPUPercent = int((pDelta * 100) / wallHns)
		if info.ProcessCPUPercent < 0 {
			info.ProcessCPUPercent = 0
		}
		if info.ProcessCPUPercent > 100 {
			info.ProcessCPUPercent = 100
		}
	}

	// Process memory via K32GetProcessMemoryInfo.
	info.ProcessMemoryMB = getProcessMemoryMB()

	// Memory via GlobalMemoryStatusEx.
	var mem memoryStatusEx
	mem.Length = uint32(unsafe.Sizeof(mem))
	ret, _, _ = procGlobalMemoryStatusEx.Call(uintptr(unsafe.Pointer(&mem)))
	if ret != 0 {
		usedBytes := mem.TotalPhys - mem.AvailPhys
		info.MemoryMB = int(usedBytes / (1024 * 1024))
	}

	// Disk free on C:\.
	var freeBytesAvailable, totalBytes, totalFreeBytes uint64
	root, _ := windows.UTF16PtrFromString(`C:\`)
	err := windows.GetDiskFreeSpaceEx(root, &freeBytesAvailable, &totalBytes, &totalFreeBytes)
	if err == nil {
		info.DiskFreeMB = int(freeBytesAvailable / (1024 * 1024))
	}

	return info
}

// getProcessTimes returns kernel and user times for the current process as 100ns ticks.
func getProcessTimes() (kernel, user uint64) {
	var creationFt, exitFt, kernelFt, userFt windows.Filetime
	err := windows.GetProcessTimes(windows.CurrentProcess(), &creationFt, &exitFt, &kernelFt, &userFt)
	if err != nil {
		return 0, 0
	}
	kernel = uint64(kernelFt.HighDateTime)<<32 | uint64(kernelFt.LowDateTime)
	user = uint64(userFt.HighDateTime)<<32 | uint64(userFt.LowDateTime)
	return
}

// getProcessMemoryMB returns the working set size (RSS equivalent) in MB.
func getProcessMemoryMB() int {
	var pmc processMemoryCounters
	pmc.CB = uint32(unsafe.Sizeof(pmc))
	ret, _, _ := procK32GetProcessMemoryInfo.Call(
		uintptr(windows.CurrentProcess()),
		uintptr(unsafe.Pointer(&pmc)),
		uintptr(pmc.CB),
	)
	if ret == 0 {
		return 0
	}
	return int(pmc.WorkingSetSize / (1024 * 1024))
}

// getSystemTimes returns idle, kernel, and user times as uint64 ticks.
func getSystemTimes() (idle, kernel, user uint64) {
	var idleFt, kernelFt, userFt windows.Filetime
	procGetSystemTimes.Call(
		uintptr(unsafe.Pointer(&idleFt)),
		uintptr(unsafe.Pointer(&kernelFt)),
		uintptr(unsafe.Pointer(&userFt)),
	)
	idle = uint64(idleFt.HighDateTime)<<32 | uint64(idleFt.LowDateTime)
	kernel = uint64(kernelFt.HighDateTime)<<32 | uint64(kernelFt.LowDateTime)
	user = uint64(userFt.HighDateTime)<<32 | uint64(userFt.LowDateTime)
	return
}
