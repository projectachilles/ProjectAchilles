import { registerCommand } from './registry.js';
import { loadConfig, getActiveProfile } from '../config/store.js';
import { getUserInfo } from '../auth/token-store.js';
import { colors, scoreColor, progressBar } from '../output/colors.js';
import * as agentsApi from '../api/agents.js';
import * as analyticsApi from '../api/analytics.js';
import { NetworkError, AuthError } from '../api/client.js';
import { VERSION } from '../config/constants.js';

registerCommand({
  name: 'status',
  description: 'Health check — backend connectivity, auth, and fleet summary',
  aliases: ['st'],
  handler: async (ctx) => {
    const profile = getActiveProfile();
    const user = getUserInfo();

    if (ctx.output['mode' as keyof typeof ctx.output] === 'json') {
      // Structured output for LLMs
      const result: Record<string, unknown> = {
        cli_version: VERSION,
        profile: profile.name,
        server_url: profile.server_url,
        authenticated: !!user,
      };
      if (user) {
        result.user_id = user.userId;
        result.org_id = user.orgId;
        result.role = user.role;
      }
      try {
        const metrics = await agentsApi.getMetrics(user?.orgId);
        result.backend = 'connected';
        result.fleet = metrics;
      } catch (err) {
        if (err instanceof NetworkError) result.backend = 'unreachable';
        else if (err instanceof AuthError) result.backend = 'auth_failed';
        else result.backend = 'error';
      }
      try {
        const score = await analyticsApi.getDefenseScore({ org: user?.orgId });
        result.defense_score = score;
      } catch {
        result.defense_score = null;
      }
      console.log(JSON.stringify({ data: result, command: 'status', timestamp: new Date().toISOString() }, null, 2));
      return;
    }

    // Pretty output
    console.log(`\n  ${colors.bold('ProjectAchilles CLI')} ${colors.dim(`v${VERSION}`)}\n`);
    const profileLabel = profile.name !== 'default' ? ` ${colors.dim(`(${profile.name})`)}` : '';
    console.log(`  ${colors.dim('Server:')}    ${profile.server_url}${profileLabel}`);

    if (user) {
      const userLabel = user.displayName || user.email || user.userId;
      console.log(`  ${colors.dim('User:')}      ${userLabel}`);
      console.log(`  ${colors.dim('Org:')}       ${user.orgId}`);
      if (user.role) console.log(`  ${colors.dim('Role:')}      ${user.role}`);
    } else {
      console.log(`  ${colors.dim('Auth:')}      ${colors.yellow('Not logged in')} — run ${colors.cyan('achilles login')}`);
    }

    // Backend connectivity
    console.log();
    try {
      const metrics = await agentsApi.getMetrics(user?.orgId);
      console.log(`  ${colors.brightGreen('●')} Backend connected`);
      console.log(`  ${colors.dim('Fleet:')}     ${metrics.total} agents (${colors.brightGreen(String(metrics.online))} online, ${colors.red(String(metrics.offline))} offline)`);
      if (metrics.stale > 0) {
        console.log(`  ${colors.dim('Stale:')}     ${colors.yellow(String(metrics.stale))} agents`);
      }
    } catch (err) {
      if (err instanceof NetworkError) {
        console.log(`  ${colors.brightRed('●')} Backend unreachable at ${profile.server_url}`);
      } else if (err instanceof AuthError) {
        console.log(`  ${colors.yellow('●')} Backend reachable but auth failed`);
      } else {
        console.log(`  ${colors.brightRed('●')} Backend error: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    // Defense score
    try {
      const score = await analyticsApi.getDefenseScore({ org: user?.orgId });
      console.log(`\n  ${colors.bold('Defense Score')}: ${scoreColor(score.score)} ${progressBar(score.score, 100)}`);
      console.log(`  ${colors.dim(`${score.protectedCount} protected / ${score.unprotectedCount} unprotected / ${score.totalExecutions} total`)}`);
    } catch {
      // ES not configured — skip silently
    }

    console.log();
  },
});
