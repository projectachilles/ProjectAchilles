import { registerCommand } from './registry.js';
import { getServerUrl, getActiveProfile } from '../config/store.js';
import { saveTokens, clearTokens, loadTokens } from '../auth/token-store.js';
import { colors } from '../output/colors.js';
import { DEVICE_POLL_INTERVAL_MS } from '../config/constants.js';
import { client, ApiError, NetworkError } from '../api/client.js';

registerCommand({
  name: 'login',
  description: 'Authenticate with the ProjectAchilles backend',
  handler: async (ctx) => {
    const serverUrl = getServerUrl();
    const profile = getActiveProfile();

    // Check if already logged in
    const existing = loadTokens();
    if (existing && new Date(existing.expires_at) > new Date()) {
      const who = existing.display_name || existing.email || existing.user_id;
      ctx.output.warn(`Already logged in as ${who}. Use ${colors.cyan('achilles logout')} to sign out first.`);
      return;
    }

    ctx.output.raw(`\n  ${colors.bold('Authenticating with')} ${serverUrl}`);
    if (profile.name !== 'default') ctx.output.raw(` ${colors.dim(`(profile: ${profile.name})`)}`);
    ctx.output.raw('\n');

    // Step 1: Request device code
    let deviceCode: string;
    let verificationUrl: string;
    let userCode: string;
    let expiresAt: string;

    try {
      const response = await fetch(`${serverUrl}/api/cli/auth/device-code`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      if (!response.ok) {
        const body = await response.json().catch(() => ({})) as { error?: string };
        throw new Error(body.error ?? `HTTP ${response.status}`);
      }
      const data = (await response.json()) as {
        success: boolean;
        data: { device_code: string; verification_url: string; user_code: string; expires_at: string };
      };
      deviceCode = data.data.device_code;
      verificationUrl = data.data.verification_url;
      userCode = data.data.user_code;
      expiresAt = data.data.expires_at;
    } catch (err) {
      if (err instanceof TypeError && err.message.includes('fetch')) {
        ctx.output.error(`Cannot connect to ${serverUrl}. Is the backend running?`);
      } else {
        ctx.output.error(`Failed to start auth: ${err instanceof Error ? err.message : String(err)}`);
      }
      process.exit(1);
      return; // unreachable but helps TS
    }

    // Step 2: Show code to user
    ctx.output.raw(`  Open this URL in your browser:\n`);
    ctx.output.raw(`  ${colors.cyan(colors.underline(verificationUrl))}\n`);
    ctx.output.raw(`  Enter code: ${colors.bold(colors.brightYellow(userCode))}\n`);
    ctx.output.raw(`  ${colors.dim(`Expires: ${new Date(expiresAt).toLocaleTimeString()}`)}\n`);
    ctx.output.raw(`\n  Waiting for authorization...`);

    // Step 3: Poll for verification
    const deadline = new Date(expiresAt).getTime();
    let authorized = false;

    while (Date.now() < deadline) {
      await new Promise(resolve => setTimeout(resolve, DEVICE_POLL_INTERVAL_MS));

      try {
        const response = await fetch(`${serverUrl}/api/cli/auth/poll`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ device_code: deviceCode }),
        });

        if (response.status === 202) {
          // Not yet verified — keep polling
          process.stdout.write('.');
          continue;
        }

        if (response.ok) {
          const data = (await response.json()) as {
            success: boolean;
            data: {
              access_token: string;
              refresh_token?: string;
              expires_at: string;
              user_id: string;
              org_id: string;
              role?: string;
              email?: string;
              display_name?: string;
            };
          };
          if (data.success) {
            saveTokens({
              access_token: data.data.access_token,
              refresh_token: data.data.refresh_token,
              expires_at: data.data.expires_at,
              user_id: data.data.user_id,
              org_id: data.data.org_id,
              role: data.data.role,
              email: data.data.email,
              display_name: data.data.display_name,
              issued_at: new Date().toISOString(),
            });
            authorized = true;
            break;
          }
        }

        if (response.status === 410) {
          ctx.output.raw('\n');
          ctx.output.error('Device code expired. Please try again.');
          process.exit(1);
        }
      } catch {
        // Network error during poll — keep trying
        process.stdout.write('!');
      }
    }

    ctx.output.raw('\n\n');
    if (authorized) {
      ctx.output.success('Logged in successfully!');
    } else {
      ctx.output.error('Authorization timed out. Please try again.');
      process.exit(1);
    }
  },
});

registerCommand({
  name: 'logout',
  description: 'Clear stored authentication tokens',
  handler: async (ctx) => {
    clearTokens();
    ctx.output.success('Logged out. Tokens cleared.');
  },
});
