package engine

// The `up` phase reuses the backend and frontend images when they were built
// from the checked-out commit (the appliance ships them pre-built), and
// rebuilds in every other case.

import (
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
)

const otherCommit = "0000000000000000000000000000000000000000"

// gitInit commits the sandbox (with the repo's .gitignore, so rendered files
// such as backend/.env stay untracked-and-ignored as on a real server) and
// returns the commit.
func gitInit(t *testing.T, s *sandbox) string {
	t.Helper()
	writeFile(t, s.path(".gitignore"), readFile(t, filepath.Join(repoRoot(t), ".gitignore")), 0o644)
	gitAt(t, s.root, "init", "-q")
	gitAt(t, s.root, "add", "-A")
	gitAt(t, s.root, "commit", "-q", "-m", "init")
	return gitAt(t, s.root, "rev-parse", "HEAD")
}

// gitAt runs git in dir with no user or system config.
func gitAt(t *testing.T, dir string, args ...string) string {
	t.Helper()
	cmd := exec.Command("git", append([]string{"-c", "user.name=t", "-c", "user.email=t@t"}, args...)...)
	cmd.Dir = dir
	cmd.Env = []string{"GIT_CONFIG_GLOBAL=/dev/null", "GIT_CONFIG_NOSYSTEM=1", "HOME=" + dir, "PATH=/usr/bin:/bin"}
	out, err := cmd.CombinedOutput()
	if err != nil {
		t.Fatalf("git %v: %v\n%s", args, err, out)
	}
	return strings.TrimSpace(string(out))
}

func images(backend, frontend string) string {
	return "achilles-server-backend=" + backend + ",achilles-server-frontend=" + frontend
}

// runUp does a full (stubbed) run and returns the compose `up` call.
func runUp(t *testing.T, s *sandbox, overrides map[string]string) (result, string) {
	t.Helper()
	full := map[string]string{"ACHILLES_RENDER_ONLY": "", "STUB_DOCKER_PS": s.root}
	for k, v := range overrides {
		full[k] = v
	}
	r := s.mustRun(t, full)
	var up []string
	for _, l := range stubLines(t, s, "docker ") {
		if strings.Contains(l, " compose ") && strings.Contains(l, " up ") {
			up = append(up, l)
		}
	}
	if len(up) != 1 {
		t.Fatalf("want one compose up call, got %q\n%s", up, r)
	}
	return r, up[0]
}

func newUpSandbox(t *testing.T) *sandbox {
	t.Helper()
	s := newSandbox(t, "acme-http", "")
	addFullRunStubs(t, s)
	return s
}

// wantEmptyCommit checks that every compose call saw an empty
// ACHILLES_GIT_COMMIT (there are compose calls before `up`, e.g. `version`).
func wantEmptyCommit(t *testing.T, s *sandbox) {
	t.Helper()
	env := stubLines(t, s, "env ACHILLES_GIT_COMMIT=")
	if len(env) == 0 {
		t.Fatal("no compose calls logged")
	}
	for _, l := range env {
		if l != "env ACHILLES_GIT_COMMIT=" {
			t.Errorf("want an empty ACHILLES_GIT_COMMIT, compose saw %q", l)
		}
	}
}

func wantBuild(t *testing.T, up string) {
	t.Helper()
	if !strings.Contains(up, "--build") {
		t.Errorf("want up --build, got %q", up)
	}
}

// wantReason checks that the run said why it rebuilds.
func wantReason(t *testing.T, r result, reason string) {
	t.Helper()
	if want := "Rebuilding the backend and frontend images: " + reason; !strings.Contains(r.stdout, want) {
		t.Errorf("stdout does not contain %q\n%s", want, r)
	}
}

func TestEngineUpReusesPrebuiltImages(t *testing.T) {
	s := newUpSandbox(t)
	c := gitInit(t, s)
	r, up := runUp(t, s, map[string]string{"STUB_DOCKER_IMAGES": images(c, c)})
	if strings.Contains(up, "--build") || !strings.Contains(up, " up -d") {
		t.Errorf("want up -d without --build, got %q", up)
	}
	if strings.Contains(r.stdout, "Rebuilding") {
		t.Errorf("stdout says it rebuilds\n%s", r)
	}
	if !strings.Contains(r.stdout, "Using the pre-built images") {
		t.Errorf("stdout does not say the images were reused\n%s", r)
	}
	if env := stubLines(t, s, "env ACHILLES_GIT_COMMIT="+c); len(env) == 0 {
		t.Errorf("compose did not see ACHILLES_GIT_COMMIT=%s", c)
	}
}

func TestEngineUpBuildsWhenOneImageDiffers(t *testing.T) {
	s := newUpSandbox(t)
	c := gitInit(t, s)
	r, up := runUp(t, s, map[string]string{"STUB_DOCKER_IMAGES": images(c, otherCommit)})
	wantBuild(t, up)
	wantReason(t, r, "no achilles-server-frontend image built from "+c[:12])
}

func TestEngineUpBuildsWhenImagesMissing(t *testing.T) {
	s := newUpSandbox(t)
	c := gitInit(t, s)
	r, up := runUp(t, s, nil)
	wantBuild(t, up)
	wantReason(t, r, "no achilles-server-backend image built from "+c[:12])
}

// Images built before the label existed: --format prints "<no value>".
func TestEngineUpBuildsForUnlabelledImages(t *testing.T) {
	s := newUpSandbox(t)
	gitInit(t, s)
	_, up := runUp(t, s, map[string]string{"STUB_DOCKER_IMAGES": images("<no value>", "<no value>")})
	wantBuild(t, up)
}

// A hot-patched file under backend/ must be built, even though HEAD matches.
func TestEngineUpBuildsWhenTreeDirty(t *testing.T) {
	s := newUpSandbox(t)
	c := gitInit(t, s)
	writeFile(t, s.path("backend", "src", "patched.ts"), "export const patched = true;\n", 0o644)
	r, up := runUp(t, s, map[string]string{"STUB_DOCKER_IMAGES": images(c, c)})
	wantBuild(t, up)
	wantReason(t, r, "backend/ or frontend/ has local changes")
}

// Images rebuilt from a modified tree must not carry HEAD's commit: once the
// patch is reverted, a clean re-run would otherwise reuse the patched image.
func TestEngineUpDirtyBuildStampsNoCommit(t *testing.T) {
	s := newUpSandbox(t)
	c := gitInit(t, s)
	writeFile(t, s.path("backend", "src", "patched.ts"), "export const patched = true;\n", 0o644)
	_, up := runUp(t, s, map[string]string{"STUB_DOCKER_IMAGES": images(c, c)})
	wantBuild(t, up)
	wantEmptyCommit(t, s)
}

func TestEngineUpBuildsWhenForced(t *testing.T) {
	s := newUpSandbox(t)
	c := gitInit(t, s)
	r, up := runUp(t, s, map[string]string{"STUB_DOCKER_IMAGES": images(c, c), "ACHILLES_FORCE_BUILD": "1"})
	wantBuild(t, up)
	wantReason(t, r, "ACHILLES_FORCE_BUILD is set")
}

// sudo's env_reset drops exported variables, so the commit has to be passed
// to `sudo docker compose` explicitly. This sudo stub keeps only PATH and the
// stubs' own STUB_* plumbing, like env_reset would.
func TestEngineUpUnderSudoPassesCommit(t *testing.T) {
	s := newUpSandbox(t)
	writeFile(t, filepath.Join(s.stubs, "sudo"), `#!/bin/sh
exec env -i PATH="$PATH" STUB_VIA_SUDO=1 $(env | grep '^STUB_') "$@"
`, 0o755)
	c := gitInit(t, s)
	_, up := runUp(t, s, map[string]string{"STUB_DOCKER_IMAGES": images(c, c), "STUB_DOCKER_NO_DAEMON": "1"})
	if strings.Contains(up, "--build") {
		t.Errorf("want the pre-built images reused under sudo, got %q", up)
	}
	if env := stubLines(t, s, "env ACHILLES_GIT_COMMIT="+c); len(env) == 0 {
		t.Errorf("sudo docker compose did not see ACHILLES_GIT_COMMIT=%s:\n%s", c, strings.Join(stubLines(t, s, "env "), "\n"))
	}
}

// An unborn repo (git init, no commit) makes `git rev-parse HEAD` print "HEAD".
func TestEngineUpCommitEmptyInUnbornRepo(t *testing.T) {
	s := newUpSandbox(t)
	gitAt(t, s.root, "init", "-q")
	r, up := runUp(t, s, nil)
	wantBuild(t, up)
	wantReason(t, r, "no commit for this checkout")
	wantEmptyCommit(t, s)
}

// A checkout without its own .git inside another repository must not stamp
// the outer repository's commit.
func TestEngineUpIgnoresEnclosingRepo(t *testing.T) {
	s := newUpSandbox(t)
	outer := filepath.Dir(s.root) // the test's own temp dir, holding only sandboxes
	gitAt(t, outer, "init", "-q")
	gitAt(t, outer, "commit", "-q", "--allow-empty", "-m", "outer")
	c := gitAt(t, outer, "rev-parse", "HEAD")
	_, up := runUp(t, s, map[string]string{"STUB_DOCKER_IMAGES": images(c, c)})
	wantBuild(t, up)
	if env := stubLines(t, s, "env ACHILLES_GIT_COMMIT="+c); len(env) != 0 {
		t.Errorf("stamped the enclosing repository's commit %s", c)
	}
}

// A host git config that hides untracked files must not hide a new source
// file from the dirty check.
func TestEngineUpBuildsForUntrackedFileDespiteGitConfig(t *testing.T) {
	s := newUpSandbox(t)
	c := gitInit(t, s)
	writeFile(t, s.path(".gitconfig"), "[status]\n\tshowUntrackedFiles = no\n", 0o644) // HOME is the sandbox root
	writeFile(t, s.path("frontend", "src", "new.tsx"), "export {};\n", 0o644)
	_, up := runUp(t, s, map[string]string{"STUB_DOCKER_IMAGES": images(c, c)})
	wantBuild(t, up)
}

func TestEngineUpBuildsOutsideGit(t *testing.T) {
	s := newUpSandbox(t)
	r, up := runUp(t, s, map[string]string{"STUB_DOCKER_IMAGES": images(otherCommit, otherCommit)})
	wantBuild(t, up)
	wantReason(t, r, "no commit for this checkout")
	wantEmptyCommit(t, s)
}
