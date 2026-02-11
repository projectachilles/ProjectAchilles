package store

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sync"
	"time"
)

// State represents the persisted agent state.
type State struct {
	AgentID       string     `json:"agent_id"`
	LastTaskID    string     `json:"last_task_id,omitempty"`
	LastHeartbeat *time.Time `json:"last_heartbeat,omitempty"`
	Version       string     `json:"version"`
}

// Store manages reading and writing agent state to disk.
type Store struct {
	path  string
	mu    sync.RWMutex
	state State
}

// New creates a Store backed by state.json inside the given directory.
// It creates the directory with mode 0700 and attempts to load existing state.
func New(dir string) (*Store, error) {
	if err := os.MkdirAll(dir, 0700); err != nil {
		return nil, fmt.Errorf("create store dir %s: %w", dir, err)
	}

	p := filepath.Join(dir, "state.json")
	s := &Store{path: p}

	data, err := os.ReadFile(p)
	if err == nil {
		if err := json.Unmarshal(data, &s.state); err != nil {
			return nil, fmt.Errorf("parse state %s: %w", p, err)
		}
	}
	// If the file doesn't exist, we start with a zero-value State.

	return s, nil
}

// Get returns a copy of the current state.
func (s *Store) Get() State {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.state
}

// Update applies fn to the state, then persists it to disk.
func (s *Store) Update(fn func(*State)) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	fn(&s.state)

	data, err := json.MarshalIndent(s.state, "", "  ")
	if err != nil {
		return fmt.Errorf("marshal state: %w", err)
	}

	if err := os.WriteFile(s.path, data, 0600); err != nil {
		return fmt.Errorf("write state %s: %w", s.path, err)
	}

	return nil
}
