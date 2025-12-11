/**
 * TypeScript type definitions for LimaCharlie API
 * Based on internal/api/types.go
 */

// Platform constants
export const Platform = {
  WINDOWS: 'windows',
  MACOS: 'macos',
  LINUX: 'linux',
  LC_SECOPS: 'lc_secops',
} as const;

export type PlatformType = typeof Platform[keyof typeof Platform];

export const PlatformID = {
  WINDOWS: 268435456,
  MACOS: 805306368,
  LINUX: 536870912,
  // LC_SECOPS doesn't have a fixed ID - it's any non-standard platform
} as const;

// Architecture constants
export const Architecture = {
  X86: 'x86',
  X64: 'x64',
  ARM: 'arm',
  ARM64: 'arm64',
} as const;

export type ArchitectureType = typeof Architecture[keyof typeof Architecture];

// ============================================================================
// CREDENTIALS & AUTHENTICATION
// ============================================================================

export interface Credentials {
  oid: string;
  apiKey: string;
  jwt?: string;
  expiry?: Date;
}

export interface JWTPayload {
  exp: number;
  iat: number;
  sub: string;
  oid: string;
}

export interface JWTResponse {
  jwt: string;
}

// ============================================================================
// SENSORS
// ============================================================================

export interface Sensor {
  sid: string;
  hostname: string;
  plat: number; // API returns "plat" not "plat_id"
  arch: number;
  oid: string;
  tags?: string[];
  is_online?: boolean;
  alive?: string; // API returns "alive" for last_seen
  enrollment_time?: string;
  ext_ip?: string; // API returns "ext_ip" not "external_ip"
  int_ip?: string; // API returns "int_ip" not "internal_ip"
  version?: string;
  mac_addr?: string;
  is_isolated?: boolean;
  should_isolate?: boolean;
  is_sealed?: boolean;
}

export interface ListSensorsRequest {
  limit?: number;
  offset?: number; // Added for ProjectAchilles compatibility
  withTags?: boolean;
  withIp?: string;
  withHostnamePrefix?: string;
  onlyOnline?: boolean;
  filterTag?: string;
  filterHostname?: string;
  filterPlatform?: PlatformType;
}

export interface ListSensorsResponse {
  sensors: Sensor[];
  total: number; // Added for pagination support
}

export interface OnlineStatusResponse {
  statuses: Record<string, boolean>;
}

export interface TagSensorRequest {
  tag: string;
  ttl?: number;
}

export interface UntagSensorRequest {
  tag: string;
}

// ============================================================================
// TASKS
// ============================================================================

export interface TaskRequest {
  tasks: string[];
  investigation_id?: string;
}

export interface TaskResponse {
  error?: string;
  id?: string;
}

export interface ReliableTaskRequest {
  task: string;
  ttl: number;
  sid: string;
  context: string;
}

export interface PutPayloadRequest {
  payloadName: string;
  payloadPath: string;
  filterHostname?: string;
  filterTag?: string;
  filterPlatform?: PlatformType;
  investigationId?: string;
  context?: string;
  ttl?: number;
  onlineOnly?: boolean;
}

export interface RunCommandRequest {
  command?: string;
  payloadName?: string;
  payloadBasePath?: string;
  filterHostname?: string;
  filterTag?: string;
  filterPlatform?: PlatformType;
  investigationId?: string;
  context?: string;
  ttl?: number;
  onlineOnly?: boolean;
}

export type TaskStatus = 'pending' | 'success' | 'failed' | 'timeout' | 'no_response';

export interface TaskExecution {
  id: string;
  sensorId: string;
  hostname: string;
  command: string;
  status: TaskStatus;
  investigationId?: string;
  createdAt: Date;
  updatedAt: Date;
  output?: string;
  error?: string;
}

// ============================================================================
// PAYLOADS
// ============================================================================

export interface UploadPayloadRequest {
  filePath: string;
}

export interface UploadPayloadResponse {
  url: string;
  name: string;
}

export interface DownloadPayloadRequest {
  name: string;
}

export interface DownloadPayloadResponse {
  url: string;
}

export interface Payload {
  name: string;
  size?: number;
  uploadedAt?: string;
  uploadedBy?: string;
}

// ============================================================================
// EVENTS
// ============================================================================

export interface Event {
  data: Record<string, any>;
  event_type?: string;
  timestamp?: Date;
  sid?: string;
  routing?: Record<string, any>;
  receipt?: Record<string, any>;
}

export interface QueryEventsRequest {
  query: string;
  limitEvent: number;
  timeout?: number;
}

export interface QueryEventsResponse {
  events: Event[];
  stats?: {
    total_events: number;
    execution_time_ms: number;
  };
}

// ============================================================================
// JOBS
// ============================================================================

export interface Job {
  job_id: string;
  oid: string;
  sid?: string;
  created_at: number;
  updated_at: number;
  status: string;
  type: string;
  data?: Record<string, any>;
  result?: Record<string, any>;
  error?: string;
}

export interface JobListOptions {
  start?: number;
  end?: number;
  limit?: number;
  sensorId?: string;
  isCompressed?: boolean;
  withData?: boolean;
}

export interface JobListResponse {
  jobs: Job[];
  cursor?: string;
}

// ============================================================================
// COMMANDS
// ============================================================================

export interface CommandArg {
  name: string;
  type: 'string' | 'number' | 'boolean';
  required: boolean;
  description?: string;
}

export interface EndpointCommand {
  name: string;
  description: string;
  category: string;
  args: CommandArg[];
  responseEvent?: string;
  example?: string;
  supportsOutput: boolean;
}

export interface CommandResponse {
  sensorId: string;
  hostname: string;
  command: string;
  status: TaskStatus;
  output?: string;
  data?: Record<string, any>;
  error?: string;
  eventType?: string;
  timestamp?: string;
  investigationId?: string;
  executionTime?: number;
}

// ============================================================================
// API ERRORS
// ============================================================================

export enum TaskErrorType {
  AUTH = 'auth',
  NETWORK = 'network',
  SERVER = 'server',
  GENERAL = 'general',
}

export interface TaskError {
  type: TaskErrorType;
  message: string;
  statusCode?: number;
  details?: any;
}

// ============================================================================
// WEBSOCKET
// ============================================================================

export interface WebSocketMessage {
  type: 'sensor_status' | 'task_update' | 'event';
  data: any;
  timestamp: Date;
}

export interface SensorStatusUpdate {
  sensorId: string;
  isOnline: boolean;
  lastSeen: string;
}

export interface TaskStatusUpdate {
  taskId: string;
  sensorId: string;
  status: TaskStatus;
  output?: string;
  error?: string;
}

// ============================================================================
// SESSION & AUTH
// ============================================================================

export interface UserSession {
  id: string;
  organizations: SavedOrganization[];
  currentOrgId?: string;
  createdAt: Date;
  lastAccessedAt: Date;
}

export interface SavedOrganization {
  id: string;
  name: string;
  oid: string;
  apiKey: string;
  createdAt: Date;
}

export interface LoginRequest {
  oid: string;
  apiKey: string;
  orgName?: string;
  saveCredentials?: boolean;
}

export interface LoginResponse {
  sessionId: string;
  organizations: Array<{ id: string; name: string; oid: string }>;
  currentOrg: { id: string; name: string; oid: string };
}

export interface SwitchOrgRequest {
  orgId: string;
}

// ============================================================================
// API RESPONSES (STANDARD)
// ============================================================================

export interface ApiResponse<T = any> {
  success: boolean;
  data?: T;
  error?: string;
  message?: string;
}

export interface PaginatedResponse<T> {
  data: T[];
  total: number;
  page: number;
  pageSize: number;
  hasMore: boolean;
}
