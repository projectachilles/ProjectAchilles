//go:build windows

package service

import (
	"fmt"

	"golang.org/x/sys/windows/svc"
	"golang.org/x/sys/windows/svc/mgr"
)

// SendReload signals the running agent service to re-read its config from disk.
// On Windows this sends the custom SCM control code 128 to the service. The
// agent's svc.Handler dispatches it onto the poller's internal reload channel.
//
// Equivalent CLI: `sc control AchillesAgent 128`
func SendReload() error {
	if !isElevated() {
		return fmt.Errorf("reload requires administrator privileges")
	}
	m, err := mgr.Connect()
	if err != nil {
		return fmt.Errorf("connect to service manager: %w", err)
	}
	defer m.Disconnect()

	s, err := m.OpenService(serviceName)
	if err != nil {
		return fmt.Errorf("open service %s: %w", serviceName, err)
	}
	defer s.Close()

	// Verify the service is running before sending the control code — sending
	// to a stopped service returns ERROR_SERVICE_NOT_ACTIVE which is opaque
	// to admins. Check first and return a clearer message.
	q, err := s.Query()
	if err != nil {
		return fmt.Errorf("query service state: %w", err)
	}
	if q.State != svc.Running {
		return fmt.Errorf("agent service is not running (state=%d)", q.State)
	}

	if _, err := s.Control(SCMReloadCmd); err != nil {
		return fmt.Errorf("send control code %d: %w", SCMReloadCmd, err)
	}
	return nil
}
