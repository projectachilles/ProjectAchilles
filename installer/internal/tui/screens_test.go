package tui

// Flow tests for the second half of the wizard: login, analytics,
// organisation, review, install and done. They use the driver and fakes in
// app_test.go, plus a fake engine.

import (
	"context"
	"encoding/base64"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"

	tea "charm.land/bubbletea/v2"

	"github.com/projectachilles/ProjectAchilles/installer/internal/ca"
	"github.com/projectachilles/ProjectAchilles/installer/internal/clerkadmin"
	"github.com/projectachilles/ProjectAchilles/installer/internal/config"
	"github.com/projectachilles/ProjectAchilles/installer/internal/engine"
)

// ---------------------------------------------------------------------------
// Clerk keys
// ---------------------------------------------------------------------------

func pkFor(live bool, fapiHost string) string {
	prefix := "pk_test_"
	if live {
		prefix = "pk_live_"
	}
	return prefix + base64.StdEncoding.EncodeToString([]byte(fapiHost+"$"))
}

const (
	devFAPI  = "happy-cat-12.clerk.accounts.dev"
	testSK   = "sk_test_SECRETVALUE0123456789abcd"
	testGHPA = "ghp_tokenvalue000000000009876"
)

var devPK = pkFor(false, devFAPI)

// ---------------------------------------------------------------------------
// Fake engine
// ---------------------------------------------------------------------------

type fakeExit int

func (e fakeExit) Error() string { return fmt.Sprintf("exit status %d", int(e)) }
func (e fakeExit) ExitCode() int { return int(e) }

// fakeRun is one scripted engine run. With hold set, the run blocks after
// its events until hold is closed or the context is cancelled.
type fakeRun struct {
	events []engine.Event
	err    error
	hold   chan struct{}
}

// fakeEngine hands out one scripted run per Runner call (the last one
// repeats) and records the config each run was created with.
type fakeEngine struct {
	mu      sync.Mutex
	runs    []fakeRun
	configs []config.Config
}

func (f *fakeEngine) runner(c config.Config) engine.Starter {
	f.mu.Lock()
	defer f.mu.Unlock()
	r := f.runs[min(len(f.configs), len(f.runs)-1)]
	f.configs = append(f.configs, c)
	return fakeStarter{r}
}

func (f *fakeEngine) started() int {
	f.mu.Lock()
	defer f.mu.Unlock()
	return len(f.configs)
}

type fakeStarter struct{ r fakeRun }

func (s fakeStarter) Start(ctx context.Context) (<-chan engine.Event, func() error, error) {
	ch := make(chan engine.Event)
	done := make(chan struct{})
	var err error
	go func() {
		defer close(done)
		defer close(ch)
		for _, ev := range s.r.events {
			select {
			case ch <- ev:
			case <-ctx.Done():
				err = ctx.Err()
				return
			}
		}
		if s.r.hold != nil {
			select {
			case <-s.r.hold:
			case <-ctx.Done():
				err = ctx.Err()
				return
			}
		}
		err = s.r.err
	}()
	return ch, func() error { <-done; return err }, nil
}

var phaseTitles = map[string]string{
	"config": "Loading configuration", "validate": "Validating settings", "docker": "Checking Docker",
	"ca": "Preparing the ProjectAchilles CA", "caddy-render": "Configuring Caddy TLS (achilles-ca)",
	"backend-env": "Writing backend/.env", "root-env": "Writing root .env",
	"firewall":  "Opening 80/443 to the LAN subnets",
	"up":        "Building and starting the stack (this can take several minutes)",
	"ca-export": "Exporting Caddy internal root CA for agents/browsers",
	"bootstrap": "Rendering endpoint bootstrap scripts", "renew-timer": "Installing the weekly CA renewal timer",
}

// phases emits Phase + a log line + OK for each id.
func phases(ids ...string) []engine.Event {
	var evs []engine.Event
	for _, id := range ids {
		evs = append(evs,
			engine.Event{Kind: engine.Phase, ID: id, Text: phaseTitles[id]},
			engine.Event{Kind: engine.Log, Text: "  doing " + id},
			engine.Event{Kind: engine.OK, ID: id})
	}
	return evs
}

// achillesPhases is what an achilles-ca run emits (no ca-export).
var achillesPhases = []string{"config", "validate", "docker", "ca", "caddy-render", "backend-env",
	"root-env", "firewall", "up", "bootstrap", "renew-timer"}

func okRun() fakeRun { return fakeRun{events: phases(achillesPhases...)} }

// failUpRun fails in `up` after 40 log lines.
func failUpRun() fakeRun {
	evs := phases("config", "validate", "docker", "ca", "caddy-render", "backend-env", "root-env", "firewall")
	evs = append(evs, engine.Event{Kind: engine.Phase, ID: "up", Text: phaseTitles["up"]})
	for i := 1; i <= 40; i++ {
		evs = append(evs, engine.Event{Kind: engine.Log, Text: fmt.Sprintf("#%d building layer %d", i, i)})
	}
	evs = append(evs, engine.Event{Kind: engine.Fail, ID: "up", Text: "docker compose up failed (see the output above)."})
	return fakeRun{events: evs, err: fakeExit(1)}
}

// ---------------------------------------------------------------------------
// Walk helpers
// ---------------------------------------------------------------------------

// focus waits until the form field titled title has focus (huh moves focus
// asynchronously, so typing straight after enter could land in the previous
// field).
func (d *driver) focus(title string) {
	d.t.Helper()
	d.waitText("┃ " + title)
}

// passCertsCA takes the ProjectAchilles CA defaults (zone, no IP).
// quitRunning aborts while the engine runs: ctrl+c asks first, a second
// ctrl+c stops the engine and quits.
func (d *driver) quitRunning() *App {
	d.t.Helper()
	d.ctrlC()
	d.waitText("Stop the install?")
	d.ctrlC()
	return d.final()
}

func (d *driver) passCertsCA() {
	d.t.Helper()
	d.waitText("Certificates", "ProjectAchilles CA")
	d.enter()
	d.waitText("name-constrained")
	d.enter()
	d.waitText("the IP " + testIP)
	d.enter()
}

func (d *driver) passLogin(pk, sk string) {
	d.t.Helper()
	d.waitText("Login (Clerk)")
	d.focus("Clerk publishable key")
	d.typ(pk)
	d.enter()
	d.focus("Clerk secret key")
	d.typ(sk)
	d.enter()
}

// passAdmin leaves the optional first admin email blank.
func (d *driver) passAdmin() {
	d.t.Helper()
	d.focus("First admin email (optional: invited as admin)")
	d.enter()
}

func (d *driver) passAnalyticsSelf() {
	d.t.Helper()
	d.waitText("Where should Elasticsearch run?")
	d.enter() // self-hosted (default)
	d.waitText("Load demo data?")
	d.enter() // No (default)
}

func (d *driver) passOrg(name, token string) {
	d.t.Helper()
	d.focus("Organisation name")
	d.typ(name)
	d.enter()
	d.focus("Test library repository")
	d.enter() // default repo
	d.focus("Test library branch")
	d.enter() // default branch
	d.focus("GitHub token")
	d.typ(token)
	d.enter()
}

// toReview walks a new install with the ProjectAchilles CA, development
// keys and self-hosted ES up to the Review screen.
func (d *driver) toReview() string {
	d.t.Helper()
	d.toCerts(testHost)
	d.passCertsCA()
	d.passLogin(devPK, testSK)
	d.passAdmin()
	d.passAnalyticsSelf()
	d.passOrg("Acme Corp", testGHPA)
	return d.waitText("Review", "Yes, install")
}

// ---------------------------------------------------------------------------
// Login
// ---------------------------------------------------------------------------

func TestLoginBlocksOnLiveKeyForPrivateZone(t *testing.T) {
	deps := testDeps(t)
	deps.Resolver = fakeResolver{hosts: map[string][]string{"achilles.corp.lan": {testIP}}}
	d := start(t, deps, nil)
	d.passWelcome()
	d.passPreflight()
	d.passNetwork("achilles.corp.lan", 0)
	d.passCertsCA()
	d.passLogin(pkFor(true, "clerk.corp.lan"), "sk_live_abcdefghijklmnop")
	f := d.waitText("need a public domain")
	if !strings.Contains(f, "Clerk publishable key") || strings.Contains(f, "Elasticsearch") {
		t.Fatalf("left the login screen with an error finding:\n%s", f)
	}
	d.enter()
	if f := d.waitText("need a public domain"); strings.Contains(f, "Where should Elasticsearch run?") {
		t.Fatalf("a second enter got past the error:\n%s", f)
	}
	if a := d.quit(); a.cfg.ClerkPublishableKey != "" {
		t.Fatalf("blocked keys were applied: %q", a.cfg.ClerkPublishableKey)
	}
}

func TestLoginLiveKeyAsksAboutClerkDNS(t *testing.T) {
	d := start(t, testDeps(t), nil)
	d.toCerts(testHost)
	d.passCertsCA()
	d.passLogin(pkFor(true, "clerk.corp.example.com"), "sk_live_abcdefghijklmnop")
	d.passAdmin()
	f := d.waitText("Have you published the DNS records Clerk lists?")
	if !strings.Contains(f, "clerk.corp.example.com") {
		t.Errorf("FAPI host not shown:\n%s", f)
	}
	d.enter() // Yes
	d.waitText("Where should Elasticsearch run?")
	if c := d.quit().cfg; c.ClerkSecretKey != "sk_live_abcdefghijklmnop" || !strings.HasPrefix(c.ClerkPublishableKey, "pk_live_") {
		t.Fatalf("keys not applied: %q %q", c.ClerkPublishableKey, c.ClerkSecretKey)
	}
}

// The Frontend API reachability probe only warns.
func TestLoginProbeWarnsButDoesNotBlock(t *testing.T) {
	deps := testDeps(t)
	deps.System = fakeSys{unreachable: map[string]bool{"https://" + devFAPI + "/v1/environment": true}}
	d := start(t, deps, nil)
	d.toCerts(testHost)
	d.passCertsCA()
	d.focus("Clerk publishable key")
	d.typ(devPK)
	d.waitText(devFAPI, "not reachable")
	d.enter()
	d.focus("Clerk secret key")
	d.typ(testSK)
	d.enter()
	d.focus("First admin email (optional: invited as admin)")
	d.enter()
	d.waitText("Where should Elasticsearch run?")
	d.quit()
}

// ---------------------------------------------------------------------------
// Analytics
// ---------------------------------------------------------------------------

func TestAnalyticsSelfDisabledLowRAM(t *testing.T) {
	deps := testDeps(t)
	deps.System = fakeSys{mem: 3 << 30} // preflight warns; ES self needs 4 GiB
	d := start(t, deps, nil)
	d.passWelcome()
	d.waitText("Preflight", "0 failed", "3.0 GiB RAM")
	d.enter()
	d.passNetwork(testHost, 0)
	d.passCertsCA()
	d.passLogin(devPK, testSK)
	d.passAdmin()
	f := d.waitText("Where should Elasticsearch run?", "isn't available")
	if !strings.Contains(f, "3.0 GiB RAM") {
		t.Errorf("RAM reason missing:\n%s", f)
	}
	if strings.Contains(f, "> Self-hosted") {
		t.Errorf("self-hosted is selectable:\n%s", f)
	}
	d.enter() // the only choice: Elastic Cloud
	d.focus("Elastic Cloud ID")
	d.typ("prod:ZXUtd2VzdC0xLmF3cy5mb3VuZC5pbyQ=")
	d.enter()
	d.focus("Elastic Cloud API key")
	d.typ("es-api-key-0000000000wxyz")
	d.enter()
	d.waitText("Organisation name")
	c := d.quit().cfg
	if c.ESMode != "cloud" || c.ElasticsearchAPIKey != "es-api-key-0000000000wxyz" || c.SeedES != "false" {
		t.Fatalf("ES_MODE=%q key=%q seed=%q", c.ESMode, c.ElasticsearchAPIKey, c.SeedES)
	}
}

func TestAnalyticsSelfWithSeed(t *testing.T) {
	d := start(t, testDeps(t), nil)
	d.toCerts(testHost)
	d.passCertsCA()
	d.passLogin(devPK, testSK)
	d.passAdmin()
	d.waitText("Where should Elasticsearch run?", "Self-hosted on this server")
	d.enter()
	d.waitText("Load demo data?")
	d.press(tea.KeyLeft) // Yes
	d.enter()
	d.waitText("Organisation name")
	if c := d.quit().cfg; c.ESMode != "self" || c.SeedES != "true" {
		t.Fatalf("ES_MODE=%q SEED_ES=%q", c.ESMode, c.SeedES)
	}
}

// ---------------------------------------------------------------------------
// Organisation & content
// ---------------------------------------------------------------------------

func TestOrgNameCounterBlocksAt57(t *testing.T) {
	d := start(t, testDeps(t), nil)
	d.toCerts(testHost)
	d.passCertsCA()
	d.passLogin(devPK, testSK)
	d.passAdmin()
	d.passAnalyticsSelf()
	d.waitText("0 / 56")
	d.focus("Organisation name")
	d.typ(strings.Repeat("a", 57))
	d.waitText("57 / 56")
	d.enter()
	f := d.waitText("at most 56 characters")
	if strings.Contains(f, "Review") {
		t.Fatalf("advanced with a 57-character name:\n%s", f)
	}
	d.press(tea.KeyBackspace)
	d.waitText("56 / 56")
	d.enter() // name accepted: on to the repository field
	d.focus("Test library repository")
	d.enter() // repository (default)
	d.focus("Test library branch")
	d.enter() // branch (default)
	d.focus("GitHub token")
	d.enter() // token (none)
	d.waitText("Review", "Yes, install")
	c := d.quit().cfg
	if len(c.OrganizationName) != 56 {
		t.Fatalf("ORGANIZATION_NAME has %d characters", len(c.OrganizationName))
	}
	if c.TestsRepoURL == "" || c.TestsRepoBranch != "main" || c.AgentRepoURL == "" {
		t.Errorf("repo defaults not applied: %q %q %q", c.TestsRepoURL, c.TestsRepoBranch, c.AgentRepoURL)
	}
}

// ---------------------------------------------------------------------------
// Review
// ---------------------------------------------------------------------------

func TestReviewMasksSecrets(t *testing.T) {
	deps := testDeps(t)
	eng := &fakeEngine{runs: []fakeRun{{hold: make(chan struct{})}}}
	deps.Runner = eng.runner
	d := start(t, deps, nil)
	d.forbid = []string{testSK, "SECRETVALUE", testGHPA, "tokenvalue"}
	f := d.toReview()
	for _, want := range []string{"••••abcd" /* CLERK_SECRET_KEY */, "••••9876" /* GITHUB_TOKEN */, testHost, "Acme Corp"} {
		if !strings.Contains(f, want) {
			t.Errorf("review missing %q:\n%s", want, f)
		}
	}
	// The command may be split with shell line continuations.
	flat := strings.ReplaceAll(strings.Join(strings.Fields(f), " "), " \\ ", " ")
	if cmd := "sudo " + filepath.Join(deps.RepoRoot, "achilles-installer") + " install --config " + deps.ConfigPath + " --yes"; !strings.Contains(flat, cmd) {
		t.Errorf("review missing %q:\n%s", cmd, f)
	}
	if _, err := os.Stat(deps.ConfigPath); !os.IsNotExist(err) {
		t.Fatalf("config written before confirming: %v", err)
	}
	d.enter() // Yes, install
	d.waitText("Installing")
	fi, err := os.Stat(deps.ConfigPath)
	if err != nil || fi.Mode().Perm() != 0o600 {
		t.Fatalf("config after confirm: %v %v", fi, err)
	}
	c, err := config.Load(deps.ConfigPath)
	if err != nil || c.ClerkSecretKey != testSK || c.GithubToken != testGHPA || c.OrganizationName != "Acme Corp" {
		t.Fatalf("written config: %v %+v", err, c)
	}
	if p := c.Validate(); len(p) != 0 {
		t.Errorf("written config does not validate: %v", p)
	}
	if a := d.quitRunning(); a.Outcome().Action != ActionInstallFailed {
		t.Fatalf("outcome = %v, want ActionInstallFailed", a.Outcome().Action)
	}
}

// Existing generated secrets are masked too.
func TestReviewMasksExistingSecrets(t *testing.T) {
	deps := testDeps(t)
	existing := existingConfig()
	existing.SessionSecret = "sessionsecretvalueAAAA1111"
	existing.EncryptionSecret = "encryptionsecretvalueBBBB2222"
	existing.CLIAuthSecret = "cliauthsecretvalueCCCC3333"
	existing.ClerkPublishableKey, existing.ClerkSecretKey = devPK, testSK
	d := start(t, deps, existing)
	d.forbid = []string{testSK, "sessionsecretvalue", "encryptionsecretvalue", "cliauthsecretvalue"}
	d.waitText("Reconfigure")
	d.enter()
	d.passPreflight()
	d.waitText("Network", "ens18")
	d.enter()
	d.waitText("Server hostname", testHost)
	d.enter()
	d.waitText("resolves to " + testIP)
	d.enter()
	d.waitText("LAN subnets")
	d.enter()
	d.passCertsCA()
	d.focus("Clerk publishable key")
	d.enter() // keys pre-filled
	d.focus("Clerk secret key")
	d.enter()
	d.focus("First admin email (optional: invited as admin)")
	d.enter()
	d.passAnalyticsSelf()
	for _, f := range []string{"Organisation name", "Test library repository", "Test library branch", "GitHub token"} {
		d.focus(f)
		d.enter()
	}
	d.waitText("Review", "Yes, install", "••••abcd")
	for range 5 {
		d.down() // the rows scroll when the long temp paths wrap the command
	}
	d.waitText("••••1111", "••••2222", "••••3333")
	d.quit()
}

// ---------------------------------------------------------------------------
// Install
// ---------------------------------------------------------------------------

func TestInstallScreenRetryAfterFail(t *testing.T) {
	deps := testDeps(t)
	mkCA(t, deps, "corp.example.com", false)
	eng := &fakeEngine{runs: []fakeRun{failUpRun(), okRun()}}
	deps.Runner = eng.runner
	d := start(t, deps, nil)
	d.toReview()
	d.enter()
	f := d.waitText("Install failed", "r retry")
	for _, want := range []string{"Building and starting the stack", "docker compose up failed", "#40 building layer 40", "q quit"} {
		if !strings.Contains(f, want) {
			t.Errorf("failure view missing %q:\n%s", want, f)
		}
	}
	d.press('r')
	f = d.waitText("Install complete")
	if eng.started() != 2 {
		t.Fatalf("engine started %d times, want 2", eng.started())
	}
	// ca-export never ran in this mode: skipped, not pending or failed.
	if !strings.Contains(f, "skipped") || strings.Contains(f, "failed") || strings.Contains(f, "pending") {
		t.Errorf("checklist after success:\n%s", f)
	}
	d.enter()
	d.waitText("Done", "ProjectAchilles is installed")
	d.enter()
	a := d.final()
	if a.Outcome().Action != ActionInstall {
		t.Fatalf("outcome = %v, want ActionInstall", a.Outcome().Action)
	}
	if got := eng.configs[1].ClerkSecretKey; got != testSK {
		t.Errorf("retry ran with config sk %q", got)
	}
}

func TestInstallLogKeepsRunsWithSeparator(t *testing.T) {
	deps := testDeps(t)
	eng := &fakeEngine{runs: []fakeRun{failUpRun()}}
	deps.Runner = eng.runner
	d := start(t, deps, nil)
	d.toReview()
	d.enter()
	d.waitText("Install failed")
	d.press('r')
	d.waitFor("second run failed", func(string) bool { return eng.started() == 2 })
	d.waitText("Install failed")
	var lines []string
	ch := make(chan []string, 1)
	d.tm.Send(probeMsg{fn: func(a *App) {
		for _, sc := range a.screens {
			if in, ok := sc.(*installScreen); ok {
				ch <- in.log.all()
			}
		}
	}})
	lines = <-ch
	seps := 0
	for _, l := range lines {
		if strings.Contains(l, "retry 1") {
			seps++
		}
	}
	if seps != 1 || !strings.Contains(strings.Join(lines, "\n"), "#40 building layer 40") {
		t.Fatalf("log across retries: %d separators\n%s", seps, strings.Join(lines, "\n"))
	}
	d.press('q')
	if a := d.final(); a.Outcome().Action != ActionInstallFailed {
		t.Fatalf("outcome = %v, want ActionInstallFailed", a.Outcome().Action)
	}
}

// After a failed run, going back to Review and quitting is still a failed
// install (the server changed), not "nothing was changed".
func TestQuitAfterFailedRunIsNotACancel(t *testing.T) {
	deps := testDeps(t)
	eng := &fakeEngine{runs: []fakeRun{failUpRun()}}
	deps.Runner = eng.runner
	d := start(t, deps, nil)
	d.toReview()
	d.enter()
	d.waitText("Install failed")
	d.esc()
	d.waitText("Review", "Yes, install")
	if a := d.quit(); a.Outcome().Action != ActionInstallFailed {
		t.Fatalf("outcome = %v, want ActionInstallFailed", a.Outcome().Action)
	}
}

func TestLogBufferKeepsLast2000(t *testing.T) {
	var b logBuffer
	for i := range 2500 {
		b.add(fmt.Sprintf("line %d", i))
	}
	all := b.all()
	if len(all) != 2000 || all[0] != "line 500" || all[1999] != "line 2499" {
		t.Fatalf("len=%d first=%q last=%q", len(all), all[0], all[len(all)-1])
	}
}

func TestInstallEscConfirmsCancel(t *testing.T) {
	deps := testDeps(t)
	hold := make(chan struct{})
	eng := &fakeEngine{runs: []fakeRun{
		{events: phases("config", "validate"), hold: hold},
		okRun(),
	}}
	deps.Runner = eng.runner
	d := start(t, deps, nil)
	d.toReview()
	d.enter()
	d.waitText("Installing", "Validating settings")
	d.esc()
	d.waitText("Stop the install?")
	d.enter() // default: keep going
	f := d.waitFor("confirm dismissed", func(f string) bool { return !strings.Contains(f, "Stop the install?") })
	if !strings.Contains(f, "Installing") {
		t.Fatalf("enter on the confirm did not keep the install running:\n%s", f)
	}
	d.esc()
	d.waitText("Stop the install?")
	d.press('y')
	f = d.waitText("Install stopped", "r retry")
	if !strings.Contains(f, "Validating settings") {
		t.Errorf("partial state should name where it stopped:\n%s", f)
	}
	d.press('r')
	d.waitText("Install complete")
	d.quit()
}

// ---------------------------------------------------------------------------
// Done
// ---------------------------------------------------------------------------

func TestDoneShowsFingerprintsAndNoToken(t *testing.T) {
	deps := testDeps(t)
	mkCA(t, deps, "corp.example.com", false)
	b, err := ca.Load(deps.CADir)
	if err != nil {
		t.Fatal(err)
	}
	sha256, thumb := ca.Fingerprints(b.Root)
	eng := &fakeEngine{runs: []fakeRun{okRun()}}
	deps.Runner = eng.runner
	d := start(t, deps, nil)
	d.forbid = []string{testSK, "SECRETVALUE", testGHPA}
	d.toReview()
	d.enter()
	d.waitText("Install complete")
	d.enter()
	f := d.waitText("ProjectAchilles is installed")
	if testing.Verbose() {
		t.Logf("done frame:\n%s", f)
	}
	for _, want := range []string{
		"https://" + testHost, testIP,
		filepath.Join(deps.CADir, "public", "root.cer"),
		filepath.Join(deps.CADir, "public", "root.crt"),
		sha256[:47], sha256[48:], // split over two lines
		thumb, "Windows thumbprint",
		"powershell -ExecutionPolicy Bypass -File bootstrap-windows.ps1 -Token <TOKEN>",
	} {
		if !strings.Contains(f, want) {
			t.Errorf("done frame missing %q:\n%s", want, f)
		}
	}
	// Scroll to the end for the rest.
	for range 30 {
		d.down()
	}
	f = d.waitText("achilles-installer restore")
	if testing.Verbose() {
		t.Logf("done frame (end):\n%s", f)
	}
	full := strings.Join(strings.Fields(doneText(t, d)), " ")
	for _, want := range []string{
		filepath.Join(deps.RepoRoot, "deploy", "onprem", "bootstrap-windows.ps1"),
		filepath.Join(deps.RepoRoot, "deploy", "onprem", "bootstrap-unix.sh"),
		// The scripts are 0644: `sudo ./bootstrap-unix.sh` would not run.
		"sudo bash bootstrap-unix.sh <TOKEN>",
		"Push root.cer via GPO (Computer Configuration → Policies → Windows Settings → Security Settings → Public Key Policies → Trusted Root Certification Authorities). Never put enrollment tokens in GPO/SYSVOL.",
		"Register an agent version in the web UI before enrolling",
		"sudo ./achilles-installer status", "sudo ./achilles-installer upgrade", "sudo ./achilles-installer backup", "sudo ./achilles-installer restore",
	} {
		if !strings.Contains(full, want) {
			t.Errorf("done content missing %q:\n%s", want, full)
		}
	}
	// Only the placeholder: no enrollment token, no secret.
	for _, l := range strings.Split(full, "-Token")[1:] {
		if !strings.HasPrefix(strings.TrimSpace(l), "<TOKEN>") {
			t.Errorf("-Token followed by something other than <TOKEN>: %q", l)
		}
	}
	d.enter()
	a := d.final()
	if s := a.Outcome().Summary; !strings.Contains(s, thumb) || strings.Contains(s, testSK) {
		t.Errorf("summary for the terminal:\n%s", s)
	}
}

// doneText returns the done screen's whole content (all scroll positions),
// unstyled.
func doneText(t *testing.T, d *driver) string {
	t.Helper()
	ch := make(chan string, 1)
	d.tm.Send(probeMsg{fn: func(a *App) {
		for _, sc := range a.screens {
			if dn, ok := sc.(*doneScreen); ok {
				ch <- dn.plain()
			}
		}
	}})
	return <-ch
}

func TestDoneNonCAModesExplainTrust(t *testing.T) {
	for mode, want := range map[string]string{
		"acme-http": "publicly trusted",
		"acme-dns":  "publicly trusted",
		"byo":       "distribute",
		"internal":  "deploy/caddy/certs/root-ca.crt",
	} {
		s := &shared{deps: Deps{RepoRoot: "/opt/projectachilles", CADir: DefaultCADir}, theme: newTheme(true), width: 78, height: 20,
			cfg: &config.Config{TLSMode: mode, AchillesDomain: testHost, CaddyBindIP: testIP}}
		dn := newDone(s)
		dn.Init()
		txt := strings.Join(strings.Fields(dn.plain()), " ")
		if !strings.Contains(txt, want) {
			t.Errorf("%s: missing %q:\n%s", mode, want, txt)
		}
		if strings.Contains(txt, "bootstrap-windows.ps1") || strings.Contains(txt, "Windows thumbprint") {
			t.Errorf("%s: shows the achilles-ca block:\n%s", mode, txt)
		}
	}
}

// The done screen makes ADMIN_EMAIL an admin through Clerk and says what
// happened; without an address (or on failure) it gives the manual steps.
func TestDoneFirstAdmin(t *testing.T) {
	for _, tc := range []struct {
		name, email string
		err         error
		want        []string
	}{
		{"invited", "ops@example.com", nil, []string{"Invitation sent to ops@example.com", "Then sign in at https://" + testHost}},
		{"failed", "ops@example.com", errors.New("HTTP 401: bad key"), []string{"Could not make ops@example.com an admin", "HTTP 401: bad key", `{"role": "admin"}`}},
		{"no email", "", nil, []string{"Sign up at https://" + testHost + "/sign-up", `{"role": "admin"}`}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			calls := 0
			deps := Deps{RepoRoot: "/opt/projectachilles", CADir: DefaultCADir,
				Admin: func(_ context.Context, c config.Config) (clerkadmin.Result, error) {
					calls++
					return clerkadmin.Result{Outcome: clerkadmin.Invited, Email: c.AdminEmail}, tc.err
				}}
			s := &shared{deps: deps, theme: newTheme(true), width: 100, height: 40,
				cfg: &config.Config{TLSMode: "acme-http", AchillesDomain: testHost, AdminEmail: tc.email}}
			dn := newDone(s)
			cmd := dn.Init()
			if tc.email != "" {
				if !strings.Contains(dn.plain(), "Inviting "+tc.email) {
					t.Errorf("no progress line before the result:\n%s", dn.plain())
				}
				dn.Update(cmd())
			} else if cmd != nil {
				t.Fatal("no ADMIN_EMAIL: nothing to run")
			}
			txt := strings.Join(strings.Fields(dn.plain()), " ")
			for _, w := range tc.want {
				if !strings.Contains(txt, w) {
					t.Errorf("missing %q:\n%s", w, dn.plain())
				}
			}
			if s.summary != dn.plain() {
				t.Error("the terminal summary must carry the result")
			}
			if want := map[bool]int{true: 1, false: 0}[tc.email != ""]; calls != want {
				t.Errorf("admin calls = %d, want %d", calls, want)
			}
		})
	}
}

// The enroll command must stay on one line at any width: word-wrap breaks at
// hyphens, and a split "--server" can't be copied. Found on a 100-column
// terminal in the Hetzner test.
func TestDoneEnrollCommandIsOneLine(t *testing.T) {
	want := "achilles-agent --enroll <TOKEN> --server https://" + testHost + " --install"
	for _, w := range []int{60, 78, 100, 140} {
		s := &shared{deps: Deps{RepoRoot: "/opt/projectachilles", CADir: DefaultCADir}, theme: newTheme(true), width: w, height: 20,
			cfg: &config.Config{TLSMode: "acme-http", AchillesDomain: testHost, CaddyBindIP: testIP}}
		dn := newDone(s)
		dn.Init()
		found := false
		for _, l := range strings.Split(dn.plain(), "\n") {
			if strings.TrimSpace(l) == want {
				found = true
			}
		}
		if !found {
			t.Errorf("width %d: no line holds %q:\n%s", w, want, dn.plain())
		}
	}
}

// ---------------------------------------------------------------------------
// 80x24 frames
// ---------------------------------------------------------------------------

func TestFramesLaterScreens(t *testing.T) {
	deps := testDeps(t)
	deps.RepoRoot = "/opt/projectachilles" // shown on review; never written in this walk
	deps.ConfigPath = "/opt/projectachilles/deploy.config.env"
	d := start(t, deps, nil)
	d.forbid = []string{testSK, testGHPA}
	d.toCerts(testHost)
	d.passCertsCA()
	d.focus("Clerk publishable key")
	d.typ(devPK)
	d.enter()
	d.focus("Clerk secret key")
	d.typ(testSK)
	checkGolden(t, "14-login", d.waitText("reachable from this server", "This is a Clerk development key"))
	d.enter()
	d.focus("First admin email (optional: invited as admin)")
	d.typ("admin@example.com")
	d.enter()
	checkGolden(t, "15-analytics", d.waitText("Where should Elasticsearch run?"))
	d.enter()
	checkGolden(t, "16-analytics-seed", d.waitText("Load demo data?"))
	d.enter()
	d.focus("Organisation name")
	d.typ("Acme Corp")
	checkGolden(t, "17-org", d.waitText("9 / 56"))
	d.enter()
	d.focus("Test library repository")
	d.enter()
	d.focus("Test library branch")
	d.enter()
	d.focus("GitHub token")
	d.typ(testGHPA)
	d.enter()
	checkGolden(t, "18-review", d.waitText("Review", "Yes, install"))
	d.quit()
}

func TestFramesLoginLiveAndBlocked(t *testing.T) {
	deps := testDeps(t)
	d := start(t, deps, nil)
	d.toCerts(testHost)
	d.passCertsCA()
	d.passLogin(pkFor(true, "clerk.other.example.org"), "sk_live_abcdefghijklmnop")
	checkGolden(t, "19-login-blocked", d.waitText("This production key belongs to"))
	d.quit()

	d = start(t, deps, nil)
	d.toCerts(testHost)
	d.passCertsCA()
	d.passLogin(pkFor(true, "clerk.corp.example.com"), "sk_live_abcdefghijklmnop")
	d.passAdmin()
	checkGolden(t, "20-login-clerk-dns", d.waitText("Have you published the DNS records Clerk lists?"))
	d.quit()
}

func TestFramesInstall(t *testing.T) {
	deps := testDeps(t)
	hold := make(chan struct{})
	eng := &fakeEngine{runs: []fakeRun{
		{events: append(phases("config", "validate", "docker", "ca"),
			engine.Event{Kind: engine.Warn, Text: "ufw is inactive: no firewall rules were added."},
			engine.Event{Kind: engine.Phase, ID: "caddy-render", Text: phaseTitles["caddy-render"]},
			engine.Event{Kind: engine.Log, Text: "  rendering deploy/caddy/rendered/tls.caddy"}), hold: hold},
		failUpRun(),
		okRun(),
	}}
	deps.Runner = eng.runner
	d := start(t, deps, nil)
	d.toReview()
	d.enter()
	checkGolden(t, "21-install-running", d.waitText("Installing", "rendering deploy/caddy/rendered/tls.caddy"))
	d.esc()
	checkGolden(t, "22-install-stop-confirm", d.waitText("Stop the install?"))
	d.press('y')
	checkGolden(t, "23-install-stopped", d.waitText("Install stopped"))
	d.press('r')
	checkGolden(t, "24-install-failed", d.waitText("Install failed"))
	d.press('r')
	checkGolden(t, "25-install-complete", d.waitText("Install complete"))
	d.quit()
}

// The engine can finish while "Stop the install?" is open. The question
// must go away with it, and a late y must not touch the finished run.
func TestInstallFinishesWhileStopConfirmOpen(t *testing.T) {
	deps := testDeps(t)
	hold := make(chan struct{})
	eng := &fakeEngine{runs: []fakeRun{{events: phases(achillesPhases...), hold: hold}}}
	deps.Runner = eng.runner
	d := start(t, deps, nil)
	d.toReview()
	d.enter()
	d.waitText("Installing", "Installing the weekly CA renewal timer")
	d.esc()
	d.waitText("Stop the install?")
	close(hold) // the engine exits 0 with the question still open
	f := d.waitText("Install complete")
	if strings.Contains(f, "Stop the install?") || strings.Contains(f, "y stop the install") {
		t.Fatalf("stop question still shown after the engine finished:\n%s", f)
	}
	d.press('y') // late answer: must be a no-op, not a nil cancel
	d.enter()
	d.waitText("Done", "ProjectAchilles is installed")
	d.enter()
	if a := d.final(); a.Outcome().Action != ActionInstall {
		t.Fatalf("outcome = %v, want ActionInstall", a.Outcome().Action)
	}
}
