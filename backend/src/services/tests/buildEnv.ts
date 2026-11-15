// Environment for test-build subprocesses (`go build`, `go mod`, build_all.sh).
//
// A build runs code from the test library: `build_all.sh` is a shell script and
// `go build` runs whatever the module's toolchain directives ask for. Passing
// the backend's whole environment handed all of it the Clerk secret key, the
// settings encryption secret, Elasticsearch credentials and the git token. A
// build needs none of those, so it gets an allowlist instead.
//
// This is not a sandbox: the script still runs as the backend user and can read
// the files that user can read. It only stops the secrets that live in the
// environment from being one `env` away.

/** Exact names a build may inherit. */
const ALLOWED_NAMES = new Set([
  // Process basics
  'PATH', 'HOME', 'USER', 'LOGNAME', 'SHELL', 'PWD', 'TERM', 'TZ',
  'TMPDIR', 'TEMP', 'TMP', 'LANG', 'LANGUAGE',
  'XDG_CACHE_HOME', 'XDG_CONFIG_HOME', 'XDG_DATA_HOME',
  // Windows hosts (local development)
  'SYSTEMROOT', 'SYSTEMDRIVE', 'WINDIR', 'COMSPEC', 'PATHEXT',
  'USERPROFILE', 'APPDATA', 'LOCALAPPDATA', 'PROGRAMDATA', 'PROGRAMFILES',
  // Go toolchain. Listed one by one: a `GO*` prefix would also match
  // GOOGLE_APPLICATION_CREDENTIALS.
  'GOROOT', 'GOPATH', 'GOBIN', 'GOCACHE', 'GOMODCACHE', 'GOTMPDIR', 'GOENV',
  'GOFLAGS', 'GOPROXY', 'GONOPROXY', 'GOPRIVATE', 'GOSUMDB', 'GONOSUMDB',
  'GONOSUMCHECK', 'GOINSECURE', 'GOTOOLCHAIN', 'GOWORK', 'GOEXPERIMENT',
  'GODEBUG', 'GOMAXPROCS', 'GOMEMLIMIT', 'GOAMD64', 'GOARM64',
  // Module downloads behind a proxy or a private CA
  'HTTP_PROXY', 'HTTPS_PROXY', 'NO_PROXY', 'ALL_PROXY',
  'SSL_CERT_FILE', 'SSL_CERT_DIR',
  // Java and .NET helpers some tests compile
  'JAVA_HOME',
]);

/** Name prefixes a build may inherit. */
const ALLOWED_PREFIXES = ['LC_', 'DOTNET_', 'NUGET_'];

function isAllowed(name: string, extra: ReadonlySet<string>): boolean {
  const upper = name.toUpperCase();
  return ALLOWED_NAMES.has(upper)
    || extra.has(name)
    || ALLOWED_PREFIXES.some((prefix) => upper.startsWith(prefix));
}

/**
 * The backend environment reduced to what a build needs.
 *
 * `BUILD_ENV_PASSTHROUGH` (comma-separated names) adds variables for installs
 * whose builds need something else, without a code change.
 */
export function buildSubprocessEnv(
  source: NodeJS.ProcessEnv = process.env,
): Record<string, string | undefined> {
  const extra = new Set(
    (source.BUILD_ENV_PASSTHROUGH ?? '')
      .split(',')
      .map((name) => name.trim())
      .filter(Boolean),
  );
  const env: Record<string, string | undefined> = {};
  for (const [name, value] of Object.entries(source)) {
    if (value !== undefined && isAllowed(name, extra)) env[name] = value;
  }
  return env;
}
