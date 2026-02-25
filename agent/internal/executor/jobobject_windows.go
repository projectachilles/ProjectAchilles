//go:build windows

package executor

import (
	"fmt"
	"sync"
	"unsafe"

	"golang.org/x/sys/windows"
)

// jobObject wraps a Windows Job Object handle configured with
// JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE. When the handle is closed,
// the OS kernel atomically terminates every process in the job —
// including grandchildren that inherited pipe handles.
type jobObject struct {
	handle windows.Handle
	once   sync.Once
}

// newJobObject creates a new anonymous Job Object with the
// KILL_ON_JOB_CLOSE limit. Returns (nil, nil) if not on Windows
// (handled by build tags — this file is only compiled on Windows).
func newJobObject() (*jobObject, error) {
	h, err := windows.CreateJobObject(nil, nil)
	if err != nil {
		return nil, fmt.Errorf("CreateJobObject: %w", err)
	}

	// Set the kill-on-close limit so all processes die when we close the handle.
	info := windows.JOBOBJECT_EXTENDED_LIMIT_INFORMATION{
		BasicLimitInformation: windows.JOBOBJECT_BASIC_LIMIT_INFORMATION{
			LimitFlags: windows.JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
		},
	}
	_, err = windows.SetInformationJobObject(
		h,
		windows.JobObjectExtendedLimitInformation,
		uintptr(unsafe.Pointer(&info)),
		uint32(unsafe.Sizeof(info)),
	)
	if err != nil {
		windows.CloseHandle(h)
		return nil, fmt.Errorf("SetInformationJobObject: %w", err)
	}

	return &jobObject{handle: h}, nil
}

// assign adds a running process (by PID) to the job object.
func (j *jobObject) assign(pid uint32) error {
	proc, err := windows.OpenProcess(
		windows.PROCESS_SET_QUOTA|windows.PROCESS_TERMINATE,
		false,
		pid,
	)
	if err != nil {
		return fmt.Errorf("OpenProcess(%d): %w", pid, err)
	}
	defer windows.CloseHandle(proc)

	if err := windows.AssignProcessToJobObject(j.handle, proc); err != nil {
		return fmt.Errorf("AssignProcessToJobObject(%d): %w", pid, err)
	}
	return nil
}

// close releases the job handle. If KILL_ON_JOB_CLOSE is set,
// this terminates all processes in the job. Safe to call multiple times.
func (j *jobObject) close() {
	j.once.Do(func() {
		windows.CloseHandle(j.handle)
	})
}
