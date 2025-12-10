// Endpoints module types for LimaCharlie API

// Platform constants
export const Platform = {
  WINDOWS: 'windows',
  MACOS: 'macos',
  LINUX: 'linux',
  LC_SECOPS: 'lc_secops',
} as const;

export type PlatformType = (typeof Platform)[keyof typeof Platform];

export const PlatformID = {
  WINDOWS: 268435456,
  MACOS: 805306368,
  LINUX: 536870912,
} as const;

// Credentials
export interface Credentials {
  oid: string;
  apiKey: string;
}

// JWT payload structure
export interface JWTPayload {
  exp: number;
  iat: number;
  sub: string;
  oid: string;
}

// JWT response from LimaCharlie
export interface JWTResponse {
  jwt: string;
}

// Sensor
export interface Sensor {
  sid: string;
  hostname: string;
  plat: number;
  arch: number;
  oid: string;
  tags?: string[];
  is_online?: boolean;
  alive?: string;
  enrollment_time?: string;
  ext_ip?: string;
  int_ip?: string;
  version?: string;
  mac_addr?: string;
  is_isolated?: boolean;
  should_isolate?: boolean;
  is_sealed?: boolean;
}

// List sensors request options
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

// List sensors response
export interface ListSensorsResponse {
  sensors: Sensor[];
}

// Payload
export interface Payload {
  name: string;
  size?: number;
  uploadedAt?: string;
  uploadedBy?: string;
}

// Event
export interface Event {
  data: Record<string, any>;
  event_type?: string;
  timestamp?: Date;
  sid?: string;
  routing?: Record<string, any>;
  receipt?: Record<string, any>;
}

// Query events request
export interface QueryEventsRequest {
  query?: string;
  sensorId?: string;
  investigationId?: string;
  limit: number;
}

// Query events response
export interface QueryEventsResponse {
  events: Event[];
}

// Task status
export type TaskStatus = 'pending' | 'success' | 'failed' | 'timeout' | 'no_response';

// Task result
export interface TaskResult {
  sensorId: string;
  status: TaskStatus;
  output?: string;
  error?: string;
}

// API response wrapper
export interface ApiResponse<T = any> {
  success: boolean;
  data?: T;
  error?: string;
}
