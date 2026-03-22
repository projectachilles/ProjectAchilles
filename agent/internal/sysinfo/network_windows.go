//go:build windows

package sysinfo

import (
	"unsafe"

	"golang.org/x/sys/windows"
)

// CheckNetworkState inspects Windows network adapter operational status via
// GetAdaptersAddresses. Returns "adapters_ok" if at least one non-loopback
// adapter has OperStatus == Up, "all_adapters_down" if none are up, or
// "check_failed" on API error.
func CheckNetworkState() string {
	// First call: get required buffer size.
	var size uint32
	ret := windows.GetAdaptersAddresses(windows.AF_UNSPEC, 0, 0, nil, &size)
	if ret != windows.ERROR_BUFFER_OVERFLOW {
		return "check_failed"
	}

	buf := make([]byte, size)
	addr := (*windows.IpAdapterAddresses)(unsafe.Pointer(&buf[0]))
	ret = windows.GetAdaptersAddresses(windows.AF_UNSPEC, 0, 0, addr, &size)
	if ret != 0 {
		return "check_failed"
	}

	hasNonLoopback := false
	for aa := addr; aa != nil; aa = aa.Next {
		if aa.IfType == windows.IF_TYPE_SOFTWARE_LOOPBACK {
			continue
		}
		hasNonLoopback = true
		if aa.OperStatus == windows.IfOperStatusUp {
			return "adapters_ok"
		}
	}

	if !hasNonLoopback {
		return "adapters_ok"
	}
	return "all_adapters_down"
}
