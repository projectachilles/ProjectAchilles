//go:build windows

package sysinfo

import (
	"time"
	"unsafe"

	"golang.org/x/sys/windows"
)

var (
	modkernel32             = windows.NewLazySystemDLL("kernel32.dll")
	procGetSystemTimes      = modkernel32.NewProc("GetSystemTimes")
	procGetTickCount64      = modkernel32.NewProc("GetTickCount64")
	procGlobalMemoryStatusEx = modkernel32.NewProc("GlobalMemoryStatusEx")
)

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
	idle0, kernel0, user0 := getSystemTimes()
	time.Sleep(200 * time.Millisecond)
	idle1, kernel1, user1 := getSystemTimes()

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
