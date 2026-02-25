//go:build !windows

package executor

// jobObject is a no-op stub on non-Windows platforms.
// Linux/macOS use process groups (handled by Go's default Cmd.Cancel),
// so Job Objects are not needed.
type jobObject struct{}

func newJobObject() (*jobObject, error) { return nil, nil }
func (j *jobObject) assign(pid uint32) error { return nil }
func (j *jobObject) close()                  {}
