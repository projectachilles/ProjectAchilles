package day2

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/projectachilles/ProjectAchilles/installer/internal/config"
)

// restoreFake is helperFake plus `docker ps`, which lists containers (ids,
// one per line) for the compose project, and an optionally failing stop.
func restoreFake(containers string, stopErr error) *fakeCmd {
	inner := helperFake(false)
	return &fakeCmd{handler: func(c call) ([]byte, error) {
		s := c.String()
		switch {
		case c.name == "docker" && len(c.args) > 0 && c.args[0] == "ps":
			return []byte(containers), nil
		case strings.HasSuffix(s, " stop") && stopErr != nil:
			return nil, stopErr
		}
		return inner.handler(c)
	}}
}

// writeConfig writes a deploy.config.env with bindIP into repo.
func writeConfig(t *testing.T, repo, bindIP string) {
	t.Helper()
	c := config.Config{AchillesDomain: "achilles.test", TLSMode: "internal", CaddyBindIP: bindIP}
	if err := c.Write(filepath.Join(repo, "deploy.config.env")); err != nil {
		t.Fatal(err)
	}
}

// sourceBackup writes a backup from an installed server whose config binds
// to bindIP ("" for no deploy.config.env at all) and whose root .env holds
// rootEnv.
func sourceBackup(t *testing.T, bindIP, rootEnv string) string {
	t.Helper()
	d := backupDeps(t, helperFake(false))
	if err := os.WriteFile(filepath.Join(d.RepoDir, ".env"), []byte(rootEnv), 0o600); err != nil {
		t.Fatal(err)
	}
	if bindIP == "" {
		if err := os.Remove(filepath.Join(d.RepoDir, "deploy.config.env")); err != nil {
			t.Fatal(err)
		}
	} else {
		writeConfig(t, d.RepoDir, bindIP)
	}
	p, err := Backup(context.Background(), d, "")
	if err != nil {
		t.Fatal(err)
	}
	return p
}

// freshDeps is a server that was never installed: an empty checkout, no CA,
// no root .env.
func freshDeps(t *testing.T, f *fakeCmd, out *strings.Builder, engineRuns *int, local bool) Deps {
	t.Helper()
	t.Setenv("COMPOSE_PROJECT_NAME", "")
	return Deps{
		Cmd: f, RepoDir: t.TempDir(), CADir: filepath.Join(t.TempDir(), "ca"),
		Out: out, In: strings.NewReader(""),
		RunEngine:  func(context.Context) error { *engineRuns++; return nil },
		HasLocalIP: func(string) (bool, error) { return local, nil },
	}
}

func stopCalled(f *fakeCmd) bool {
	for _, c := range f.calls {
		if strings.HasSuffix(c.String(), " stop") {
			return true
		}
	}
	return false
}

func TestRestoreFreshHostSkipsStop(t *testing.T) {
	p := sourceBackup(t, "10.0.2.15", "B=2\nCOMPOSE_PROJECT_NAME=achilles-server\n")
	f := restoreFake("", nil)
	var out strings.Builder
	runs := 0
	d := freshDeps(t, f, &out, &runs, true)
	if err := Restore(context.Background(), d, p, true); err != nil {
		t.Fatalf("restore: %v\n%s", err, out.String())
	}
	if stopCalled(f) {
		t.Fatalf("compose stop ran on a server with no containers: %v", f.calls)
	}
	if !f.has("label=com.docker.compose.project=achilles-server") {
		t.Fatalf("no container check for the project: %v", f.calls)
	}
	for _, v := range backedUpVolumes {
		if !f.has("achilles-server_" + v + ":/v") {
			t.Errorf("volume %s not restored: %v", v, f.calls)
		}
	}
	for _, rel := range []string{"deploy.config.env", ".env", "backend/.env"} {
		if _, err := os.Stat(filepath.Join(d.RepoDir, rel)); err != nil {
			t.Errorf("%s not restored: %v", rel, err)
		}
	}
	if b, _ := os.ReadFile(filepath.Join(d.RepoDir, ".env")); string(b) != "B=2\nCOMPOSE_PROJECT_NAME=achilles-server\n" {
		t.Errorf(".env = %q", b)
	}
	if runs != 1 {
		t.Fatalf("engine runs = %d, want 1", runs)
	}
	if f.has("up -d") {
		t.Fatalf("the engine starts the stack; compose up must not run too: %v", f.calls)
	}
}

// A never-installed server has no live project: the restore takes the one
// the backup's .env pinned, else the engine's default (achilles-server),
// which is also what the appliance's pre-built images are named after.
func TestRestoreFreshHostProjectName(t *testing.T) {
	for _, tc := range []struct{ rootEnv, want string }{
		{"B=2\nCOMPOSE_PROJECT_NAME=custom-proj\n", "custom-proj"},
		{"B=2\n", "achilles-server"},
		{"B=2\nCOMPOSE_PROJECT_NAME=Bad Name!\n", "achilles-server"},
	} {
		p := sourceBackup(t, "10.0.2.15", tc.rootEnv)
		f := restoreFake("", nil)
		var out strings.Builder
		runs := 0
		d := freshDeps(t, f, &out, &runs, true)
		if err := Restore(context.Background(), d, p, true); err != nil {
			t.Fatalf("%q: %v", tc.rootEnv, err)
		}
		if !f.has(tc.want + "_achilles-data:/v") {
			t.Errorf("%q: volumes not restored into %s: %v", tc.rootEnv, tc.want, f.calls)
		}
		if got := envFileValue(filepath.Join(d.RepoDir, ".env"), "COMPOSE_PROJECT_NAME"); got != tc.want {
			t.Errorf("%q: .env pins %q, want %q", tc.rootEnv, got, tc.want)
		}
	}
}

func TestRestoreStopFailureWithContainersIsError(t *testing.T) {
	p := sourceBackup(t, "10.0.2.15", "B=2\n")
	f := restoreFake("3f2a1b\n", errors.New("compose: boom"))
	var out strings.Builder
	runs := 0
	d := freshDeps(t, f, &out, &runs, true)
	d.Project = "achilles-server"
	err := Restore(context.Background(), d, p, true)
	if err == nil || !strings.Contains(err.Error(), "stopping the stack") {
		t.Fatalf("err = %v", err)
	}
	if f.has(":/v") || runs != 0 {
		t.Fatalf("nothing may be restored or started after a failed stop: runs=%d calls=%v", runs, f.calls)
	}
}

func TestRestoreRunsEngineWhenConfigPresent(t *testing.T) {
	p := sourceBackup(t, "10.0.5.20", "B=2\n")
	f := restoreFake("3f2a1b\n", nil)
	var out strings.Builder
	runs := 0
	d := freshDeps(t, f, &out, &runs, true)
	d.Project = "achilles-server"
	var asked string
	d.HasLocalIP = func(ip string) (bool, error) { asked = ip; return true, nil }
	if err := Restore(context.Background(), d, p, true); err != nil {
		t.Fatalf("restore: %v\n%s", err, out.String())
	}
	if !stopCalled(f) {
		t.Fatalf("an installed stack must be stopped first: %v", f.calls)
	}
	if asked != "10.0.5.20" {
		t.Errorf("address checked = %q, want the restored config's CADDY_BIND_IP", asked)
	}
	if runs != 1 || f.has("up -d") {
		t.Fatalf("engine runs = %d, compose up = %v; want the engine only", runs, f.has("up -d"))
	}

	// A failing engine run fails the restore, and says the data is back.
	f = restoreFake("3f2a1b\n", nil)
	d = freshDeps(t, f, &out, &runs, true)
	d.RunEngine = func(context.Context) error { return errors.New("engine exit 3") }
	err := Restore(context.Background(), d, p, true)
	if err == nil || !strings.Contains(err.Error(), "engine exit 3") {
		t.Fatalf("err = %v", err)
	}
}

func TestRestoreFallsBackToUpWithoutConfig(t *testing.T) {
	p := sourceBackup(t, "", "B=2\n")
	f := restoreFake("", nil)
	var out strings.Builder
	runs := 0
	d := freshDeps(t, f, &out, &runs, true)
	if err := Restore(context.Background(), d, p, true); err != nil {
		t.Fatalf("restore: %v\n%s", err, out.String())
	}
	if runs != 0 || !f.has("up -d") {
		t.Fatalf("engine runs = %d, compose up = %v; want compose up only", runs, f.has("up -d"))
	}
	if !strings.Contains(out.String(), "this backup has no deploy.config.env; it can be restored only onto this server") {
		t.Fatalf("missing warning:\n%s", out.String())
	}
}

func TestRestoreStopsWhenBindIPNotLocal(t *testing.T) {
	p := sourceBackup(t, "10.0.5.20", "B=2\n")
	f := restoreFake("", nil)
	var out strings.Builder
	runs := 0
	d := freshDeps(t, f, &out, &runs, false)
	err := Restore(context.Background(), d, p, true)
	if err == nil {
		t.Fatal("want a non-nil error (non-zero exit)")
	}
	want := "The backup's server address 10.0.5.20 is not on this server. Run `sudo " +
		filepath.Join(d.RepoDir, "achilles-installer") +
		" install` and choose Reconfigure to set this server's address (your data and CA are kept)."
	if !strings.Contains(out.String(), want) {
		t.Fatalf("want %q in:\n%s", want, out.String())
	}
	if runs != 0 || f.has("up -d") {
		t.Fatalf("nothing may start: runs=%d calls=%v", runs, f.calls)
	}
	// The data stays restored.
	if !f.has("_achilles-data:/v") {
		t.Fatalf("volumes not restored: %v", f.calls)
	}
	if _, err := os.Stat(filepath.Join(d.RepoDir, "backend", ".env")); err != nil {
		t.Fatalf("backend/.env not restored: %v", err)
	}
}

// The default checkout gives the message's exact text.
func TestNewAddressMessageDefaultCheckout(t *testing.T) {
	want := "The backup's server address 10.0.5.20 is not on this server. Run `sudo /opt/projectachilles/achilles-installer install` and choose Reconfigure to set this server's address (your data and CA are kept)."
	if got := newAddressMessage("/opt/projectachilles", "10.0.5.20"); got != want {
		t.Fatalf("got  %q\nwant %q", got, want)
	}
}

// A bracketed IPv6 CADDY_BIND_IP is checked bare.
func TestRestoreBindIPv6Bracketed(t *testing.T) {
	p := sourceBackup(t, "[fd00::5]", "B=2\n")
	f := restoreFake("", nil)
	var out strings.Builder
	runs := 0
	d := freshDeps(t, f, &out, &runs, true)
	var asked string
	d.HasLocalIP = func(ip string) (bool, error) { asked = ip; return true, nil }
	if err := Restore(context.Background(), d, p, true); err != nil {
		t.Fatal(err)
	}
	if asked != "fd00::5" {
		t.Fatalf("asked %q", asked)
	}
}

func TestBackupWarnsWithoutConfig(t *testing.T) {
	d := backupDeps(t, helperFake(false))
	if err := os.Remove(filepath.Join(d.RepoDir, "deploy.config.env")); err != nil {
		t.Fatal(err)
	}
	var out strings.Builder
	d.Out = &out
	if _, err := Backup(context.Background(), d, ""); err != nil {
		t.Fatalf("a missing config must not fail the backup: %v", err)
	}
	if !strings.Contains(out.String(), "this backup has no deploy.config.env; it can be restored only onto this server") {
		t.Fatalf("missing warning:\n%s", out.String())
	}

	// With the config there is no warning.
	d = backupDeps(t, helperFake(false))
	out.Reset()
	d.Out = &out
	if _, err := Backup(context.Background(), d, ""); err != nil {
		t.Fatal(err)
	}
	if strings.Contains(out.String(), "no deploy.config.env") {
		t.Fatalf("warning printed with the config present:\n%s", out.String())
	}
}
