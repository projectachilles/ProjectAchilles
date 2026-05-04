package queue

import (
	"context"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/f0rt1ka/achilles-agent/internal/executor"
	"github.com/f0rt1ka/achilles-agent/internal/httpclient"
	"github.com/f0rt1ka/achilles-agent/internal/reporter"
)

// fakeReportFn is a controllable ReportFunc for unit-testing queue.Drain
// without spinning up a real HTTP server. It records each invocation and
// returns the configured error sequence.
type fakeReportFn struct {
	calls []string
	errs  []error // returned in order, last one repeats
}

func (f *fakeReportFn) Fn(_ context.Context, _ *httpclient.Client, taskID string, _ *executor.Result) error {
	f.calls = append(f.calls, taskID)
	if len(f.errs) == 0 {
		return nil
	}
	idx := len(f.calls) - 1
	if idx >= len(f.errs) {
		idx = len(f.errs) - 1
	}
	return f.errs[idx]
}

func newQ(t *testing.T) *Queue {
	t.Helper()
	dir := t.TempDir()
	q, err := New(dir)
	if err != nil {
		t.Fatalf("New: %v", err)
	}
	return q
}

func enq(t *testing.T, q *Queue, ids ...string) {
	t.Helper()
	for _, id := range ids {
		if err := q.Enqueue(id, &executor.Result{TaskID: id}); err != nil {
			t.Fatalf("Enqueue(%s): %v", id, err)
		}
	}
}

func filesIn(t *testing.T, dir string) []string {
	t.Helper()
	entries, err := os.ReadDir(dir)
	if err != nil {
		t.Fatalf("ReadDir: %v", err)
	}
	var names []string
	for _, e := range entries {
		if !e.IsDir() {
			names = append(names, e.Name())
		}
	}
	return names
}

func TestDrain_Success_DeletesAllFiles(t *testing.T) {
	q := newQ(t)
	enq(t, q, "t1", "t2", "t3")

	fr := &fakeReportFn{}
	drained := q.Drain(context.Background(), fr.Fn, nil)

	if drained != 3 {
		t.Fatalf("drained=%d, want 3", drained)
	}
	if got := filesIn(t, q.dir); len(got) != 0 {
		t.Fatalf("expected empty queue, got %v", got)
	}
}

func TestDrain_PermanentError_DeletesFileAndContinues(t *testing.T) {
	q := newQ(t)
	enq(t, q, "t1", "t2", "t3")

	// t1 → permanent reject; t2/t3 → success.
	// Without the fix, the queue would break on t1 and never deliver t2/t3.
	fr := &fakeReportFn{
		errs: []error{
			fmt.Errorf("server says no: %w", reporter.ErrPermanent),
			nil,
			nil,
		},
	}

	drained := q.Drain(context.Background(), fr.Fn, nil)

	if drained != 2 {
		t.Fatalf("drained=%d, want 2 (t1 was permanent-rejected, deleted; t2/t3 succeeded)", drained)
	}
	if len(fr.calls) != 3 {
		t.Fatalf("expected 3 reportFn calls (continued past permanent), got %d: %v", len(fr.calls), fr.calls)
	}
	if got := filesIn(t, q.dir); len(got) != 0 {
		t.Fatalf("expected empty queue (permanent file deleted, others delivered), got %v", got)
	}
}

func TestDrain_TransientError_BreaksAndPreservesFile(t *testing.T) {
	q := newQ(t)
	enq(t, q, "t1", "t2", "t3")

	fr := &fakeReportFn{
		errs: []error{
			fmt.Errorf("server unreachable: %w", reporter.ErrTransient),
		},
	}

	drained := q.Drain(context.Background(), fr.Fn, nil)

	if drained != 0 {
		t.Fatalf("drained=%d, want 0", drained)
	}
	if len(fr.calls) != 1 {
		t.Fatalf("expected break on first failure, got %d calls", len(fr.calls))
	}
	got := filesIn(t, q.dir)
	if len(got) != 3 {
		t.Fatalf("expected all 3 files preserved on transient failure, got %v", got)
	}
}

func TestDrain_UnknownError_TreatedAsTransient(t *testing.T) {
	// A reporter that returns an error neither wrapping ErrPermanent nor
	// ErrTransient must default to "preserve the file" — we never want to
	// silently drop a result on an unrecognised failure.
	q := newQ(t)
	enq(t, q, "t1")

	fr := &fakeReportFn{
		errs: []error{errors.New("something weird happened")},
	}

	q.Drain(context.Background(), fr.Fn, nil)

	if got := filesIn(t, q.dir); len(got) != 1 {
		t.Fatalf("expected file preserved on unknown error, got %v", got)
	}
}

func TestDrain_CorruptFile_RemovesAndContinues(t *testing.T) {
	q := newQ(t)
	corruptPath := filepath.Join(q.dir, "corrupt.json")
	if err := os.WriteFile(corruptPath, []byte("not json"), 0600); err != nil {
		t.Fatalf("WriteFile: %v", err)
	}
	enq(t, q, "t1")

	fr := &fakeReportFn{}
	drained := q.Drain(context.Background(), fr.Fn, nil)

	if drained != 1 {
		t.Fatalf("drained=%d, want 1", drained)
	}
	if got := filesIn(t, q.dir); len(got) != 0 {
		t.Fatalf("expected corrupt file removed and t1 delivered, got %v", got)
	}
}

func TestDrain_PermanentThenTransient_StopsOnTransient(t *testing.T) {
	// Permanent rejection on t1, transient on t2 → expect t1 deleted,
	// t2 preserved, processing breaks before reaching t3.
	q := newQ(t)
	enq(t, q, "t1", "t2", "t3")

	fr := &fakeReportFn{
		errs: []error{
			fmt.Errorf("perm: %w", reporter.ErrPermanent),
			fmt.Errorf("trans: %w", reporter.ErrTransient),
		},
	}

	q.Drain(context.Background(), fr.Fn, nil)

	got := filesIn(t, q.dir)
	if len(got) != 2 {
		t.Fatalf("expected 2 files remaining (t2, t3); got %v", got)
	}
	for _, name := range got {
		if strings.HasPrefix(name, "t1") {
			t.Errorf("t1 (permanent) should have been deleted: still present %s", name)
		}
	}
}
