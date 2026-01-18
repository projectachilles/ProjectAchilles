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

// ============================================
// Enriched Types (for new fields)
// ============================================

// Severity levels
export type SeverityLevel = 'critical' | 'high' | 'medium' | 'low' | 'info';

// Category types
export type CategoryType = 'intel-driven' | 'mitre-top10' | 'cyber-hygiene' | 'phase-aligned';

// Enriched test execution with new fields
export interface EnrichedTestExecution extends TestExecution {
  category?: CategoryType;
  subcategory?: string;
  severity?: SeverityLevel;
  tactics?: string[];
  target?: string;
  complexity?: 'low' | 'medium' | 'high';
  threat_actor?: string;
  tags?: string[];
  score?: number;
}

// Pagination support
export interface PaginationParams {
  page?: number;
  pageSize?: number;
  sortField?: string;
  sortOrder?: 'asc' | 'desc';
}

export interface PaginatedResponse<T> {
  data: T[];
  pagination: {
    page: number;
    pageSize: number;
    totalItems: number;
    totalPages: number;
    hasNext: boolean;
    hasPrevious: boolean;
  };
}

// Extended query params with new filters
export interface ExtendedAnalyticsQueryParams extends AnalyticsQueryParams {
  hostnames?: string;      // comma-separated hostnames
  categories?: string;     // comma-separated categories
  severities?: string;     // comma-separated severity levels
  threatActors?: string;   // comma-separated threat actor names
  tags?: string;           // comma-separated tags
  result?: 'all' | 'protected' | 'unprotected';
}

// Combined query params for paginated executions
export interface PaginatedExecutionsParams extends ExtendedAnalyticsQueryParams, PaginationParams {}

// Filter option with count
export interface FilterOption {
  value: string;
  label: string;
  count: number;
}

// Severity breakdown item
export interface SeverityBreakdownItem {
  severity: SeverityLevel;
  score: number;
  count: number;
  protected: number;
  unprotected: number;
}

// Category breakdown item
export interface CategoryBreakdownItem {
  category: CategoryType;
  score: number;
  count: number;
  protected: number;
  unprotected: number;
}

// Threat actor coverage item
export interface ThreatActorCoverageItem {
  threatActor: string;
  coverage: number;
  testCount: number;
  protectedCount: number;
  totalExecutions: number;
}
