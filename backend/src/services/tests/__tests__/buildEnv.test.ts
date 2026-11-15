import { describe, it, expect } from 'vitest';
import { buildSubprocessEnv } from '../buildEnv.js';

describe('buildSubprocessEnv', () => {
  it('drops backend secrets and anything else not on the allowlist', () => {
    const env = buildSubprocessEnv({
      PATH: '/usr/local/go/bin:/usr/bin',
      CLERK_SECRET_KEY: 'sk_test_placeholder',
      ENCRYPTION_SECRET: 'placeholder',
      ELASTICSEARCH_API_KEY: 'placeholder',
      GITHUB_TOKEN: 'placeholder',
      CLI_AUTH_SECRET: 'placeholder',
      DEFENDER_CLIENT_SECRET: 'placeholder',
      SIGNING_PRIVATE_KEY_B64: 'placeholder',
      NODE_OPTIONS: '--max-old-space-size=512',
    });
    expect(env).toEqual({ PATH: '/usr/local/go/bin:/usr/bin' });
  });

  it('keeps what the Go toolchain and module downloads need', () => {
    const source = {
      PATH: '/usr/bin',
      HOME: '/root',
      TMPDIR: '/tmp',
      LANG: 'C.UTF-8',
      LC_ALL: 'C.UTF-8',
      GOCACHE: '/root/go/build-cache',
      GOMODCACHE: '/root/go/pkg/mod',
      GOPROXY: 'https://proxy.golang.org,direct',
      GOFLAGS: '-mod=mod',
      HTTPS_PROXY: 'http://proxy.internal:3128',
      https_proxy: 'http://proxy.internal:3128',
      NO_PROXY: 'localhost',
      SSL_CERT_FILE: '/etc/ssl/certs/ca.pem',
      JAVA_HOME: '/usr/lib/jvm/default-java',
      DOTNET_ROOT: '/usr/share/dotnet',
      NUGET_PACKAGES: '/root/.nuget/packages',
    };
    expect(buildSubprocessEnv(source)).toEqual(source);
  });

  it('does not let a GO prefix pull in unrelated credentials', () => {
    const env = buildSubprocessEnv({
      GOPATH: '/root/go',
      GOOGLE_APPLICATION_CREDENTIALS: '/secrets/gcp.json',
      GOOGLE_API_KEY: 'placeholder',
    });
    expect(env).toEqual({ GOPATH: '/root/go' });
  });

  it('adds the names listed in BUILD_ENV_PASSTHROUGH, and only those', () => {
    const env = buildSubprocessEnv({
      BUILD_ENV_PASSTHROUGH: ' GARBLE_SEED , CUSTOM_SDK_DIR ',
      GARBLE_SEED: 'abc',
      CUSTOM_SDK_DIR: '/opt/sdk',
      CLERK_SECRET_KEY: 'sk_test_placeholder',
    });
    expect(env).toEqual({ GARBLE_SEED: 'abc', CUSTOM_SDK_DIR: '/opt/sdk' });
  });

  it('skips variables with no value', () => {
    expect(buildSubprocessEnv({ PATH: undefined, HOME: '/root' })).toEqual({ HOME: '/root' });
  });
});
