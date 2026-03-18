/**
 * AI SDK tool definitions for the chat agent.
 *
 * Each tool maps to one or more API client methods. Tools are categorized by
 * approval tier: read (no approval), write (brief), destructive (explicit).
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
import * as buildsApi from '../api/builds.js';
import * as certsApi from '../api/certs.js';
import * as integrationsApi from '../api/integrations.js';
import * as riskApi from '../api/risk.js';
import * as usersApi from '../api/users.js';

// ─── Read Tools (no approval) ───────────────────────────────────────────────

export const readTools = {
  // Agents
  list_agents: tool({
    description: 'List enrolled agents with optional filters. Returns hostname, OS, arch, status, and online state.',
    parameters: z.object({
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
    parameters: z.object({ id: z.string() }),
    execute: async ({ id }) => agentsApi.getAgent(id),
  }),
  get_agent_heartbeats: tool({
    description: 'Get heartbeat history (CPU, memory, disk) for an agent.',
    parameters: z.object({ id: z.string(), days: z.number().optional().default(7) }),
    execute: async ({ id, days }) => agentsApi.getHeartbeats(id, days),
  }),
  get_agent_events: tool({
    description: 'Get event log for an agent (enrolled, went_offline, task_completed, etc.).',
    parameters: z.object({ id: z.string(), limit: z.number().optional().default(20) }),
    execute: async ({ id, limit }) => agentsApi.getEvents(id, { limit }),
  }),
  get_fleet_metrics: tool({
    description: 'Get fleet-wide metrics: total agents, online/offline counts, by OS breakdown.',
    parameters: z.object({}),
    execute: async () => agentsApi.getMetrics(),
  }),
  get_fleet_health: tool({
    description: 'Get fleet health KPIs: uptime %, task success rate, MTBF, stale agents.',
    parameters: z.object({}),
    execute: async () => agentsApi.getFleetHealth(),
  }),

  // Tokens
  list_tokens: tool({
    description: 'List active enrollment tokens.',
    parameters: z.object({ org_id: z.string().optional().default('default') }),
    execute: async ({ org_id }) => tokensApi.listTokens(org_id),
  }),

  // Tasks
  list_tasks: tool({
    description: 'List tasks with optional filters (status, type, agent_id, search text).',
    parameters: z.object({
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
    parameters: z.object({ id: z.string() }),
    execute: async ({ id }) => tasksApi.getTask(id),
  }),

  // Schedules
  list_schedules: tool({
    description: 'List recurring test schedules.',
    parameters: z.object({ status: z.enum(['active', 'paused', 'completed', 'deleted']).optional() }),
    execute: async ({ status }) => schedulesApi.listSchedules({ status }),
  }),
  get_schedule: tool({
    description: 'Get details of a specific schedule.',
    parameters: z.object({ id: z.string() }),
    execute: async ({ id }) => schedulesApi.getSchedule(id),
  }),

  // Versions
  list_versions: tool({
    description: 'List registered agent binary versions.',
    parameters: z.object({}),
    execute: async () => versionsApi.listVersions(),
  }),

  // Browser
  list_tests: tool({
    description: 'Search the security test library. Filter by name, technique, category, or severity.',
    parameters: z.object({
      search: z.string().optional(),
      technique: z.string().optional().describe('MITRE technique ID (e.g., T1059)'),
      category: z.string().optional(),
      severity: z.enum(['critical', 'high', 'medium', 'low', 'informational']).optional(),
    }),
    execute: async (params) => browserApi.listTests(params),
  }),
  get_test: tool({
    description: 'Get full details of a security test by UUID.',
    parameters: z.object({ uuid: z.string() }),
    execute: async ({ uuid }) => browserApi.getTest(uuid),
  }),
  get_categories: tool({
    description: 'List all available test categories.',
    parameters: z.object({}),
    execute: async () => browserApi.getCategories(),
  }),

  // Analytics
  get_defense_score: tool({
    description: 'Get the current defense score (0-100%). Higher = better defense coverage.',
    parameters: z.object({
      org: z.string().optional(),
      from: z.string().optional().describe('Start date ISO'),
      to: z.string().optional().describe('End date ISO'),
    }),
    execute: async (params) => analyticsApi.getDefenseScore(params),
  }),
  get_score_trend: tool({
    description: 'Get defense score trend over time.',
    parameters: z.object({
      interval: z.string().optional().default('1d'),
      windowDays: z.number().optional().default(30),
    }),
    execute: async (params) => analyticsApi.getScoreTrend(params),
  }),
  get_score_by_test: tool({
    description: 'Get defense score breakdown by individual test.',
    parameters: z.object({ limit: z.number().optional().default(10) }),
    execute: async ({ limit }) => analyticsApi.getScoreByTest({ limit }),
  }),
  get_score_by_technique: tool({
    description: 'Get defense score breakdown by MITRE technique.',
    parameters: z.object({}),
    execute: async () => analyticsApi.getScoreByTechnique(),
  }),
  get_score_by_hostname: tool({
    description: 'Get defense score breakdown by hostname.',
    parameters: z.object({ limit: z.number().optional().default(10) }),
    execute: async ({ limit }) => analyticsApi.getScoreByHostname({ limit }),
  }),
  get_executions: tool({
    description: 'Get recent test executions with outcomes (protected/unprotected/error).',
    parameters: z.object({
      page: z.number().optional().default(1),
      pageSize: z.number().optional().default(20),
    }),
    execute: async (params) => analyticsApi.getExecutionsPaginated(params),
  }),
  get_error_rate: tool({
    description: 'Get the current test error rate.',
    parameters: z.object({}),
    execute: async () => analyticsApi.getErrorRate(),
  }),
  get_test_coverage: tool({
    description: 'Get test coverage matrix — which tests have been run and their protection rates.',
    parameters: z.object({}),
    execute: async () => analyticsApi.getTestCoverage(),
  }),
  get_technique_distribution: tool({
    description: 'Get MITRE technique distribution across executions.',
    parameters: z.object({}),
    execute: async () => analyticsApi.getTechniqueDistribution(),
  }),

  // Defender
  get_secure_score: tool({
    description: 'Get Microsoft Secure Score from Defender integration.',
    parameters: z.object({}),
    execute: async () => defenderApi.getSecureScore(),
  }),
  get_defender_alerts: tool({
    description: 'Get Microsoft Defender alerts with severity and status filters.',
    parameters: z.object({
      severity: z.string().optional(),
      status: z.string().optional(),
      search: z.string().optional(),
      page: z.number().optional().default(1),
    }),
    execute: async (params) => defenderApi.getAlerts(params),
  }),
  get_score_correlation: tool({
    description: 'Get correlation between Defense Score and Microsoft Secure Score over time.',
    parameters: z.object({ days: z.number().optional().default(30) }),
    execute: async ({ days }) => defenderApi.getScoreCorrelation(days),
  }),

  // Builds
  get_build_info: tool({
    description: 'Get build info for a test binary.',
    parameters: z.object({ uuid: z.string() }),
    execute: async ({ uuid }) => buildsApi.getBuild(uuid),
  }),
  get_dependencies: tool({
    description: 'List embed dependencies for a test.',
    parameters: z.object({ uuid: z.string() }),
    execute: async ({ uuid }) => buildsApi.getDependencies(uuid),
  }),

  // Certs
  list_certificates: tool({
    description: 'List code signing certificates.',
    parameters: z.object({}),
    execute: async () => certsApi.listCertificates(),
  }),

  // Integrations
  get_azure_config: tool({
    description: 'Show Azure AD integration configuration (credentials masked).',
    parameters: z.object({}),
    execute: async () => integrationsApi.getAzureConfig(),
  }),
  get_alert_config: tool({
    description: 'Show alerting configuration (thresholds, channels).',
    parameters: z.object({}),
    execute: async () => integrationsApi.getAlertConfig(),
  }),
  get_alert_history: tool({
    description: 'Get alert dispatch history.',
    parameters: z.object({}),
    execute: async () => integrationsApi.getAlertHistory(),
  }),

  // Risk
  list_risk_acceptances: tool({
    description: 'List risk acceptances with optional status filter.',
    parameters: z.object({
      status: z.enum(['active', 'revoked']).optional(),
      test_name: z.string().optional(),
    }),
    execute: async (params) => riskApi.listRiskAcceptances(params),
  }),

  // Users
  list_users: tool({
    description: 'List team members with roles.',
    parameters: z.object({}),
    execute: async () => usersApi.listUsers(),
  }),
  list_invitations: tool({
    description: 'List pending user invitations.',
    parameters: z.object({}),
    execute: async () => usersApi.listInvitations(),
  }),
};

// ─── Write Tools (brief confirmation) ───────────────────────────────────────

export const writeTools = {
  create_token: tool({
    description: 'Create an enrollment token for new agent registration.',
    parameters: z.object({
      org_id: z.string().optional().default('default'),
      ttl_hours: z.number().optional().default(24),
      max_uses: z.number().optional().default(1),
    }),
    execute: async (params) => tokensApi.createToken(params),
  }),
  create_tasks: tool({
    description: 'Create security test execution tasks for one or more agents. Provide the test UUID and agent IDs.',
    parameters: z.object({
      agent_ids: z.array(z.string()).describe('Agent IDs to target'),
      test_uuid: z.string().describe('UUID of the test to execute'),
      priority: z.number().optional(),
    }),
    execute: async (params) => tasksApi.createTasks({
      org_id: 'default',
      agent_ids: params.agent_ids,
      payload: { test_uuid: params.test_uuid, test_name: '', binary_name: '' },
      priority: params.priority,
    }),
  }),
  create_command_task: tool({
    description: 'Execute an arbitrary shell command on agents.',
    parameters: z.object({
      agent_ids: z.array(z.string()),
      command: z.string().describe('Shell command to execute'),
      execution_timeout: z.number().optional(),
    }),
    execute: async (params) => tasksApi.createCommandTask({ org_id: 'default', ...params }),
  }),
  create_update_tasks: tool({
    description: 'Create agent update tasks to push the latest version.',
    parameters: z.object({ agent_ids: z.array(z.string()) }),
    execute: async ({ agent_ids }) => tasksApi.createUpdateTasks({ org_id: 'default', agent_ids }),
  }),
  update_agent: tool({
    description: 'Update an agent\'s status (active/disabled).',
    parameters: z.object({
      id: z.string(),
      status: z.enum(['active', 'disabled']),
    }),
    execute: async ({ id, status }) => agentsApi.updateAgent(id, { status }),
  }),
  add_agent_tag: tool({
    description: 'Add a tag to an agent.',
    parameters: z.object({ id: z.string(), tag: z.string() }),
    execute: async ({ id, tag }) => agentsApi.addTag(id, tag),
  }),
  remove_agent_tag: tool({
    description: 'Remove a tag from an agent.',
    parameters: z.object({ id: z.string(), tag: z.string() }),
    execute: async ({ id, tag }) => agentsApi.removeTag(id, tag),
  }),
  update_task_notes: tool({
    description: 'Add or update notes on a task.',
    parameters: z.object({ id: z.string(), content: z.string() }),
    execute: async ({ id, content }) => tasksApi.updateNotes(id, content),
  }),
  update_schedule: tool({
    description: 'Update a schedule (pause, resume, or modify config).',
    parameters: z.object({
      id: z.string(),
      status: z.enum(['active', 'paused']).optional(),
      name: z.string().optional(),
    }),
    execute: async ({ id, ...update }) => schedulesApi.updateSchedule(id, update),
  }),
  trigger_sync: tool({
    description: 'Trigger a git sync of the test library.',
    parameters: z.object({}),
    execute: async () => browserApi.syncTests(),
  }),
  build_test: tool({
    description: 'Build (compile and sign) a test binary.',
    parameters: z.object({ uuid: z.string() }),
    execute: async ({ uuid }) => buildsApi.createBuild(uuid),
  }),
  accept_risk: tool({
    description: 'Create a risk acceptance for a test or control.',
    parameters: z.object({
      test_name: z.string(),
      control_id: z.string().optional(),
      hostname: z.string().optional(),
      justification: z.string(),
    }),
    execute: async (params) => riskApi.acceptRisk(params),
  }),
  invite_user: tool({
    description: 'Invite a new user to the team.',
    parameters: z.object({
      email: z.string(),
      role: z.enum(['admin', 'operator', 'analyst', 'explorer']),
    }),
    execute: async ({ email, role }) => usersApi.inviteUser(email, role),
  }),
};

// ─── Destructive Tools (explicit confirmation) ──────────────────────────────

export const destructiveTools = {
  delete_agent: tool({
    description: 'Decommission (soft-delete) an agent. This is irreversible.',
    parameters: z.object({ id: z.string() }),
    execute: async ({ id }) => agentsApi.deleteAgent(id),
  }),
  rotate_agent_key: tool({
    description: 'Rotate an agent\'s API key. The agent will pick up the new key on next heartbeat.',
    parameters: z.object({ id: z.string() }),
    execute: async ({ id }) => agentsApi.rotateKey(id),
  }),
  revoke_token: tool({
    description: 'Revoke an enrollment token.',
    parameters: z.object({ id: z.string() }),
    execute: async ({ id }) => tokensApi.revokeToken(id),
  }),
  cancel_task: tool({
    description: 'Cancel a pending or assigned task.',
    parameters: z.object({ id: z.string() }),
    execute: async ({ id }) => tasksApi.cancelTask(id),
  }),
  delete_task: tool({
    description: 'Delete a completed/failed/expired task.',
    parameters: z.object({ id: z.string() }),
    execute: async ({ id }) => tasksApi.deleteTask(id),
  }),
  delete_schedule: tool({
    description: 'Delete a schedule.',
    parameters: z.object({ id: z.string() }),
    execute: async ({ id }) => schedulesApi.deleteSchedule(id),
  }),
  create_uninstall_tasks: tool({
    description: 'Create uninstall tasks to remove the agent from endpoints. This is destructive.',
    parameters: z.object({
      agent_ids: z.array(z.string()),
      cleanup: z.boolean().optional(),
    }),
    execute: async ({ agent_ids, cleanup }) => tasksApi.createUninstallTasks({ org_id: 'default', agent_ids, cleanup }),
  }),
  delete_build: tool({
    description: 'Delete a build artifact.',
    parameters: z.object({ uuid: z.string() }),
    execute: async ({ uuid }) => buildsApi.deleteBuild(uuid),
  }),
  delete_certificate: tool({
    description: 'Delete a signing certificate.',
    parameters: z.object({ id: z.string() }),
    execute: async ({ id }) => certsApi.deleteCertificate(id),
  }),
  revoke_risk_acceptance: tool({
    description: 'Revoke an active risk acceptance.',
    parameters: z.object({ id: z.string(), reason: z.string() }),
    execute: async ({ id, reason }) => riskApi.revokeRiskAcceptance(id, reason),
  }),
  delete_user: tool({
    description: 'Delete a user from the team.',
    parameters: z.object({ userId: z.string() }),
    execute: async ({ userId }) => usersApi.deleteUser(userId),
  }),
};

/** All tools combined for the agent */
export const allTools = {
  ...readTools,
  ...writeTools,
  ...destructiveTools,
};
