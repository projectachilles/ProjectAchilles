package firstboot

import (
	"context"
	"io/fs"
	"os"
	"strings"
	"sync"
)

// call is one recorded Run invocation.
type call struct {
	stdin []byte
	argv  []string
}

// event is one entry in fakeHost's ordered log: either a Run (call set) or a
// WriteFile (write set). Tests assert ordering across both kinds.
type event struct {
	call  *call
	write string // path written, when call == nil
}

type scripted struct {
	prefix []string
	out    []byte
	err    error
}

// fakeHost is an in-memory Host: files live in a map, and every Run and
// WriteFile lands in one ordered log.
type fakeHost struct {
	mu     sync.Mutex
	files  map[string][]byte
	perms  map[string]fs.FileMode
	log    []event
	script []scripted
}

func newFakeHost() *fakeHost {
	return &fakeHost{files: map[string][]byte{}, perms: map[string]fs.FileMode{}}
}

// on scripts the output and error for any Run whose argv starts with prefix.
// The first matching script wins; unmatched calls return (nil, nil).
func (f *fakeHost) on(prefix []string, out string, err error) {
	f.script = append(f.script, scripted{prefix: prefix, out: []byte(out), err: err})
}

func (f *fakeHost) Run(_ context.Context, stdin []byte, name string, args ...string) ([]byte, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	argv := append([]string{name}, args...)
	f.log = append(f.log, event{call: &call{stdin: stdin, argv: argv}})
	for _, s := range f.script {
		if len(argv) >= len(s.prefix) && strings.Join(argv[:len(s.prefix)], "\x00") == strings.Join(s.prefix, "\x00") {
			return s.out, s.err
		}
	}
	return nil, nil
}

func (f *fakeHost) ReadFile(path string) ([]byte, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	b, ok := f.files[path]
	if !ok {
		return nil, &fs.PathError{Op: "open", Path: path, Err: os.ErrNotExist}
	}
	return b, nil
}

func (f *fakeHost) WriteFile(path string, data []byte, perm fs.FileMode) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.files[path] = append([]byte(nil), data...)
	f.perms[path] = perm
	f.log = append(f.log, event{write: path})
	return nil
}

func (f *fakeHost) Exists(path string) bool {
	f.mu.Lock()
	defer f.mu.Unlock()
	_, ok := f.files[path]
	return ok
}

// calls returns only the Run invocations, in order.
func (f *fakeHost) calls() []call {
	var out []call
	for _, e := range f.log {
		if e.call != nil {
			out = append(out, *e.call)
		}
	}
	return out
}
