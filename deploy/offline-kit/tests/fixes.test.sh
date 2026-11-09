#!/usr/bin/env bash
# Install fixes the offline kit depends on (they also help online installs):
#   - the ES seed installs its Python client at build time, not on every `up`
#   - the backend image carries the Go toolchain for its own architecture
#   - the Windows installer can start preloaded images without rebuilding
#
#   bash deploy/offline-kit/tests/fixes.test.sh [case ...]
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
cd "$ROOT"

fail() { echo "FAIL $1: $2" >&2; exit 1; }
pass() { echo "PASS $1"; }

TAG_PREFIX="achilles-kittest"
PWSH_IMAGE="mcr.microsoft.com/powershell:7.4-ubuntu-22.04"

# backend/.env is gitignored; compose reads it, so provide an empty one if absent.
created_env=0
if [ ! -f backend/.env ]; then touch backend/.env; created_env=1; fi
trap '[ "$created_env" = 1 ] && rm -f backend/.env' EXIT

# The laptop compose file: es-seed is built from deploy/es-seed and never runs pip.
# (docker-compose.server.yml keeps python:3.12-slim: the appliance pre-pulls it,
# and there the seed only runs with SEED_ES=true.)
seed_needs_no_pip_at_runtime() {
  local file json
  for file in docker-compose.yml; do
    json="$(ACHILLES_DOMAIN=kit.example.test docker compose -p "$TAG_PREFIX" -f "$file" --profile elasticsearch config --format json)" \
      || fail "${FUNCNAME[0]}" "$file: compose config failed"
    python3 - "$json" "$file" <<'PY' || fail "seed_needs_no_pip_at_runtime" "$file"
import json, sys
seed = json.loads(sys.argv[1])["services"]["es-seed"]
f = sys.argv[2]
build = seed.get("build") or {}
assert build.get("context", "").endswith("deploy/es-seed"), f"{f}: es-seed not built from deploy/es-seed: {build}"
entry = " ".join(seed.get("entrypoint") or [])
assert "pip" not in entry, f"{f}: es-seed still runs pip: {entry}"
assert "generate_synthetic_data.py" in entry and "upload_to_elasticsearch.py" in entry, f"{f}: seed steps missing"
PY
  done
  pass "${FUNCNAME[0]}"
}

# The seed image has the Elasticsearch client with no network at all.
seed_image_works_offline() {
  docker build -q -t "$TAG_PREFIX-es-seed" deploy/es-seed >/dev/null \
    || fail "${FUNCNAME[0]}" "build failed"
  local v
  v="$(docker run --rm --network none "$TAG_PREFIX-es-seed" python -c 'import elasticsearch; print(elasticsearch.__versionstr__)')" \
    || fail "${FUNCNAME[0]}" "import failed"
  [ "$v" = "8.17.2" ] || fail "${FUNCNAME[0]}" "client $v, want 8.17.2"
  pass "${FUNCNAME[0]}"
}

# The Go toolchain matches the image architecture (no emulated `go` on Apple Silicon).
backend_go_matches_arch() {
  local arch out
  for arch in ${BACKEND_ARCHES:-amd64 arm64}; do
    docker build -q --platform "linux/$arch" -t "$TAG_PREFIX-backend:$arch" backend >/dev/null \
      || fail "${FUNCNAME[0]}" "linux/$arch build failed"
    out="$(docker run --rm --platform "linux/$arch" --network none --entrypoint go "$TAG_PREFIX-backend:$arch" version)" \
      || fail "${FUNCNAME[0]}" "go did not run on linux/$arch"
    [[ "$out" == *" linux/$arch" ]] || fail "${FUNCNAME[0]}" "linux/$arch image has: $out"
  done
  pass "${FUNCNAME[0]}"
}

# Runs the installer's build phase with a fake `docker` and returns the compose arguments.
installer_compose_args() { # $1 = PowerShell lines run before the phase
  docker run --rm --network none -v "$ROOT/scripts:/s:ro" "$PWSH_IMAGE" pwsh -NoProfile -Command "
    \$ErrorActionPreference = 'Stop'
    \$ast = [System.Management.Automation.Language.Parser]::ParseFile('/s/Install-ProjectAchilles.ps1', [ref]\$null, [ref]\$null)
    \$params = \$ast.ParamBlock.Parameters | ForEach-Object { \$_.Name.VariablePath.UserPath }
    if (\$params -notcontains 'NoBuild') { Write-Output 'NO-PARAM'; exit 0 }
    foreach (\$name in 'Write-Step','Write-Info','Write-Success','Write-Failure','Invoke-PhaseBuild') {
      \$fn = \$ast.Find({ param(\$n) \$n -is [System.Management.Automation.Language.FunctionDefinitionAst] -and \$n.Name -eq \$name }, \$true)
      Invoke-Expression \$fn.Extent.Text
    }
    function docker { \$global:composeArgs = \$args; \$global:LASTEXITCODE = 0 }
    \$script:ProjectRoot = '/tmp'; \$script:ComposeCmd = 'docker compose'; \$script:EsMode = 'local'
    $1
    Invoke-PhaseBuild *> \$null
    Write-Output (\$global:composeArgs -join ' ')
  "
}

installer_nobuild_switch() {
  local out
  out="$(installer_compose_args '$NoBuild = $true')" || fail "${FUNCNAME[0]}" "pwsh failed"
  [ "$out" != "NO-PARAM" ] || fail "${FUNCNAME[0]}" "no -NoBuild parameter"
  [ "$out" = "compose --profile elasticsearch up -d" ] || fail "${FUNCNAME[0]}" "-NoBuild ran: $out"
  out="$(installer_compose_args '$NoBuild = $false')" || fail "${FUNCNAME[0]}" "pwsh failed"
  [ "$out" = "compose --profile elasticsearch up -d --build" ] || fail "${FUNCNAME[0]}" "default ran: $out"
  pass "${FUNCNAME[0]}"
}

# -NoBuild (offline kit) needs no Git on the host: the kit unpacks the source
# with tar. Without -NoBuild a missing Git still stops the installer.
installer_git_check() { # $1 = PowerShell lines run before the check
  docker run --rm --network none -v "$ROOT/scripts:/s:ro" "$PWSH_IMAGE" pwsh -NoProfile -Command "
    \$ErrorActionPreference = 'Stop'
    \$ast = [System.Management.Automation.Language.Parser]::ParseFile('/s/Install-ProjectAchilles.ps1', [ref]\$null, [ref]\$null)
    foreach (\$name in 'Write-Info','Write-Success','Write-Warning','Write-Failure','Test-GitPrereq') {
      \$fn = \$ast.Find({ param(\$n) \$n -is [System.Management.Automation.Language.FunctionDefinitionAst] -and \$n.Name -eq \$name }, \$true)
      if (-not \$fn) { Write-Output \"NO-FUNCTION \$name\"; exit 3 }
      Invoke-Expression \$fn.Extent.Text
    }
    function git { throw 'git: command not found' }
    $1
    Test-GitPrereq *> \$null
    Write-Output 'CONTINUED'
  "
}

installer_nobuild_without_git() {
  local out rc
  out="$(installer_git_check '$NoBuild = $true')" && rc=0 || rc=$?
  [ "$rc" = 0 ] && [ "$out" = CONTINUED ] || fail "${FUNCNAME[0]}" "-NoBuild without Git: rc=$rc $out"
  out="$(installer_git_check '$NoBuild = $false')" && rc=0 || rc=$?
  [ "$rc" = 1 ] || fail "${FUNCNAME[0]}" "without -NoBuild a missing Git must stop the installer: rc=$rc $out"
  pass "${FUNCNAME[0]}"
}

# Kits travel on USB sticks. Many come formatted FAT32, which Linux (udisks)
# mounts with `showexec`: only .exe/.bat/.com are executable, so kit.sh is 0644,
# on the stick and once copied off it. The command START-HERE.md gives for
# macOS / Linux must not need the execute bit.
start_here_kit_command_runs_without_exec_bit() {
  local dir cmds cmd rc
  dir="$(mktemp -d)"
  install -m 0644 deploy/offline-kit/kit.sh "$dir/kit.sh"
  cmds="$(grep -E '^ *- macOS / Linux: `[^`]*kit\.sh`' deploy/offline-kit/START-HERE.md | sed -E 's/.*`([^`]*)`.*/\1/')"
  [ "$(printf '%s\n' "$cmds" | grep -c .)" = 2 ] || { rm -rf "$dir"; fail "${FUNCNAME[0]}" "expected the kit.sh line in English and Spanish, got: $cmds"; }
  while IFS= read -r cmd; do
    (cd "$dir" && eval "$cmd --help" >/dev/null 2>&1) && rc=0 || rc=$?
    [ "$rc" = 0 ] || { rm -rf "$dir"; fail "${FUNCNAME[0]}" "\`$cmd\` fails on a 0644 kit.sh (rc=$rc)"; }
  done <<<"$cmds"
  rm -rf "$dir"
  pass "${FUNCNAME[0]}"
}

cases=("$@")
[ ${#cases[@]} -gt 0 ] || cases=(seed_needs_no_pip_at_runtime seed_image_works_offline installer_nobuild_switch installer_nobuild_without_git backend_go_matches_arch start_here_kit_command_runs_without_exec_bit)
for c in "${cases[@]}"; do "$c"; done
