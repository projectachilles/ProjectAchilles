package updater

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"
	"time"

	"github.com/f0rt1ka/achilles-agent/internal/config"
	"github.com/f0rt1ka/achilles-agent/internal/httpclient"
	"github.com/f0rt1ka/achilles-agent/internal/store"
)

const advertisedSHA = "0322da0d29f4823024a50289db4c6fad7a81dac59705fe79093c257b641d29f9"

// fakeUpdateServer advertises 0.6.4 with advertisedSHA and counts how many
// times the agent tries to download the binary.
func fakeUpdateServer(t *testing.T, downloads *int32) *httptest.Server {
	t.Helper()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/api/agent/version":
			_ = json.NewEncoder(w).Encode(map[string]any{
				"success": true,
				"data":    map[string]any{"version": "0.6.4", "sha256": advertisedSHA, "size": 4},
			})
		case "/api/agent/update":
			atomic.AddInt32(downloads, 1)
			_, _ = w.Write([]byte("junk")) // fails the SHA check; we only count the attempt
		default:
			http.NotFound(w, r)
		}
	}))
	t.Cleanup(srv.Close)
	return srv
}

func newTestSetup(t *testing.T, srv *httptest.Server) (*httpclient.Client, *config.Config, *store.Store) {
	t.Helper()
	cfg := &config.Config{
		ServerURL:          srv.URL,
		AgentID:            "agent-test",
		AgentKey:           "ak_test",
		MaxDownloadTimeout: 5 * time.Second,
	}
	st, err := store.New(t.TempDir())
	if err != nil {
		t.Fatalf("store.New: %v", err)
	}
	return httpclient.NewClient(cfg, "0.6.3"), cfg, st
}

// The incident: a binary built as 0.6.3 was registered as 0.6.4. Each install
// restarted the agent still reporting 0.6.3, which was offered 0.6.4 again,
// forever. Having already installed exactly this artifact from exactly this
// version, the agent must refuse instead of downloading it again.
func TestCheckAndUpdate_RefusesToReinstallSameArtifactFromSameVersion(t *testing.T) {
	var downloads int32
	client, cfg, st := newTestSetup(t, fakeUpdateServer(t, &downloads))
	_ = st.Update(func(s *store.State) {
		s.LastAppliedUpdate = &store.AppliedUpdate{
			Version: "0.6.4", SHA256: advertisedSHA, FromVersion: "0.6.3",
		}
	})

	updated, err := CheckAndUpdate(context.Background(), client, "0.6.3", cfg, st)

	if updated {
		t.Fatal("updated = true, want false")
	}
	if !errors.Is(err, ErrRepeatedUpdate) {
		t.Fatalf("err = %v, want ErrRepeatedUpdate", err)
	}
	if n := atomic.LoadInt32(&downloads); n != 0 {
		t.Fatalf("downloaded %d time(s), want 0", n)
	}
}

// A corrected upload under the same version number has a different SHA256 and
// must still be installable — the guard keys on the artifact, not the label.
func TestCheckAndUpdate_AllowsDifferentArtifactUnderSameVersion(t *testing.T) {
	var downloads int32
	client, cfg, st := newTestSetup(t, fakeUpdateServer(t, &downloads))
	_ = st.Update(func(s *store.State) {
		s.LastAppliedUpdate = &store.AppliedUpdate{
			Version: "0.6.4", SHA256: "some-other-sha", FromVersion: "0.6.3",
		}
	})

	_, err := CheckAndUpdate(context.Background(), client, "0.6.3", cfg, st)

	if errors.Is(err, ErrRepeatedUpdate) {
		t.Fatal("refused a different artifact as a repeat")
	}
	if n := atomic.LoadInt32(&downloads); n != 1 {
		t.Fatalf("downloaded %d time(s), want 1", n)
	}
}

// If the agent now runs a different version than the one it installed from
// (e.g. an operator reinstalled it by hand), the earlier record is not
// evidence of a loop.
func TestCheckAndUpdate_AllowsReinstallFromADifferentVersion(t *testing.T) {
	var downloads int32
	client, cfg, st := newTestSetup(t, fakeUpdateServer(t, &downloads))
	_ = st.Update(func(s *store.State) {
		s.LastAppliedUpdate = &store.AppliedUpdate{
			Version: "0.6.4", SHA256: advertisedSHA, FromVersion: "0.5.5",
		}
	})

	_, err := CheckAndUpdate(context.Background(), client, "0.6.3", cfg, st)

	if errors.Is(err, ErrRepeatedUpdate) {
		t.Fatal("refused although the running version differs from the recorded one")
	}
	if n := atomic.LoadInt32(&downloads); n != 1 {
		t.Fatalf("downloaded %d time(s), want 1", n)
	}
}

func TestCheckAndUpdate_NilStoreSkipsGuard(t *testing.T) {
	var downloads int32
	client, cfg, _ := newTestSetup(t, fakeUpdateServer(t, &downloads))

	_, err := CheckAndUpdate(context.Background(), client, "0.6.3", cfg, nil)

	if errors.Is(err, ErrRepeatedUpdate) {
		t.Fatal("nil store must not trigger the guard")
	}
	if n := atomic.LoadInt32(&downloads); n != 1 {
		t.Fatalf("downloaded %d time(s), want 1", n)
	}
}

func TestRecordAppliedUpdate_PersistsAcrossStoreReload(t *testing.T) {
	dir := t.TempDir()
	st, err := store.New(dir)
	if err != nil {
		t.Fatal(err)
	}

	recordAppliedUpdate(st, &VersionInfo{Version: "0.6.4", SHA256: advertisedSHA}, "0.6.3")

	reloaded, err := store.New(dir)
	if err != nil {
		t.Fatal(err)
	}
	got := reloaded.Get().LastAppliedUpdate
	if got == nil || got.Version != "0.6.4" || got.SHA256 != advertisedSHA || got.FromVersion != "0.6.3" {
		t.Fatalf("LastAppliedUpdate after reload = %+v", got)
	}
}
