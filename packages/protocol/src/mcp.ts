export const MCP_VIEW_COMMAND_CHANNEL = 'mcp-view:command';
export const MCP_VIEW_GET_STATE_CHANNEL = 'mcp-view:get-state';
export const MCP_VIEW_STATE_CHANNEL = 'mcp-view:state';

export const mcpViewActions = ['open', 'close', 'toggle', 'refresh', 'selfTest'] as const;
export const mcpIndicatorColors = ['green', 'yellow', 'red'] as const;
export const mcpLifecycleStates = ['starting', 'listening', 'stopped', 'error'] as const;
export const mcpSelfTestStatuses = ['idle', 'running', 'passed', 'failed'] as const;
export const mcpRequestOutcomes = ['success', 'error', 'rejected'] as const;

export type McpViewAction = (typeof mcpViewActions)[number];
export type McpIndicatorColor = (typeof mcpIndicatorColors)[number];
export type McpLifecycleState = (typeof mcpLifecycleStates)[number];
export type McpSelfTestStatus = (typeof mcpSelfTestStatuses)[number];
export type McpRequestOutcome = (typeof mcpRequestOutcomes)[number];

export type McpViewCommand = {
  action: McpViewAction;
};

export interface McpRecentRequest {
  at: string;
  method: string;
  detail: string;
  outcome: McpRequestOutcome;
}

export interface McpSelfTestSummary {
  status: McpSelfTestStatus;
  checkedAt: string | null;
  summary: string;
  healthOk: boolean | null;
  initializeOk: boolean | null;
  toolsListOk: boolean | null;
}

export interface McpViewState {
  isOpen: boolean;
  indicator: McpIndicatorColor;
  lifecycle: McpLifecycleState;
  statusLabel: string;
  transportUrl: string;
  host: string;
  port: number | null;
  authType: string;
  authTokenPreview: string | null;
  hasAuthToken: boolean;
  registrationFile: string;
  tools: string[];
  requestCount: number;
  lastRequestAt: string | null;
  recentRequests: McpRecentRequest[];
  lastSelfTest: McpSelfTestSummary;
  lastError: string | null;
  lastUpdatedAt: string | null;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

export const createEmptyMcpViewState = (): McpViewState => ({
  isOpen: false,
  indicator: 'yellow',
  lifecycle: 'starting',
  statusLabel: 'Starting MCP server...',
  transportUrl: '',
  host: '',
  port: null,
  authType: 'Bearer token',
  authTokenPreview: null,
  hasAuthToken: false,
  registrationFile: '',
  tools: [],
  requestCount: 0,
  lastRequestAt: null,
  recentRequests: [],
  lastSelfTest: {
    status: 'idle',
    checkedAt: null,
    summary: 'Waiting for initial verification.',
    healthOk: null,
    initializeOk: null,
    toolsListOk: null,
  },
  lastError: null,
  lastUpdatedAt: null,
});

export const isMcpViewCommand = (value: unknown): value is McpViewCommand => {
  if (!isRecord(value) || typeof value.action !== 'string') {
    return false;
  }

  return mcpViewActions.includes(value.action as McpViewAction);
};

const isMcpRecentRequest = (value: unknown): value is McpRecentRequest => {
  if (!isRecord(value)) {
    return false;
  }

  return (
    typeof value.at === 'string' &&
    typeof value.method === 'string' &&
    typeof value.detail === 'string' &&
    typeof value.outcome === 'string' &&
    mcpRequestOutcomes.includes(value.outcome as McpRequestOutcome)
  );
};

const isMcpSelfTestSummary = (value: unknown): value is McpSelfTestSummary => {
  if (!isRecord(value)) {
    return false;
  }

  return (
    typeof value.status === 'string' &&
    mcpSelfTestStatuses.includes(value.status as McpSelfTestStatus) &&
    (typeof value.checkedAt === 'string' || value.checkedAt === null) &&
    typeof value.summary === 'string' &&
    (typeof value.healthOk === 'boolean' || value.healthOk === null) &&
    (typeof value.initializeOk === 'boolean' || value.initializeOk === null) &&
    (typeof value.toolsListOk === 'boolean' || value.toolsListOk === null)
  );
};

export const isMcpViewState = (value: unknown): value is McpViewState => {
  if (!isRecord(value)) {
    return false;
  }

  return (
    typeof value.isOpen === 'boolean' &&
    typeof value.indicator === 'string' &&
    mcpIndicatorColors.includes(value.indicator as McpIndicatorColor) &&
    typeof value.lifecycle === 'string' &&
    mcpLifecycleStates.includes(value.lifecycle as McpLifecycleState) &&
    typeof value.statusLabel === 'string' &&
    typeof value.transportUrl === 'string' &&
    typeof value.host === 'string' &&
    (typeof value.port === 'number' || value.port === null) &&
    typeof value.authType === 'string' &&
    (typeof value.authTokenPreview === 'string' || value.authTokenPreview === null) &&
    typeof value.hasAuthToken === 'boolean' &&
    typeof value.registrationFile === 'string' &&
    Array.isArray(value.tools) &&
    value.tools.every((entry) => typeof entry === 'string') &&
    typeof value.requestCount === 'number' &&
    (typeof value.lastRequestAt === 'string' || value.lastRequestAt === null) &&
    Array.isArray(value.recentRequests) &&
    value.recentRequests.every(isMcpRecentRequest) &&
    isMcpSelfTestSummary(value.lastSelfTest) &&
    (typeof value.lastError === 'string' || value.lastError === null) &&
    (typeof value.lastUpdatedAt === 'string' || value.lastUpdatedAt === null)
  );
};
