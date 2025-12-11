/**
 * Frontend Type Definitions for Endpoints Module
 * Based on backend API types
 */

// Platform constants
export const Platform = {
  WINDOWS: 'windows',
  MACOS: 'macos',
  LINUX: 'linux',
  LC_SECOPS: 'lc_secops',
} as const;

export type PlatformType = typeof Platform[keyof typeof Platform];

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
  offset?: number;
  withTags?: boolean;
  withIp?: string;
  withHostnamePrefix?: string;
  onlyOnline?: boolean;
  filterTag?: string;
  filterHostname?: string;
  filterPlatform?: PlatformType;
}

export interface PaginatedSensorsResponse {
  sensors: Sensor[];
  total: number;
  page: number;
  pageSize: number;
  hasMore: boolean;
}

// ============================================================================
// AUTHENTICATION
// ============================================================================

export interface LoginRequest {
  oid: string;
  apiKey: string;
  orgName?: string;
  saveCredentials?: boolean;
}

export interface LoginResponse {
  sessionId: string;
  organizations: Array<{
    id: string;
    name: string;
    oid: string;
  }>;
  currentOrg: {
    id: string;
    name: string;
    oid: string;
  };
}

export interface SessionInfo {
  authenticated: boolean;
  organizations?: Array<{
    id: string;
    name: string;
    oid: string;
  }>;
  currentOrg?: {
    id: string;
    name: string;
    oid: string;
  };
}

// ============================================================================
// TASKS
// ============================================================================

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

export interface TaskResult {
  error?: string;
  id?: string;
}

export interface TaskResults {
  results: Record<string, TaskResult>;
  summary: {
    total: number;
    successful: number;
    failed: number;
  };
}

export interface TaskSensorRequest {
  tasks: string[];
  investigationId?: string;
}

export interface RunCommandOnSensorRequest {
  command: string;
  investigationId?: string;
}

export interface PutFileOnSensorRequest {
  sourcePath: string;
  destPath: string;
  investigationId?: string;
}

// ============================================================================
// PAYLOADS
// ============================================================================

export interface Payload {
  name: string;
  size?: number;
  uploadedAt?: string;
  uploadedBy?: string;
}

export interface UploadPayloadResponse {
  name: string;
  message: string;
}

export interface PayloadListResponse {
  payloads: Payload[];
  count: number;
}

// ============================================================================
// EVENTS
// ============================================================================

export interface Event {
  event: Record<string, any>;
  event_type?: string;
  event_time?: number | string;
  ts?: string;
  sid?: string;
  hostname?: string;
  routing?: {
    sid?: string;
    hostname?: string;
    event_type?: string;
    event_time?: number | string;
    event?: {
      HOSTNAME?: string;
      [key: string]: any;
    };
    [key: string]: any;
  };
  receipt?: Record<string, any>;
}

export interface EventsQueryRequest {
  query: string;
  limit?: number;
  timeout?: number;
}

export interface EventsQueryResponse {
  results: Event[];
  stats?: Record<string, any>;
}

// ============================================================================
// API RESPONSES
// ============================================================================

export interface ApiResponse<T = any> {
  success: boolean;
  data?: T;
  error?: string;
  message?: string;
}

// ============================================================================
// WEBSOCKET
// ============================================================================

export interface WebSocketMessage {
  type: 'sensor_status' | 'task_update' | 'event';
  data: any;
  timestamp: Date;
}
