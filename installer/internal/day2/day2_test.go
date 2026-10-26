package day2

import (
	"archive/tar"
	"compress/gzip"
	"context"
	"crypto/x509"
	"errors"
	"io"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/projectachilles/ProjectAchilles/installer/internal/ca"
)

type call struct {
	name string
	args []string
}

func (c call) String() string { return c.name + " " + strings.Join(c.args, " ") }

// fakeCmd records every call; handler (optional) decides the result.
type fakeCmd struct {
	mu      sync.Mutex
	calls   []call
	handler func(c call) ([]byte, error)
}

func (f *fakeCmd) Run(_ context.Context, name string, args ...string) ([]byte, error) {
	c := call{name, args}
	f.mu.Lock()
	f.calls = append(f.calls, c)
	f.mu.Unlock()
	if f.handler != nil {
		return f.handler(c)
	}
	return nil, nil
}

func (f *fakeCmd) has(sub string) bool {
	for _, c := range f.calls {
		if strings.Contains(c.String(), sub) {
			return true
		}
	}
	return false
}

func newCA(t *testing.T) (string, *ca.Bundle) {
	t.Helper()
	dir := filepath.Join(t.TempDir(), "ca")
	b, err := ca.Init(ca.Options{Dir: dir, Zone: "corp.example.com", Label: "Test"})
	if err != nil {
		t.Fatal(err)
	}
	return dir, b
}

func okHealth(context.Context, string, *x509.CertPool) (HealthResult, error) {
	return HealthResult{Status: 200}, nil
}

func TestStatusWarnsIntermediateUnder90Days(t *testing.T) {
	dir, b := newCA(t)
	d := Deps{
		Cmd: &fakeCmd{}, RepoDir: t.TempDir(), CADir: dir, BackupDir: t.TempDir(),
		Host: "achilles.corp.example.com", TLSMode: "achilles-ca",
		Now:      func() time.Time { return b.Intermediate.NotAfter.Add(-30 * 24 * time.Hour) },
		Health:   okHealth,
		DiskFree: func(string) (uint64, error) { return 50 << 30, nil },
	}
	r, err := Status(context.Background(), d)
	if err != nil {
		t.Fatal(err)
	}
	if r.OK() {
		t.Fatal("report should not be OK")
	}
	if c := r.find("Intermediate CA"); c == nil || c.Level != Warn {
		t.Fatalf("intermediate check = %+v, want Warn", c)
	}
	// 100 days left: fine.
	d.Now = func() time.Time { return b.Intermediate.NotAfter.Add(-100 * 24 * time.Hour) }
	r, _ = Status(context.Background(), d)
	if c := r.find("Intermediate CA"); c == nil || c.Level != OK {
		t.Fatalf("intermediate check at 100d = %+v, want OK", c)
	}
}

func TestStatusWarnsRootUnderOneYear(t *testing.T) {
	dir, b := newCA(t)
	d := Deps{
		Cmd: &fakeCmd{}, RepoDir: t.TempDir(), CADir: dir, BackupDir: t.TempDir(),
		Host: "h.corp.example.com", TLSMode: "achilles-ca",
		Now:    func() time.Time { return b.Root.NotAfter.Add(-200 * 24 * time.Hour) },
		Health: okHealth,
	}
	r, _ := Status(context.Background(), d)
	if c := r.find("Root CA"); c == nil || c.Level != Warn {
		t.Fatalf("root check = %+v, want Warn", c)
	}
}

func TestStatusSectionsDegradeIndependently(t *testing.T) {
	dir, _ := newCA(t)
	d := Deps{
		Cmd:     &fakeCmd{handler: func(call) ([]byte, error) { return nil, errors.New("docker: not running") }},
		RepoDir: t.TempDir(), CADir: dir, BackupDir: t.TempDir(),
		Host: "h.corp.example.com", TLSMode: "achilles-ca",
		Now: time.Now,
		Health: func(context.Context, string, *x509.CertPool) (HealthResult, error) {
			return HealthResult{}, errors.New("connection refused")
		},
	}
	r, err := Status(context.Background(), d)
	if err != nil {
		t.Fatal(err)
	}
	if r.OK() {
		t.Fatal("must not be OK")
	}
	if c := r.find("Containers"); c == nil || !strings.Contains(c.Value, "unavailable") {
		t.Fatalf("containers = %+v", c)
	}
	if c := r.find("Health"); c == nil || !strings.Contains(c.Value, "unreachable") {
		t.Fatalf("health = %+v", c)
	}
	if c := r.find("Root CA"); c == nil || c.Level == Fail {
		t.Fatalf("CA must still be shown: %+v", c)
	}
}

func TestStatusParsesComposePS(t *testing.T) {
	nd := `{"Service":"backend","State":"running","Health":"healthy"}` + "\n" + `{"Service":"caddy","State":"exited"}`
	d := Deps{
		Cmd:     &fakeCmd{handler: func(c call) ([]byte, error) { return []byte(nd), nil }},
		RepoDir: t.TempDir(), BackupDir: t.TempDir(), Host: "h", TLSMode: "acme-http", Now: time.Now, Health: okHealth,
	}
	r, _ := Status(context.Background(), d)
	if c := r.find("Container backend"); c == nil || c.Level != OK {
		t.Fatalf("backend = %+v", c)
	}
	if c := r.find("Container caddy"); c == nil || c.Level != Fail {
		t.Fatalf("caddy = %+v", c)
	}
	arr := `[{"Service":"backend","State":"running"}]`
	d.Cmd = &fakeCmd{handler: func(call) ([]byte, error) { return []byte(arr), nil }}
	r, _ = Status(context.Background(), d)
	if c := r.find("Container backend"); c == nil || c.Level != OK {
		t.Fatalf("array form: %+v", c)
	}
}

// gitFake answers the git calls Upgrade makes.
func gitFake(porcelain, tlsPorcelain, tags, current string) *fakeCmd {
	return &fakeCmd{handler: func(c call) ([]byte, error) {
		s := c.String()
		switch {
		case strings.Contains(s, "status --porcelain -- deploy/caddy/tls.caddy"):
			return []byte(tlsPorcelain), nil
		case strings.Contains(s, "status --porcelain"):
			return []byte(porcelain), nil
		case strings.Contains(s, "tag --list"):
			return []byte(tags), nil
		case strings.Contains(s, "describe"):
			return []byte(current + "\n"), nil
		}
		return nil, nil
	}}
}

func upgradeDeps(t *testing.T, f *fakeCmd, engineErr error, ran *bool) Deps {
	t.Helper()
	repo := t.TempDir()
	_ = os.WriteFile(filepath.Join(repo, "deploy.config.env"), []byte("X=1\n"), 0o600)
	return Deps{
		Cmd: f, RepoDir: repo, Out: io.Discard, In: strings.NewReader("y\n"),
		RunEngine: func(context.Context) error { *ran = true; return engineErr },
	}
}

func TestUpgradeRefusesDirtyTree(t *testing.T) {
	var ran bool
	f := gitFake(" M backend/x.ts\n", "", "v2.3.0\nv2.10.0\n", "v2.3.0")
	err := Upgrade(context.Background(), upgradeDeps(t, f, nil, &ran), "", true)
	if err == nil || !strings.Contains(err.Error(), "uncommitted") {
		t.Fatalf("err = %v", err)
	}
	if f.has("checkout") || ran {
		t.Fatal("must not checkout or run the engine")
	}
}

func TestUpgradeRestoresLegacyTLSCaddyBeforeDirtyCheck(t *testing.T) {
	var ran bool
	// tls.caddy is the only modification: after the restore the tree is clean.
	n := 0
	f := &fakeCmd{}
	f.handler = func(c call) ([]byte, error) {
		s := c.String()
		switch {
		case strings.Contains(s, "status --porcelain -- deploy/caddy/tls.caddy"):
			return []byte(" M deploy/caddy/tls.caddy\n"), nil
		case strings.Contains(s, "checkout -- deploy/caddy/tls.caddy"):
			n++
		case strings.Contains(s, "status --porcelain"):
			if n == 0 {
				return []byte(" M deploy/caddy/tls.caddy\n"), nil
			}
			return nil, nil
		case strings.Contains(s, "tag --list"):
			return []byte("v2.3.0\nv2.4.0\n"), nil
		case strings.Contains(s, "describe"):
			return []byte("v2.3.0\n"), nil
		}
		return nil, nil
	}
	if err := Upgrade(context.Background(), upgradeDeps(t, f, nil, &ran), "", true); err != nil {
		t.Fatal(err)
	}
	if n != 1 || !ran {
		t.Fatalf("restored=%d engine=%v", n, ran)
	}
}

func TestUpgradePicksNextSemverTag(t *testing.T) {
	var ran bool
	f := gitFake("", "", "v2.1.0\nv2.3.0\nv2.10.0\nagent-v0.6.7\nv2.11.0-rc1\n", "v2.3.0")
	if err := Upgrade(context.Background(), upgradeDeps(t, f, nil, &ran), "", true); err != nil {
		t.Fatal(err)
	}
	if !f.has("git -C") || !f.has("checkout v2.10.0") {
		t.Fatalf("calls: %v", f.calls)
	}
	if !f.has("fetch --tags") || !ran {
		t.Fatal("expected fetch and engine run")
	}
}

func TestUpgradeAlreadyUpToDate(t *testing.T) {
	var ran bool
	f := gitFake("", "", "v2.3.0\nagent-v9.9.9\n", "v2.3.0")
	var out strings.Builder
	d := upgradeDeps(t, f, nil, &ran)
	d.Out = &out
	if err := Upgrade(context.Background(), d, "", true); err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(out.String(), "already up to date") || ran || f.has("checkout") {
		t.Fatalf("out=%q ran=%v", out.String(), ran)
	}
}

func TestUpgradeEngineFailurePrintsRollback(t *testing.T) {
	var ran bool
	f := gitFake("", "", "v2.3.0\nv2.4.0\n", "v2.3.0")
	var out strings.Builder
	d := upgradeDeps(t, f, errors.New("exit 1"), &ran)
	d.Out = &out
	if err := Upgrade(context.Background(), d, "", true); err == nil {
		t.Fatal("expected error")
	}
	if !strings.Contains(out.String(), "git checkout v2.3.0") {
		t.Fatalf("no rollback hint: %q", out.String())
	}
}

func TestUpgradeDeclinedDoesNothing(t *testing.T) {
	var ran bool
	f := gitFake("", "", "v2.3.0\nv2.4.0\n", "v2.3.0")
	d := upgradeDeps(t, f, nil, &ran)
	d.In = strings.NewReader("n\n")
	if err := Upgrade(context.Background(), d, "", false); err == nil {
		t.Fatal("expected cancel error")
	}
	if f.has("checkout") || ran {
		t.Fatal("declined upgrade must not change anything")
	}
}

func backupDeps(t *testing.T, f *fakeCmd) Deps {
	t.Helper()
	repo := t.TempDir()
	for p, s := range map[string]string{"deploy.config.env": "A=1\n", ".env": "B=2\n", "backend/.env": "C=3\n"} {
		_ = os.MkdirAll(filepath.Dir(filepath.Join(repo, p)), 0o755)
		if err := os.WriteFile(filepath.Join(repo, p), []byte(s), 0o600); err != nil {
			t.Fatal(err)
		}
	}
	caDir, _ := newCA(t)
	return Deps{
		Cmd: f, RepoDir: repo, CADir: caDir, BackupDir: filepath.Join(t.TempDir(), "backups"),
		Out: io.Discard, In: strings.NewReader(""), Host: "achilles.corp.example.com",
		Project: "projectachilles", Now: time.Now,
		RunEngine: func(context.Context) error { return nil },
	}
}

// helperFake simulates the alpine helper: a "tar -cf /out/X.tar" run writes
// X.tar into the host directory mounted at /out. zstd probes fail. `docker
// ps` lists one container: an installed server.
func helperFake(failTar bool) *fakeCmd {
	return &fakeCmd{handler: func(c call) ([]byte, error) {
		if c.name == "docker" && len(c.args) > 0 && c.args[0] == "ps" {
			return []byte("3f2a1b\n"), nil
		}
		if c.name != "docker" || len(c.args) == 0 || c.args[0] != "run" {
			return nil, nil
		}
		s := c.String()
		if strings.Contains(s, "zstd") {
			return nil, errors.New("no zstd")
		}
		if failTar {
			return nil, errors.New("tar failed")
		}
		var host string
		for i, a := range c.args {
			if strings.HasSuffix(a, ":/out") {
				host = strings.TrimSuffix(a, ":/out")
			}
			if strings.HasPrefix(a, "/out/") && i > 0 {
				_ = os.WriteFile(filepath.Join(host, filepath.Base(a)), []byte("vol"), 0o600)
			}
		}
		return nil, nil
	}}
}

func TestBackupRestartsStackOnFailure(t *testing.T) {
	f := helperFake(true)
	d := backupDeps(t, f)
	if _, err := Backup(context.Background(), d, ""); err == nil {
		t.Fatal("expected error")
	}
	if !f.has("compose") || !f.has("stop") || !f.has("start") {
		t.Fatalf("calls: %v", f.calls)
	}
	last := f.calls[len(f.calls)-1]
	if !strings.HasSuffix(last.String(), "start") {
		t.Fatalf("stack must be restarted last, got %v", last)
	}
}

func TestBackupFileMode0600(t *testing.T) {
	f := helperFake(false)
	d := backupDeps(t, f)
	var out strings.Builder
	d.Out = &out
	p, err := Backup(context.Background(), d, "")
	if err != nil {
		t.Fatal(err)
	}
	fi, err := os.Stat(p)
	if err != nil {
		t.Fatal(err)
	}
	if fi.Mode().Perm() != 0o600 {
		t.Fatalf("file mode %v", fi.Mode().Perm())
	}
	di, _ := os.Stat(filepath.Dir(p))
	if di.Mode().Perm() != 0o700 {
		t.Fatalf("dir mode %v", di.Mode().Perm())
	}
	if !strings.HasSuffix(p, ".tar.gz") || !strings.Contains(out.String(), "gzip") {
		t.Fatalf("path %s, out %q", p, out.String())
	}
	if !strings.Contains(out.String(), "secrets") {
		t.Fatalf("missing warning: %q", out.String())
	}
	names := tarNames(t, p)
	for _, want := range []string{"volumes/projectachilles_achilles-data.tar", "files/deploy.config.env", "files/.env", "files/backend.env", "ca/root.key"} {
		if !names[want] {
			t.Errorf("archive lacks %s; has %v", want, names)
		}
	}
}

func TestBackupSkipsMissingVolume(t *testing.T) {
	f := helperFake(false)
	inner := f.handler
	f.handler = func(c call) ([]byte, error) {
		if strings.Contains(c.String(), "volume inspect") && strings.HasSuffix(c.String(), "_esdata") {
			return nil, errors.New("no such volume")
		}
		return inner(c)
	}
	d := backupDeps(t, f)
	var out strings.Builder
	d.Out = &out
	p, err := Backup(context.Background(), d, "")
	if err != nil {
		t.Fatal(err)
	}
	if tarNames(t, p)["volumes/projectachilles_esdata.tar"] || !strings.Contains(out.String(), "esdata") {
		t.Fatalf("esdata should be skipped with a note: %q", out.String())
	}
}

func tarNames(t *testing.T, p string) map[string]bool {
	t.Helper()
	fh, err := os.Open(p)
	if err != nil {
		t.Fatal(err)
	}
	defer fh.Close()
	gz, err := gzip.NewReader(fh)
	if err != nil {
		t.Fatal(err)
	}
	tr := tar.NewReader(gz)
	m := map[string]bool{}
	for {
		h, err := tr.Next()
		if err == io.EOF {
			return m
		}
		if err != nil {
			t.Fatal(err)
		}
		m[h.Name] = true
	}
}

func TestRestoreRequiresConfirmation(t *testing.T) {
	f := helperFake(false)
	d := backupDeps(t, f)
	p, err := Backup(context.Background(), d, "")
	if err != nil {
		t.Fatal(err)
	}
	f.calls = nil
	d.In = strings.NewReader("wrong.example.com\n")
	if err := Restore(context.Background(), d, p, false); err == nil {
		t.Fatal("expected refusal")
	}
	if f.has("stop") || f.has("run") {
		t.Fatalf("nothing may run without confirmation: %v", f.calls)
	}
}

func TestRestoreRoundTripAndPerms(t *testing.T) {
	f := helperFake(false)
	d := backupDeps(t, f)
	p, err := Backup(context.Background(), d, "")
	if err != nil {
		t.Fatal(err)
	}
	// Damage the live state.
	_ = os.WriteFile(filepath.Join(d.RepoDir, ".env"), []byte("CHANGED\n"), 0o644)
	_ = os.Chmod(filepath.Join(d.CADir, "root.key"), 0o644)
	_ = os.Chmod(d.CADir, 0o755)
	f.calls = nil
	d.In = strings.NewReader("achilles.corp.example.com\n")
	engineRuns := 0
	d.RunEngine = func(context.Context) error { engineRuns++; return nil }
	if err := Restore(context.Background(), d, p, false); err != nil {
		t.Fatal(err)
	}
	b, _ := os.ReadFile(filepath.Join(d.RepoDir, ".env"))
	if string(b) != "B=2\nCOMPOSE_PROJECT_NAME=projectachilles\n" {
		t.Fatalf(".env = %q", b)
	}
	if fi, _ := os.Stat(filepath.Join(d.CADir, "root.key")); fi.Mode().Perm() != 0o600 {
		t.Fatalf("root.key mode %v", fi.Mode().Perm())
	}
	if fi, _ := os.Stat(d.CADir); fi.Mode().Perm() != 0o700 {
		t.Fatalf("ca dir mode %v", fi.Mode().Perm())
	}
	if fi, _ := os.Stat(filepath.Join(d.CADir, "public")); fi.Mode().Perm() != 0o755 {
		t.Fatalf("public dir mode %v", fi.Mode().Perm())
	}
	// The config was restored, so the engine (not a bare compose up) starts
	// the stack.
	if !f.has("stop") || engineRuns != 1 || f.has("up -d") {
		t.Fatalf("engine runs %d, calls: %v", engineRuns, f.calls)
	}
	if _, err := ca.Load(d.CADir); err != nil {
		t.Fatalf("restored CA must load: %v", err)
	}
}

// ctxCmd gives the handler the context, for tests that block until cancelled.
type ctxCmd struct {
	fakeCmd
	h func(ctx context.Context, c call) ([]byte, error)
}

func (f *ctxCmd) Run(ctx context.Context, name string, args ...string) ([]byte, error) {
	c := call{name, args}
	f.mu.Lock()
	f.calls = append(f.calls, c)
	f.mu.Unlock()
	return f.h(ctx, c)
}

func TestBackupCancelledMidwayRestartsStackAndRemovesStage(t *testing.T) {
	f := &ctxCmd{}
	f.h = func(ctx context.Context, c call) ([]byte, error) {
		if c.name == "docker" && len(c.args) > 0 && c.args[0] == "run" {
			<-ctx.Done() // the volume copy is "running" until the signal
			return nil, ctx.Err()
		}
		return nil, nil
	}
	d := backupDeps(t, &fakeCmd{})
	d.Cmd = f
	ctx, cancel := context.WithCancel(context.Background())
	go func() {
		for {
			f.mu.Lock()
			n := len(f.calls)
			f.mu.Unlock()
			if n >= 3 { // stop, volume inspect, run
				cancel()
				return
			}
			time.Sleep(time.Millisecond)
		}
	}()
	if _, err := Backup(ctx, d, ""); err == nil {
		t.Fatal("expected error")
	}
	if last := f.calls[len(f.calls)-1].String(); !strings.HasSuffix(last, "start") {
		t.Fatalf("start must run after cancel, last = %s", last)
	}
	ents, _ := os.ReadDir(d.BackupDir)
	if len(ents) != 0 {
		t.Fatalf("stage dir left behind: %v", ents)
	}
}

// evilArchive writes a .tar.gz with the given headers.
func evilArchive(t *testing.T, hs ...*tar.Header) string {
	t.Helper()
	p := filepath.Join(t.TempDir(), "evil.tar.gz")
	fh, _ := os.Create(p)
	gz := gzip.NewWriter(fh)
	tw := tar.NewWriter(gz)
	for _, h := range hs {
		if h.Typeflag == tar.TypeReg {
			h.Size = 1
		}
		if err := tw.WriteHeader(h); err != nil {
			t.Fatal(err)
		}
		if h.Typeflag == tar.TypeReg {
			_, _ = tw.Write([]byte("x"))
		}
	}
	tw.Close()
	gz.Close()
	fh.Close()
	return p
}

func TestRestoreRefusesUnsafeGzipArchives(t *testing.T) {
	cases := map[string]*tar.Header{
		"symlink":       {Name: "files/.env", Typeflag: tar.TypeSymlink, Linkname: "/etc/shadow", Mode: 0o777},
		"nested-dotdot": {Name: "a/../../x", Typeflag: tar.TypeReg, Mode: 0o600},
		"dotdot":        {Name: "../escape", Typeflag: tar.TypeReg, Mode: 0o600},
		"hardlink":      {Name: "files/.env", Typeflag: tar.TypeLink, Linkname: "/etc/shadow", Mode: 0o600},
	}
	for name, h := range cases {
		t.Run(name, func(t *testing.T) {
			f := helperFake(false)
			d := backupDeps(t, f)
			before, _ := os.ReadFile(filepath.Join(d.RepoDir, ".env"))
			err := Restore(context.Background(), d, evilArchive(t, &tar.Header{Name: "MANIFEST", Typeflag: tar.TypeReg, Mode: 0o600}, h), true)
			if err == nil {
				t.Fatal("expected refusal")
			}
			if f.has("stop") || f.has("up -d") {
				t.Fatalf("nothing may be stopped: %v", f.calls)
			}
			after, _ := os.ReadFile(filepath.Join(d.RepoDir, ".env"))
			if string(before) != string(after) {
				t.Fatal("files were written")
			}
		})
	}
}

func TestRestoreRefusesUnsafeZstdArchives(t *testing.T) {
	for name, listing := range map[string]string{"dotdot": "MANIFEST\n../escape\n", "symlink": "MANIFEST\nfiles/.env\n"} {
		t.Run(name, func(t *testing.T) {
			f := &fakeCmd{}
			f.handler = func(c call) ([]byte, error) {
				s := c.String()
				switch {
				case strings.Contains(s, "-tf"):
					return []byte(listing), nil
				case strings.Contains(s, "-xf"): // the container "extracts" a symlink
					for _, a := range c.args {
						if strings.HasSuffix(a, ":/s") {
							st := strings.TrimSuffix(a, ":/s")
							_ = os.WriteFile(filepath.Join(st, "MANIFEST"), []byte("m"), 0o600)
							_ = os.MkdirAll(filepath.Join(st, "files"), 0o700)
							_ = os.Symlink("/etc/shadow", filepath.Join(st, "files", ".env"))
						}
					}
				}
				return nil, nil
			}
			d := backupDeps(t, f)
			z := filepath.Join(t.TempDir(), "b.tar.zst")
			_ = os.WriteFile(z, []byte("z"), 0o600)
			before, _ := os.ReadFile(filepath.Join(d.RepoDir, ".env"))
			if err := Restore(context.Background(), d, z, true); err == nil {
				t.Fatal("expected refusal")
			}
			if f.has("compose") {
				t.Fatalf("nothing may be stopped: %v", f.calls)
			}
			after, _ := os.ReadFile(filepath.Join(d.RepoDir, ".env"))
			if string(before) != string(after) {
				t.Fatal("files were written")
			}
		})
	}
}

// zstdFake lets the zstd probe pass and the helper "compress" into /o as 0644.
func zstdFake() *fakeCmd {
	inner := helperFake(false)
	return &fakeCmd{handler: func(c call) ([]byte, error) {
		s := c.String()
		if strings.Contains(s, "command -v zstd") {
			return nil, nil
		}
		if strings.Contains(s, "--zstd -cf") {
			for _, a := range c.args {
				if strings.HasSuffix(a, ":/o") {
					out := strings.TrimSuffix(a, ":/o")
					for _, b := range c.args {
						if strings.HasPrefix(b, "/o/") {
							_ = os.WriteFile(filepath.Join(out, filepath.Base(b)), []byte("z"), 0o644)
						}
					}
				}
			}
			return nil, nil
		}
		return inner.handler(c)
	}}
}

func TestBackupZstdModeAndNoPartialOnRenameFailure(t *testing.T) {
	d := backupDeps(t, zstdFake())
	d.Now = func() time.Time { return time.Date(2026, 10, 21, 1, 2, 3, 0, time.UTC) }
	p, err := Backup(context.Background(), d, "")
	if err != nil {
		t.Fatal(err)
	}
	if fi, _ := os.Stat(p); !strings.HasSuffix(p, ".tar.zst") || fi.Mode().Perm() != 0o600 {
		t.Fatalf("%s mode %v", p, fi.Mode())
	}

	// Rename fails: the final name is a non-empty directory.
	d = backupDeps(t, zstdFake())
	d.Now = func() time.Time { return time.Date(2026, 10, 21, 1, 2, 3, 0, time.UTC) }
	blocker := filepath.Join(d.BackupDir, "20261021T010203Z.tar.zst")
	_ = os.MkdirAll(filepath.Join(blocker, "x"), 0o700)
	if _, err := Backup(context.Background(), d, ""); err == nil {
		t.Fatal("expected rename failure")
	}
	filepath.WalkDir(d.BackupDir, func(p string, _ os.DirEntry, _ error) error {
		if strings.Contains(p, "partial") || strings.Contains(filepath.Base(p), ".out-") || strings.Contains(filepath.Base(p), ".stage-") {
			t.Errorf("left behind: %s", p)
		}
		return nil
	})
}

// Upgrade runs the new checkout's engine with this (old) binary, so it says
// how to update the installer itself.
func TestUpgradePrintsInstallerUpdateNotice(t *testing.T) {
	var ran bool
	f := gitFake("", "", "v2.3.0\nv2.4.0\n", "v2.3.0")
	var out strings.Builder
	d := upgradeDeps(t, f, nil, &ran)
	d.Out, d.InstallerVersion = &out, "v2.3.0"
	if err := Upgrade(context.Background(), d, "", true); err != nil {
		t.Fatal(err)
	}
	want := "This installer binary is v2.3.0; the checkout is now v2.4.0. To update the installer itself, run: sudo " +
		filepath.Join(d.RepoDir, "scripts", "install-onprem.sh") + " --dir " + d.RepoDir + " --ref v2.4.0 --no-run"
	if !strings.Contains(out.String(), want) {
		t.Fatalf("missing notice %q in:\n%s", want, out.String())
	}

	// A binary already at the target has nothing to update.
	out.Reset()
	f = gitFake("", "", "v2.3.0\nv2.4.0\n", "v2.3.0")
	d = upgradeDeps(t, f, nil, &ran)
	d.Out, d.InstallerVersion = &out, "v2.4.0"
	if err := Upgrade(context.Background(), d, "", true); err != nil {
		t.Fatal(err)
	}
	if strings.Contains(out.String(), "To update the installer itself") {
		t.Fatalf("notice printed for a matching binary:\n%s", out.String())
	}
}

// Every helper container runs a pinned Alpine release line, never the
// floating "alpine" (latest) tag.
func TestBackupHelperImagePinned(t *testing.T) {
	if !regexp.MustCompile(`^alpine:3\.\d+$`).MatchString(helperImage) {
		t.Fatalf("helperImage = %q, want alpine:3.<minor>", helperImage)
	}
	f := helperFake(false)
	if _, err := Backup(context.Background(), backupDeps(t, f), ""); err != nil {
		t.Fatal(err)
	}
	runs := 0
	for _, c := range f.calls {
		if c.name != "docker" || len(c.args) == 0 || c.args[0] != "run" {
			continue
		}
		runs++
		for _, a := range c.args {
			if a == "alpine" {
				t.Errorf("unpinned alpine in %s", c)
			}
		}
		if !strings.Contains(c.String(), " "+helperImage+" ") {
			t.Errorf("docker run without %s: %s", helperImage, c)
		}
	}
	if runs == 0 {
		t.Fatal("backup ran no helper container")
	}
}

func TestRestoreRefusesUnsafeVolumeArchiveNames(t *testing.T) {
	for _, name := range []string{"$(touch pwned)_esdata.tar", "a b_esdata.tar", `a"b_esdata.tar`, "x;id_esdata.tar"} {
		f := helperFake(false)
		d := backupDeps(t, f)
		p := evilArchive(t,
			&tar.Header{Name: "MANIFEST", Typeflag: tar.TypeReg, Mode: 0o600},
			&tar.Header{Name: "volumes/" + name, Typeflag: tar.TypeReg, Mode: 0o600})
		f.calls = nil
		if err := Restore(context.Background(), d, p, true); err == nil {
			t.Fatalf("%q: expected refusal", name)
		}
		if f.has("compose") || f.has("volume") || f.has("docker run") {
			t.Fatalf("%q: nothing may run: %v", name, f.calls)
		}
	}
}

func TestRestoreShellCommandsCarryNoArchiveNames(t *testing.T) {
	f := helperFake(false)
	d := backupDeps(t, f)
	p, err := Backup(context.Background(), d, "")
	if err != nil {
		t.Fatal(err)
	}
	f.calls = nil
	if err := Restore(context.Background(), d, p, true); err != nil {
		t.Fatal(err)
	}
	for _, c := range f.calls {
		for i, a := range c.args {
			if a == "-c" && i > 0 && c.args[i-1] == "sh" {
				if i+1 < len(c.args) && strings.Contains(c.args[i+1], ".tar") && strings.Contains(c.args[i+1], "_esdata") {
					t.Fatalf("archive name in sh -c: %v", c)
				}
			}
		}
	}
}

func TestProjectNameResolution(t *testing.T) {
	repo := filepath.Join(t.TempDir(), "-Pa.Test")
	if err := os.MkdirAll(repo, 0o755); err != nil {
		t.Fatal(err)
	}
	d := Deps{RepoDir: repo}
	t.Setenv("COMPOSE_PROJECT_NAME", "")
	if got := d.project(); got != "patest" {
		t.Fatalf("no .env: project = %q, want the normalised directory name", got)
	}
	_ = os.WriteFile(filepath.Join(repo, ".env"), []byte("A=1\nCOMPOSE_PROJECT_NAME=old\nCOMPOSE_PROJECT_NAME=achilles-server\n"), 0o600)
	if got := d.project(); got != "achilles-server" {
		t.Fatalf(".env: project = %q, want the last .env value", got)
	}
	t.Setenv("COMPOSE_PROJECT_NAME", "from-env")
	if got := d.project(); got != "from-env" {
		t.Fatalf("env: project = %q, want the environment to beat .env", got)
	}
	d.Project = "explicit"
	if got := d.project(); got != "explicit" {
		t.Fatalf("explicit: project = %q", got)
	}
}

// A backup from an install that predates the pinned project name restores
// into the live project, and the restored .env keeps naming it, so `up`
// does not start on a fresh set of empty volumes.
func TestRestoreKeepsLiveComposeProject(t *testing.T) {
	t.Setenv("COMPOSE_PROJECT_NAME", "")
	f := helperFake(false)
	d := backupDeps(t, f)
	d.Project = ""
	p, err := Backup(context.Background(), d, "")
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(d.RepoDir, ".env"), []byte("COMPOSE_PROJECT_NAME=achilles-server\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	f.calls = nil
	if err := Restore(context.Background(), d, p, true); err != nil {
		t.Fatal(err)
	}
	b, _ := os.ReadFile(filepath.Join(d.RepoDir, ".env"))
	if string(b) != "B=2\nCOMPOSE_PROJECT_NAME=achilles-server\n" {
		t.Fatalf(".env = %q", b)
	}
	if fi, _ := os.Stat(filepath.Join(d.RepoDir, ".env")); fi.Mode().Perm() != 0o600 {
		t.Fatalf(".env mode %v", fi.Mode().Perm())
	}
	if !f.has("achilles-server_achilles-data:/v") {
		t.Fatalf("volume not restored into the live project: %v", f.calls)
	}
}
