import {
  isPanelPresentationMode,
  isPanelSidebarSide,
  type PanelPresentationMode,
  type PanelSidebarSide,
} from './panel-presentation';

export const MCP_VIEW_COMMAND_CHANNEL = 'mcp-view:command';
export const MCP_VIEW_GET_STATE_CHANNEL = 'mcp-view:get-state';
export const MCP_VIEW_STATE_CHANNEL = 'mcp-view:state';

export const mcpViewActions = [
  'open',
  'close',
  'toggle',
  'refresh',
  'selfTest',
  'setPresentation',
  'moveFloatingPill',
] as const;
export const mcpIndicatorColors = ['green', 'yellow', 'red'] as const;
export const mcpLifecycleStates = ['starting', 'listening', 'stopped', 'error'] as const;
export const mcpSelfTestStatuses = ['idle', 'running', 'passed', 'failed'] as const;
export const mcpRequestOutcomes = ['success', 'error', 'rejected'] as const;
export const mcpAgentActivityPhases = ['acknowledged', 'in_progress', 'done'] as const;

export type McpViewAction = (typeof mcpViewActions)[number];
export type McpIndicatorColor = (typeof mcpIndicatorColors)[number];
export type McpLifecycleState = (typeof mcpLifecycleStates)[number];
export type McpSelfTestStatus = (typeof mcpSelfTestStatuses)[number];
export type McpRequestOutcome = (typeof mcpRequestOutcomes)[number];
export type McpAgentActivityPhase = (typeof mcpAgentActivityPhases)[number];

export type McpViewCommand =
  | {
      action: 'open' | 'close' | 'toggle' | 'refresh' | 'selfTest';
    }
  | {
      action: 'setPresentation';
      mode: PanelPresentationMode;
      side?: PanelSidebarSide;
    }
  | {
      action: 'moveFloatingPill';
      deltaX: number;
      deltaY: number;
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
  resourcesListOk: boolean | null;
  resourceTemplatesListOk: boolean | null;
  resourceReadOk: boolean | null;
}

export interface McpAgentActivity {
  annotationId: string;
  phase: McpAgentActivityPhase;
  message: string;
  updatedAt: string;
}

export interface McpViewState {
  isOpen: boolean;
  indicator: McpIndicatorColor;
  lifecycle: McpLifecycleState;
  statusLabel: string;
  setupLabel: string;
  setupTransportUrl: string;
  setupAuthToken: string | null;
  setupRegistrationFile: string;
  transportUrl: string;
  host: string;
  port: number | null;
  authType: string;
  authToken: string | null;
  authTokenPreview: string | null;
  hasAuthToken: boolean;
  registrationFile: string;
  tools: string[];
  requestCount: number;
  lastRequestAt: string | null;
  recentRequests: McpRecentRequest[];
  activeToolCalls: number;
  busySince: string | null;
  lastBusyAt: string | null;
  agentActivity: McpAgentActivity | null;
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
  setupLabel: 'This window',
  setupTransportUrl: '',
  setupAuthToken: null,
  setupRegistrationFile: '',
  transportUrl: '',
  host: '',
  port: null,
  authType: 'Bearer token',
  authToken: null,
  authTokenPreview: null,
  hasAuthToken: false,
  registrationFile: '',
  tools: [],
  requestCount: 0,
  lastRequestAt: null,
  recentRequests: [],
  activeToolCalls: 0,
  busySince: null,
  lastBusyAt: null,
  agentActivity: null,
  lastSelfTest: {
    status: 'idle',
    checkedAt: null,
    summary: 'Waiting for initial verification.',
    healthOk: null,
    initializeOk: null,
    toolsListOk: null,
    resourcesListOk: null,
    resourceTemplatesListOk: null,
    resourceReadOk: null,
  },
  lastError: null,
  lastUpdatedAt: null,
});

export const isMcpViewCommand = (value: unknown): value is McpViewCommand => {
  if (!isRecord(value) || typeof value.action !== 'string') {
    return false;
  }

  if (!mcpViewActions.includes(value.action as McpViewAction)) {
    return false;
  }

  if (value.action === 'setPresentation') {
    return (
      isPanelPresentationMode(value.mode) &&
      (!('side' in value) || value.side === undefined || isPanelSidebarSide(value.side))
    );
  }

  if (value.action === 'moveFloatingPill') {
    return typeof value.deltaX === 'number' && typeof value.deltaY === 'number';
  }

  return true;
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
    (typeof value.toolsListOk === 'boolean' || value.toolsListOk === null) &&
    (typeof value.resourcesListOk === 'boolean' || value.resourcesListOk === null) &&
    (typeof value.resourceTemplatesListOk === 'boolean' ||
      value.resourceTemplatesListOk === null) &&
    (typeof value.resourceReadOk === 'boolean' || value.resourceReadOk === null)
  );
};

export const isMcpAgentActivityPhase = (value: unknown): value is McpAgentActivityPhase =>
  typeof value === 'string' && mcpAgentActivityPhases.includes(value as McpAgentActivityPhase);

const isMcpAgentActivity = (value: unknown): value is McpAgentActivity => {
  if (!isRecord(value)) {
    return false;
  }

  return (
    typeof value.annotationId === 'string' &&
    isMcpAgentActivityPhase(value.phase) &&
    typeof value.message === 'string' &&
    typeof value.updatedAt === 'string'
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
    typeof value.setupLabel === 'string' &&
    typeof value.setupTransportUrl === 'string' &&
    (typeof value.setupAuthToken === 'string' || value.setupAuthToken === null) &&
    typeof value.setupRegistrationFile === 'string' &&
    typeof value.transportUrl === 'string' &&
    typeof value.host === 'string' &&
    (typeof value.port === 'number' || value.port === null) &&
    typeof value.authType === 'string' &&
    (typeof value.authToken === 'string' || value.authToken === null) &&
    (typeof value.authTokenPreview === 'string' || value.authTokenPreview === null) &&
    typeof value.hasAuthToken === 'boolean' &&
    typeof value.registrationFile === 'string' &&
    Array.isArray(value.tools) &&
    value.tools.every((entry) => typeof entry === 'string') &&
    typeof value.requestCount === 'number' &&
    (typeof value.lastRequestAt === 'string' || value.lastRequestAt === null) &&
    Array.isArray(value.recentRequests) &&
    value.recentRequests.every(isMcpRecentRequest) &&
    typeof value.activeToolCalls === 'number' &&
    (typeof value.busySince === 'string' || value.busySince === null) &&
    (typeof value.lastBusyAt === 'string' || value.lastBusyAt === null) &&
    (value.agentActivity === null || isMcpAgentActivity(value.agentActivity)) &&
    isMcpSelfTestSummary(value.lastSelfTest) &&
    (typeof value.lastError === 'string' || value.lastError === null) &&
    (typeof value.lastUpdatedAt === 'string' || value.lastUpdatedAt === null)
  );
};
