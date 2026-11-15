/**
 * AI SDK tool definitions for the chat agent.
 *
 * Each tool maps to one or more API client methods. Read tools execute
 * immediately; write and destructive proposals require exact, action-specific
 * terminal confirmation before their API client closure can run.
 */

import { tool } from 'ai';
import { z } from 'zod';
import * as agentsApi from '../api/agents.js';
import * as tokensApi from '../api/tokens.js';
import * as tasksApi from '../api/tasks.js';
import * as schedulesApi from '../api/schedules.js';
import * as versionsApi from '../api/versions.js';
import * as browserApi from '../api/browser.js';
import * as analyticsApi from '../api/analytics.js';
import * as defenderApi from '../api/defender.js';
import * as crowdstrikeApi from '../api/crowdstrike.js';
import * as buildsApi from '../api/builds.js';
import * as certsApi from '../api/certs.js';
import * as integrationsApi from '../api/integrations.js';
import * as riskApi from '../api/risk.js';
import * as usersApi from '../api/users.js';
import {
  createPendingAction,
  executeApprovedAction,
  serializeApprovalRequests,
  type ApprovalTier,
  type RequestApproval,
} from './approval.js';

// ─── Read Tools (no approval) ───────────────────────────────────────────────

export const readTools = {
  // Agents
  list_agents: tool({
    description: 'List enrolled agents with optional filters. Returns hostname, OS, arch, status, and online state.',
    inputSchema: z.object({
      status: z.enum(['active', 'disabled', 'decommissioned', 'online', 'offline', 'stale']).optional(),
      os: z.enum(['windows', 'linux', 'darwin']).optional(),
      tag: z.string().optional(),
      online_only: z.boolean().optional(),
      limit: z.number().optional().default(20),
    }),
    execute: async (params) => agentsApi.listAgents(params),
  }),
  get_agent: tool({
    description: 'Get detailed info about a specific agent by ID.',
    inputSchema: z.object({ id: z.string() }),
    execute: async ({ id }) => agentsApi.getAgent(id),
  }),
  get_agent_heartbeats: tool({
    description: 'Get heartbeat history (CPU, memory, disk) for an agent.',
    inputSchema: z.object({ id: z.string(), days: z.number().optional().default(7) }),
    execute: async ({ id, days }) => agentsApi.getHeartbeats(id, days),
  }),
  get_agent_events: tool({
    description: 'Get event log for an agent (enrolled, went_offline, task_completed, etc.).',
    inputSchema: z.object({ id: z.string(), limit: z.number().optional().default(20) }),
    execute: async ({ id, limit }) => agentsApi.getEvents(id, { limit }),
  }),
  get_fleet_metrics: tool({
    description: 'Get fleet-wide metrics: total agents, online/offline counts, by OS breakdown.',
    inputSchema: z.object({}),
    execute: async () => agentsApi.getMetrics(),
  }),
  get_fleet_health: tool({
    description: 'Get fleet health KPIs: uptime %, task success rate, MTBF, stale agents.',
    inputSchema: z.object({}),
    execute: async () => agentsApi.getFleetHealth(),
  }),

  // Tokens
  list_tokens: tool({
    description: 'List active enrollment tokens.',
    inputSchema: z.object({ org_id: z.string().optional().default('default') }),
    execute: async ({ org_id }) => tokensApi.listTokens(org_id),
  }),

  // Tasks
  list_tasks: tool({
    description: 'List tasks with optional filters (status, type, agent_id, search text).',
    inputSchema: z.object({
      status: z.enum(['pending', 'assigned', 'downloading', 'executing', 'completed', 'failed', 'expired']).optional(),
      type: z.enum(['execute_test', 'update_agent', 'uninstall', 'execute_command']).optional(),
      agent_id: z.string().optional(),
      search: z.string().optional(),
      limit: z.number().optional().default(20),
    }),
    execute: async (params) => tasksApi.listTasks(params),
  }),
  get_task: tool({
    description: 'Get detailed info about a specific task, including result and notes.',
    inputSchema: z.object({ id: z.string() }),
    execute: async ({ id }) => tasksApi.getTask(id),
  }),

  // Schedules
  list_schedules: tool({
    description: 'List recurring test schedules.',
    inputSchema: z.object({ status: z.enum(['active', 'paused', 'completed', 'deleted']).optional() }),
    execute: async ({ status }) => schedulesApi.listSchedules({ status }),
  }),
  get_schedule: tool({
    description: 'Get details of a specific schedule.',
    inputSchema: z.object({ id: z.string() }),
    execute: async ({ id }) => schedulesApi.getSchedule(id),
  }),

  // Versions
  list_versions: tool({
    description: 'List registered agent binary versions.',
    inputSchema: z.object({}),
    execute: async () => versionsApi.listVersions(),
  }),

  // Browser
  list_tests: tool({
    description: 'Search the security test library. Filter by name, technique, category, or severity.',
    inputSchema: z.object({
      search: z.string().optional(),
      technique: z.string().optional().describe('MITRE technique ID (e.g., T1059)'),
      category: z.string().optional(),
      severity: z.enum(['critical', 'high', 'medium', 'low', 'informational']).optional(),
    }),
    execute: async (params) => browserApi.listTests(params),
  }),
  get_test: tool({
    description: 'Get full details of a security test by UUID.',
    inputSchema: z.object({ uuid: z.string() }),
    execute: async ({ uuid }) => browserApi.getTest(uuid),
  }),
  get_categories: tool({
    description: 'List all available test categories.',
    inputSchema: z.object({}),
    execute: async () => browserApi.getCategories(),
  }),

  // Analytics
  get_defense_score: tool({
    description: 'Get the current defense score (0-100%). Higher = better defense coverage.',
    inputSchema: z.object({
      org: z.string().optional(),
      from: z.string().optional().describe('Start date ISO'),
      to: z.string().optional().describe('End date ISO'),
    }),
    execute: async (params) => analyticsApi.getDefenseScore(params),
  }),
  get_score_trend: tool({
    description: 'Get defense score trend over time.',
    inputSchema: z.object({
      interval: z.string().optional().default('1d'),
      windowDays: z.number().optional().default(30),
    }),
    execute: async (params) => analyticsApi.getScoreTrend(params),
  }),
  get_score_by_test: tool({
    description: 'Get defense score breakdown by individual test.',
    inputSchema: z.object({ limit: z.number().optional().default(10) }),
    execute: async ({ limit }) => analyticsApi.getScoreByTest({ limit }),
  }),
  get_score_by_technique: tool({
    description: 'Get defense score breakdown by MITRE technique.',
    inputSchema: z.object({}),
    execute: async () => analyticsApi.getScoreByTechnique(),
  }),
  get_score_by_hostname: tool({
    description: 'Get defense score breakdown by hostname.',
    inputSchema: z.object({ limit: z.number().optional().default(10) }),
    execute: async ({ limit }) => analyticsApi.getScoreByHostname({ limit }),
  }),
  get_executions: tool({
    description: 'Get recent test executions with outcomes (protected/unprotected/error).',
    inputSchema: z.object({
      page: z.number().optional().default(1),
      pageSize: z.number().optional().default(20),
    }),
    execute: async (params) => analyticsApi.getExecutionsPaginated(params),
  }),
  get_error_rate: tool({
    description: 'Get the current test error rate.',
    inputSchema: z.object({}),
    execute: async () => analyticsApi.getErrorRate(),
  }),
  get_test_coverage: tool({
    description: 'Get test coverage matrix — which tests have been run and their protection rates.',
    inputSchema: z.object({}),
    execute: async () => analyticsApi.getTestCoverage(),
  }),
  get_technique_distribution: tool({
    description: 'Get MITRE technique distribution across executions.',
    inputSchema: z.object({}),
    execute: async () => analyticsApi.getTechniqueDistribution(),
  }),

  // Defender
  get_secure_score: tool({
    description: 'Get Microsoft Secure Score from Defender integration.',
    inputSchema: z.object({}),
    execute: async () => defenderApi.getSecureScore(),
  }),
  get_defender_alerts: tool({
    description: 'Get Microsoft Defender alerts with severity and status filters.',
    inputSchema: z.object({
      severity: z.string().optional(),
      status: z.string().optional(),
      search: z.string().optional(),
      page: z.number().optional().default(1),
    }),
    execute: async (params) => defenderApi.getAlerts(params),
  }),
  get_score_correlation: tool({
    description: 'Get correlation between Defense Score and Microsoft Secure Score over time.',
    inputSchema: z.object({ days: z.number().optional().default(30) }),
    execute: async ({ days }) => defenderApi.getScoreCorrelation(days),
  }),

  // CrowdStrike
  get_zta_score: tool({
    description: 'Get the current CrowdStrike Zero Trust Assessment (ZTA) score.',
    inputSchema: z.object({}),
    execute: async () => crowdstrikeApi.getZtaScore(),
  }),
  get_zta_score_trend: tool({
    description: 'Get the CrowdStrike ZTA score trend over time.',
    inputSchema: z.object({ days: z.number().optional().default(30) }),
    execute: async ({ days }) => crowdstrikeApi.getZtaScoreTrend(days),
  }),
  get_crowdstrike_alerts: tool({
    description: 'Get CrowdStrike Falcon alerts with severity and status filters.',
    inputSchema: z.object({
      severity: z.string().optional(),
      status: z.string().optional(),
      search: z.string().optional(),
      page: z.number().optional().default(1),
    }),
    execute: async (params) => crowdstrikeApi.getAlerts(params),
  }),
  get_crowdstrike_alert_trend: tool({
    description: 'Get the CrowdStrike alert count trend over time.',
    inputSchema: z.object({ days: z.number().optional().default(30) }),
    execute: async ({ days }) => crowdstrikeApi.getAlertsTrend(days),
  }),
  get_crowdstrike_score_correlation: tool({
    description: 'Get correlation between Defense Score and CrowdStrike ZTA score over time.',
    inputSchema: z.object({ days: z.number().optional().default(30) }),
    execute: async ({ days }) => crowdstrikeApi.getScoreCorrelation(days),
  }),
  get_crowdstrike_technique_correlation: tool({
    description: 'Get MITRE technique overlap between Achilles tests and CrowdStrike alerts.',
    inputSchema: z.object({}),
    execute: async () => crowdstrikeApi.getTechniqueCorrelation(),
  }),

  // Builds
  get_build_info: tool({
    description: 'Get build info for a test binary.',
    inputSchema: z.object({ uuid: z.string() }),
    execute: async ({ uuid }) => buildsApi.getBuild(uuid),
  }),
  get_dependencies: tool({
    description: 'List embed dependencies for a test.',
    inputSchema: z.object({ uuid: z.string() }),
    execute: async ({ uuid }) => buildsApi.getDependencies(uuid),
  }),

  // Certs
  list_certificates: tool({
    description: 'List code signing certificates.',
    inputSchema: z.object({}),
    execute: async () => certsApi.listCertificates(),
  }),

  // Integrations
  get_azure_config: tool({
    description: 'Show Azure AD integration configuration (credentials masked).',
    inputSchema: z.object({}),
    execute: async () => integrationsApi.getAzureConfig(),
  }),
  get_alert_config: tool({
    description: 'Show alerting configuration (thresholds, channels).',
    inputSchema: z.object({}),
    execute: async () => integrationsApi.getAlertConfig(),
  }),
  get_alert_history: tool({
    description: 'Get alert dispatch history.',
    inputSchema: z.object({}),
    execute: async () => integrationsApi.getAlertHistory(),
  }),

  // Risk
  list_risk_acceptances: tool({
    description: 'List risk acceptances with optional status filter.',
    inputSchema: z.object({
      status: z.enum(['active', 'revoked']).optional(),
      test_name: z.string().optional(),
    }),
    execute: async (params) => riskApi.listRiskAcceptances(params),
  }),

  // Users
  list_users: tool({
    description: 'List team members with roles.',
    inputSchema: z.object({}),
    execute: async () => usersApi.listUsers(),
  }),
  list_invitations: tool({
    description: 'List pending user invitations.',
    inputSchema: z.object({}),
    execute: async () => usersApi.listInvitations(),
  }),
};

interface ApprovalDetails {
  tier: ApprovalTier;
  description: string;
}

function createApprovedTools(requestApproval: RequestApproval) {
  const requestQueuedApproval = serializeApprovalRequests(requestApproval);

  function executeWithApproval<T>(
    toolName: string,
    details: ApprovalDetails,
    parameters: Record<string, unknown>,
    execute: () => Promise<T>,
  ) {
    const action = createPendingAction(
      toolName,
      details.tier,
      details.description,
      parameters,
    );
    return executeApprovedAction(action, requestQueuedApproval, execute);
  }

  return {
  // ─── Write Tools ──────────────────────────────────────────────────────────

  create_token: tool({
    description: 'Propose creating an enrollment token for new agent registration. Requires terminal approval.',
    inputSchema: z.object({
      org_id: z.string().optional().default('default'),
      ttl_hours: z.number().optional().default(24),
      max_uses: z.number().optional().default(1),
    }),
    execute: async (params) => executeWithApproval(
      'create_token',
      { tier: 'write', description: 'Create an enrollment token' },
      params,
      () => tokensApi.createToken(params),
    ),
  }),
  create_tasks: tool({
    description: 'Propose security test execution tasks for one or more agents. Requires terminal approval.',
    inputSchema: z.object({
      agent_ids: z.array(z.string()).describe('Agent IDs to target'),
      test_uuid: z.string().describe('UUID of the test to execute'),
      priority: z.number().optional(),
    }),
    execute: async (params) => executeWithApproval(
      'create_tasks',
      { tier: 'write', description: 'Create security test execution tasks' },
      params,
      () => tasksApi.createTasks({
        org_id: 'default',
        agent_ids: params.agent_ids,
        payload: { test_uuid: params.test_uuid, test_name: '', binary_name: '' },
        priority: params.priority,
      }),
    ),
  }),
  create_command_task: tool({
    description: 'Propose an arbitrary shell command for agents. Requires exact terminal approval.',
    inputSchema: z.object({
      agent_ids: z.array(z.string()),
      command: z.string().describe('Shell command to execute'),
      execution_timeout: z.number().optional(),
    }),
    execute: async (params) => executeWithApproval(
      'create_command_task',
      { tier: 'destructive', description: 'Execute a shell command on agents' },
      params,
      () => tasksApi.createCommandTask({ org_id: 'default', ...params }),
    ),
  }),
  create_update_tasks: tool({
    description: 'Propose agent update tasks to push the latest version. Requires terminal approval.',
    inputSchema: z.object({ agent_ids: z.array(z.string()) }),
    execute: async (params) => executeWithApproval(
      'create_update_tasks',
      { tier: 'write', description: 'Create agent update tasks' },
      params,
      () => tasksApi.createUpdateTasks({ org_id: 'default', agent_ids: params.agent_ids }),
    ),
  }),
  update_agent: tool({
    description: 'Propose changing an agent status (active/disabled). Requires exact terminal approval.',
    inputSchema: z.object({
      id: z.string(),
      status: z.enum(['active', 'disabled']),
    }),
    execute: async (params) => executeWithApproval(
      'update_agent',
      { tier: 'destructive', description: 'Change an agent status' },
      params,
      () => agentsApi.updateAgent(params.id, { status: params.status }),
    ),
  }),
  add_agent_tag: tool({
    description: 'Propose adding a tag to an agent. Requires terminal approval.',
    inputSchema: z.object({ id: z.string(), tag: z.string() }),
    execute: async (params) => executeWithApproval(
      'add_agent_tag',
      { tier: 'write', description: 'Add an agent tag' },
      params,
      () => agentsApi.addTag(params.id, params.tag),
    ),
  }),
  remove_agent_tag: tool({
    description: 'Propose removing a tag from an agent. Requires terminal approval.',
    inputSchema: z.object({ id: z.string(), tag: z.string() }),
    execute: async (params) => executeWithApproval(
      'remove_agent_tag',
      { tier: 'write', description: 'Remove an agent tag' },
      params,
      () => agentsApi.removeTag(params.id, params.tag),
    ),
  }),
  update_task_notes: tool({
    description: 'Propose adding or updating task notes. Requires terminal approval.',
    inputSchema: z.object({ id: z.string(), content: z.string() }),
    execute: async (params) => executeWithApproval(
      'update_task_notes',
      { tier: 'write', description: 'Update task notes' },
      params,
      () => tasksApi.updateNotes(params.id, params.content),
    ),
  }),
  update_schedule: tool({
    description: 'Propose updating a schedule (pause, resume, or rename). Requires terminal approval.',
    inputSchema: z.object({
      id: z.string(),
      status: z.enum(['active', 'paused']).optional(),
      name: z.string().optional(),
    }),
    execute: async (params) => executeWithApproval(
      'update_schedule',
      { tier: 'write', description: 'Update a schedule' },
      params,
      () => {
        const { id, ...update } = params;
        return schedulesApi.updateSchedule(id, update);
      },
    ),
  }),
  trigger_sync: tool({
    description: 'Propose a git sync of the test library. Requires terminal approval.',
    inputSchema: z.object({}),
    execute: async (params) => executeWithApproval(
      'trigger_sync',
      { tier: 'write', description: 'Sync the test library' },
      params,
      () => browserApi.syncTests(),
    ),
  }),
  build_test: tool({
    description: 'Propose building and signing a test binary. Requires terminal approval.',
    inputSchema: z.object({ uuid: z.string() }),
    execute: async (params) => executeWithApproval(
      'build_test',
      { tier: 'write', description: 'Build and sign a test binary' },
      params,
      () => buildsApi.createBuild(params.uuid),
    ),
  }),
  accept_risk: tool({
    description: 'Propose a risk acceptance for a test or control. Requires exact terminal approval.',
    inputSchema: z.object({
      test_name: z.string(),
      control_id: z.string().optional(),
      hostname: z.string().optional(),
      justification: z.string(),
    }),
    execute: async (params) => executeWithApproval(
      'accept_risk',
      { tier: 'destructive', description: 'Create a risk acceptance' },
      params,
      () => riskApi.acceptRisk(params),
    ),
  }),
  invite_user: tool({
    description: 'Propose inviting a new team user. Requires exact terminal approval.',
    inputSchema: z.object({
      email: z.string(),
      role: z.enum(['admin', 'operator', 'analyst', 'explorer']),
    }),
    execute: async (params) => executeWithApproval(
      'invite_user',
      { tier: 'destructive', description: 'Invite a user to the team' },
      params,
      () => usersApi.inviteUser(params.email, params.role),
    ),
  }),

  // ─── Destructive Tools ────────────────────────────────────────────────────

  delete_agent: tool({
    description: 'Propose decommissioning (soft-deleting) an agent. Requires exact terminal approval.',
    inputSchema: z.object({ id: z.string() }),
    execute: async (params) => executeWithApproval(
      'delete_agent',
      { tier: 'destructive', description: 'Decommission an agent' },
      params,
      () => agentsApi.deleteAgent(params.id),
    ),
  }),
  rotate_agent_key: tool({
    description: 'Propose rotating an agent API key. Requires exact terminal approval.',
    inputSchema: z.object({ id: z.string() }),
    execute: async (params) => executeWithApproval(
      'rotate_agent_key',
      { tier: 'destructive', description: 'Rotate an agent API key' },
      params,
      () => agentsApi.rotateKey(params.id),
    ),
  }),
  revoke_token: tool({
    description: 'Propose revoking an enrollment token. Requires exact terminal approval.',
    inputSchema: z.object({ id: z.string() }),
    execute: async (params) => executeWithApproval(
      'revoke_token',
      { tier: 'destructive', description: 'Revoke an enrollment token' },
      params,
      () => tokensApi.revokeToken(params.id),
    ),
  }),
  cancel_task: tool({
    description: 'Propose cancelling a pending or assigned task. Requires exact terminal approval.',
    inputSchema: z.object({ id: z.string() }),
    execute: async (params) => executeWithApproval(
      'cancel_task',
      { tier: 'destructive', description: 'Cancel a task' },
      params,
      () => tasksApi.cancelTask(params.id),
    ),
  }),
  delete_task: tool({
    description: 'Propose deleting a completed, failed, or expired task. Requires exact terminal approval.',
    inputSchema: z.object({ id: z.string() }),
    execute: async (params) => executeWithApproval(
      'delete_task',
      { tier: 'destructive', description: 'Delete a task' },
      params,
      () => tasksApi.deleteTask(params.id),
    ),
  }),
  delete_schedule: tool({
    description: 'Propose deleting a schedule. Requires exact terminal approval.',
    inputSchema: z.object({ id: z.string() }),
    execute: async (params) => executeWithApproval(
      'delete_schedule',
      { tier: 'destructive', description: 'Delete a schedule' },
      params,
      () => schedulesApi.deleteSchedule(params.id),
    ),
  }),
  create_uninstall_tasks: tool({
    description: 'Propose uninstall tasks to remove agents from endpoints. Requires exact terminal approval.',
    inputSchema: z.object({
      agent_ids: z.array(z.string()),
      cleanup: z.boolean().optional(),
    }),
    execute: async (params) => executeWithApproval(
      'create_uninstall_tasks',
      { tier: 'destructive', description: 'Uninstall agents from endpoints' },
      params,
      () => tasksApi.createUninstallTasks({
        org_id: 'default',
        agent_ids: params.agent_ids,
        cleanup: params.cleanup,
      }),
    ),
  }),
  delete_build: tool({
    description: 'Propose deleting a build artifact. Requires exact terminal approval.',
    inputSchema: z.object({ uuid: z.string() }),
    execute: async (params) => executeWithApproval(
      'delete_build',
      { tier: 'destructive', description: 'Delete a build artifact' },
      params,
      () => buildsApi.deleteBuild(params.uuid),
    ),
  }),
  delete_certificate: tool({
    description: 'Propose deleting a signing certificate. Requires exact terminal approval.',
    inputSchema: z.object({ id: z.string() }),
    execute: async (params) => executeWithApproval(
      'delete_certificate',
      { tier: 'destructive', description: 'Delete a signing certificate' },
      params,
      () => certsApi.deleteCertificate(params.id),
    ),
  }),
  revoke_risk_acceptance: tool({
    description: 'Propose revoking an active risk acceptance. Requires exact terminal approval.',
    inputSchema: z.object({ id: z.string(), reason: z.string() }),
    execute: async (params) => executeWithApproval(
      'revoke_risk_acceptance',
      { tier: 'destructive', description: 'Revoke a risk acceptance' },
      params,
      () => riskApi.revokeRiskAcceptance(params.id, params.reason),
    ),
  }),
  delete_user: tool({
    description: 'Propose deleting a user from the team. Requires exact terminal approval.',
    inputSchema: z.object({ userId: z.string() }),
    execute: async (params) => executeWithApproval(
      'delete_user',
      { tier: 'destructive', description: 'Delete a user from the team' },
      params,
      () => usersApi.deleteUser(params.userId),
    ),
  }),
  };
}

/**
 * Build the tools for one chat session.
 *
 * Non-interactive callers receive read tools only. Interactive callers may
 * expose state-changing proposal tools, but every API mutation is behind the
 * supplied terminal approval boundary.
 */
export function createChatTools(requestApproval?: RequestApproval) {
  if (!requestApproval) return readTools;
  return { ...readTools, ...createApprovedTools(requestApproval) };
}
