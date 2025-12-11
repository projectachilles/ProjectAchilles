// Analytics module types

// Elasticsearch settings stored in config file
export interface AnalyticsSettings {
  connectionType: 'cloud' | 'direct';
  cloudId?: string;
  node?: string;
  apiKey?: string;
  username?: string;
  password?: string;
  indexPattern: string;
  configured: boolean;
}

// Defense score response
export interface DefenseScoreResponse {
  score: number;
  protectedCount: number;
  unprotectedCount: number;
  totalExecutions: number;
}

// Trend data point
export interface TrendDataPoint {
  timestamp: string;
  score: number;
  total: number;
  protected: number;
}

// Breakdown item (for by-test, by-technique)
export interface BreakdownItem {
  name: string;
  score: number;
  count: number;
  protected: number;
}

// Test execution record
export interface TestExecution {
  test_uuid: string;
  test_name: string;
  hostname: string;
  is_protected: boolean;
  org: string;
  timestamp: string;
  error_code?: number;
  error_name?: string;
}

// Organization info
export interface OrganizationInfo {
  uuid: string;
  shortName: string;
  fullName: string;
}

// Query parameters for analytics endpoints
export interface AnalyticsQueryParams {
  org?: string;
  from?: string;
  to?: string;
  interval?: string;
  limit?: number;
  tests?: string;      // comma-separated test names/UUIDs
  techniques?: string; // comma-separated technique IDs
}

// Organization breakdown
export interface OrgBreakdownItem {
  org: string;
  orgName: string;
  score: number;
  count: number;
  protected: number;
}

// Error type breakdown (for pie chart)
export interface ErrorTypeBreakdown {
  name: string;
  count: number;
}

// Test coverage item (protected vs unprotected counts)
export interface TestCoverageItem {
  name: string;
  protected: number;
  unprotected: number;
}

// Technique distribution item (protected vs unprotected counts)
export interface TechniqueDistributionItem {
  technique: string;
  protected: number;
  unprotected: number;
}

// Host-test matrix cell (for heatmap)
export interface HostTestMatrixCell {
  hostname: string;
  testName: string;
  count: number;
}
