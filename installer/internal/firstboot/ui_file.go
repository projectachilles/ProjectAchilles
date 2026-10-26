//go:build appliancetest

package firstboot

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"time"
)

// This file is compiled only with -tags appliancetest. It lets the image boot
// test in CI run first boot unattended; the production binary never contains
// it, so it can never read an answers file.

const (
	AnswersPath = "/var/lib/projectachilles/test-answers.json"
	HandoffPath = "/var/lib/projectachilles/test-handoff.json"
	testMarker  = "appliancetest-first-boot-answers"
)

// Answers is the test answers file.
type Answers struct {
	Layout   string    `json:"layout"` // a Layouts ID, e.g. "us"
	Password string    `json:"password"`
	Network  NetConfig `json:"network"` // DHCP: {"DHCP":true,"Hostname":"achilles"}
	Keep     bool      `json:"keep"`    // ConfirmNetwork answer
}

// FileUI answers first boot from a JSON file.
type FileUI struct {
	path, handoffPath string
	answers           Answers
}

var _ UI = (*FileUI)(nil)

// NewFileUI reads the answers file and returns a UI that replays it.
func NewFileUI(answersPath, handoffPath string) (*FileUI, error) {
	fmt.Fprintln(os.Stderr, testMarker, answersPath)
	raw, err := os.ReadFile(answersPath)
	if err != nil {
		return nil, fmt.Errorf("appliancetest: read answers: %w", err)
	}
	u := &FileUI{path: answersPath, handoffPath: handoffPath}
	if err := json.Unmarshal(raw, &u.answers); err != nil {
		return nil, fmt.Errorf("appliancetest: parse %s: %w", answersPath, err)
	}
	return u, nil
}

func (u *FileUI) Layout(context.Context) (Layout, error) {
	for _, l := range Layouts {
		if l.ID == u.answers.Layout {
			return l, nil
		}
	}
	return Layout{}, fmt.Errorf("appliancetest: unknown layout %q in %s", u.answers.Layout, u.path)
}

func (u *FileUI) Password(context.Context) (string, error) {
	if err := ValidatePassword(u.answers.Password, u.answers.Password); err != nil {
		return "", fmt.Errorf("appliancetest: password in %s: %w", u.path, err)
	}
	return u.answers.Password, nil
}

func (u *FileUI) Network(_ context.Context, d Detected, _ *NetConfig) (NetConfig, error) {
	nc := u.answers.Network
	if nc.Iface == "" {
		nc.Iface = d.Iface
	}
	return nc, nil
}

func (u *FileUI) ConfirmNetwork(context.Context, NetConfig, NetCheck, time.Duration) (bool, error) {
	return u.answers.Keep, nil
}

func (u *FileUI) Handoff(_ context.Context, h Handoff) error {
	raw, err := json.Marshal(h)
	if err != nil {
		return err
	}
	return os.WriteFile(u.handoffPath, raw, 0o600)
}

func (u *FileUI) Notice(_ context.Context, msg string) error {
	return fmt.Errorf("appliancetest: unexpected notice: %s", msg)
}
