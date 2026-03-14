import {
  createEmptyMcpViewState,
  type McpIndicatorColor,
  type McpViewState,
} from '@agent-browser/protocol';
import type { ToolServerDiagnosticsSnapshot } from './tool-server';

export interface McpDiagnosticsSource {
  getDiagnostics(): ToolServerDiagnosticsSnapshot;
  subscribe(listener: (snapshot: ToolServerDiagnosticsSnapshot) => void): () => void;
  runSelfTest(): Promise<ToolServerDiagnosticsSnapshot>;
}

const maskToken = (token: string | null): string | null => {
  if (!token || token.length < 8) {
    return token;
  }

  return `${token.slice(0, 4)}...${token.slice(-4)}`;
};

const getIndicator = (diagnostics: ToolServerDiagnosticsSnapshot): McpIndicatorColor => {
  if (diagnostics.lifecycle === 'error' || diagnostics.lastSelfTest.status === 'failed') {
    return 'red';
  }

  if (
    diagnostics.lifecycle === 'starting' ||
    diagnostics.lastSelfTest.status === 'running' ||
    diagnostics.lastSelfTest.status === 'idle'
  ) {
    return 'yellow';
  }

  return diagnostics.lifecycle === 'listening' ? 'green' : 'red';
};

const getStatusLabel = (diagnostics: ToolServerDiagnosticsSnapshot): string => {
  if (diagnostics.lifecycle === 'error') {
    return diagnostics.lastError ?? 'MCP server failed to start.';
  }

  if (diagnostics.lastSelfTest.status === 'failed') {
    return diagnostics.lastSelfTest.summary;
  }

  if (diagnostics.lifecycle === 'stopped') {
    return 'MCP server is offline.';
  }

  if (diagnostics.lifecycle === 'starting') {
    return 'Starting MCP server...';
  }

  switch (diagnostics.lastSelfTest.status) {
    case 'running':
      return 'Running MCP verification...';
    case 'passed':
      return 'MCP server verified.';
    case 'idle':
    default:
      return 'Awaiting MCP verification.';
  }
};

export const mapDiagnosticsToMcpViewState = (
  diagnostics: ToolServerDiagnosticsSnapshot,
  isOpen: boolean,
): McpViewState => ({
  ...createEmptyMcpViewState(),
  isOpen,
  indicator: getIndicator(diagnostics),
  lifecycle: diagnostics.lifecycle,
  statusLabel: getStatusLabel(diagnostics),
  transportUrl: diagnostics.url ?? '',
  host: diagnostics.host,
  port: diagnostics.port,
  authTokenPreview: maskToken(diagnostics.token),
  hasAuthToken: diagnostics.token !== null && diagnostics.token.length > 0,
  registrationFile: diagnostics.registrationFile ?? '',
  tools: [...diagnostics.tools],
  requestCount: diagnostics.requestCount,
  lastRequestAt: diagnostics.lastRequestAt,
  recentRequests: diagnostics.recentRequests.map((entry) => ({ ...entry })),
  lastSelfTest: { ...diagnostics.lastSelfTest },
  lastError: diagnostics.lastError,
  lastUpdatedAt: diagnostics.lastUpdatedAt,
});
