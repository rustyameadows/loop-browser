import { randomBytes } from 'node:crypto';
import { promises as fs } from 'node:fs';
import http, { type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import path from 'node:path';
import type {
  ArtifactRecord,
  ChromeAppearanceCommand,
  ChromeAppearanceState,
  FeedbackCommand,
  FeedbackStatus,
  FeedbackState,
  McpAgentActivity,
  McpAgentActivityPhase,
  McpRecentRequest,
  McpRequestOutcome,
  McpSelfTestSummary,
  MarkdownViewState,
  NavigationCommand,
  NavigationState,
  PickerCommand,
  PickerState,
  ResizeWindowRequest,
  ScreenshotArtifact,
  ScreenshotRequest,
  WindowState,
} from '@agent-browser/protocol';
import { isResizeWindowRequest, isScreenshotRequest } from '@agent-browser/protocol';
import { ArtifactStore } from './artifact-store';
import type { BrowserScreenshotCapture } from './browser-shell';
import { DEFAULT_TOOL_SERVER_PORT } from './runtime-config';

type JsonRpcId = string | number | null;

type JsonRpcRequest = {
  jsonrpc?: string;
  id?: JsonRpcId;
  method?: string;
  params?: unknown;
};

type JsonRpcResponse =
  | {
      jsonrpc: '2.0';
      id: JsonRpcId;
      result: unknown;
    }
  | {
      jsonrpc: '2.0';
      id: JsonRpcId;
      error: {
        code: number;
        message: string;
      };
    };

export interface ToolTabSnapshot {
  tabId: string;
  url: string;
  title: string;
  isLoading: boolean;
}

export interface ToolServerRuntime {
  listTabs(): ToolTabSnapshot[];
  executeNavigationCommand(command: NavigationCommand): Promise<NavigationState>;
  executePickerCommand(command: PickerCommand): Promise<PickerState>;
  getPickerState(): PickerState;
  executeChromeAppearanceCommand(command: ChromeAppearanceCommand): Promise<ChromeAppearanceState>;
  getChromeAppearanceState(): ChromeAppearanceState;
  executeFeedbackCommand(command: FeedbackCommand): Promise<FeedbackState>;
  getFeedbackState(): FeedbackState;
  getMarkdownForCurrentPage(forceRefresh?: boolean): Promise<MarkdownViewState>;
  getWindowState(): WindowState;
  resizeWindow(request: ResizeWindowRequest): Promise<WindowState>;
  captureScreenshot(request: ScreenshotRequest): Promise<BrowserScreenshotCapture>;
}

export interface ToolServerConnectionInfo {
  url: string;
  token: string;
  registrationFile: string;
}

export interface ToolServerDiagnosticsSnapshot {
  lifecycle: 'starting' | 'listening' | 'stopped' | 'error';
  url: string | null;
  host: string;
  port: number | null;
  token: string | null;
  registrationFile: string | null;
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

type ToolDefinition = {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
};

const SERVER_NAME = 'agent-browser';
const SERVER_VERSION = '0.1.0';
const RECENT_REQUEST_LIMIT = 10;
const DEFAULT_BUSY_HOLD_MS = 900;

const PROGRESS_STATUS_BY_PHASE: Record<McpAgentActivityPhase, FeedbackStatus> = {
  acknowledged: 'acknowledged',
  in_progress: 'in_progress',
  done: 'resolved',
};

const DEFAULT_PROGRESS_MESSAGE: Record<McpAgentActivityPhase, string> = {
  acknowledged: 'Agent received this note.',
  in_progress: 'Agent is working on this.',
  done: 'Agent marked this complete.',
};

const TOOL_DEFINITIONS: ToolDefinition[] = [
  {
    name: 'browser.listTabs',
    description: 'List the browser tabs currently available in the running app.',
    inputSchema: {
      type: 'object',
      properties: {},
      additionalProperties: false,
    },
  },
  {
    name: 'page.navigate',
    description: 'Navigate the active tab to a new URL.',
    inputSchema: {
      type: 'object',
      properties: {
        target: { type: 'string' },
      },
      required: ['target'],
      additionalProperties: false,
    },
  },
  {
    name: 'page.reload',
    description: 'Reload the active tab.',
    inputSchema: {
      type: 'object',
      properties: {},
      additionalProperties: false,
    },
  },
  {
    name: 'picker.enable',
    description: 'Arm the in-app DOM picker overlay.',
    inputSchema: {
      type: 'object',
      properties: {},
      additionalProperties: false,
    },
  },
  {
    name: 'picker.disable',
    description: 'Disable the in-app DOM picker overlay.',
    inputSchema: {
      type: 'object',
      properties: {},
      additionalProperties: false,
    },
  },
  {
    name: 'picker.lastSelection',
    description: 'Return the last element descriptor selected through pick mode.',
    inputSchema: {
      type: 'object',
      properties: {},
      additionalProperties: false,
    },
  },
  {
    name: 'chrome.getAppearance',
    description: 'Return the current project chrome appearance settings.',
    inputSchema: {
      type: 'object',
      properties: {},
      additionalProperties: false,
    },
  },
  {
    name: 'chrome.setAppearance',
    description: 'Update project chrome appearance settings and persist them to project config.',
    inputSchema: {
      type: 'object',
      properties: {
        chromeColor: { type: 'string' },
        accentColor: { type: 'string' },
        projectIconPath: { type: 'string' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'chrome.resetAppearance',
    description: 'Reset project chrome appearance settings to defaults and persist them.',
    inputSchema: {
      type: 'object',
      properties: {},
      additionalProperties: false,
    },
  },
  {
    name: 'feedback.getState',
    description: 'Return the current feedback state, including draft and captured annotations.',
    inputSchema: {
      type: 'object',
      properties: {},
      additionalProperties: false,
    },
  },
  {
    name: 'feedback.list',
    description: 'List saved feedback annotations. Optionally filter by status.',
    inputSchema: {
      type: 'object',
      properties: {
        status: {
          type: 'string',
          enum: ['open', 'acknowledged', 'in_progress', 'resolved', 'dismissed'],
        },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'feedback.create',
    description: 'Create a feedback annotation from the last picked element.',
    inputSchema: {
      type: 'object',
      properties: {
        summary: { type: 'string' },
        note: { type: 'string' },
        kind: {
          type: 'string',
          enum: ['bug', 'change', 'question', 'praise'],
        },
        priority: {
          type: 'string',
          enum: ['low', 'medium', 'high', 'critical'],
        },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'feedback.reply',
    description: 'Add an agent or human reply to an existing annotation.',
    inputSchema: {
      type: 'object',
      properties: {
        annotationId: { type: 'string' },
        body: { type: 'string' },
        author: {
          type: 'string',
          enum: ['human', 'agent', 'system'],
        },
      },
      required: ['annotationId', 'body'],
      additionalProperties: false,
    },
  },
  {
    name: 'feedback.progress',
    description: 'Record agent progress for an annotation and sync feedback status.',
    inputSchema: {
      type: 'object',
      properties: {
        annotationId: { type: 'string' },
        phase: {
          type: 'string',
          enum: ['acknowledged', 'in_progress', 'done'],
        },
        message: { type: 'string' },
      },
      required: ['annotationId', 'phase'],
      additionalProperties: false,
    },
  },
  {
    name: 'feedback.setStatus',
    description: 'Update the lifecycle status for a saved annotation.',
    inputSchema: {
      type: 'object',
      properties: {
        annotationId: { type: 'string' },
        status: {
          type: 'string',
          enum: ['open', 'acknowledged', 'in_progress', 'resolved', 'dismissed'],
        },
      },
      required: ['annotationId', 'status'],
      additionalProperties: false,
    },
  },
  {
    name: 'page.viewAsMarkdown',
    description: 'Return the current page converted to Markdown.',
    inputSchema: {
      type: 'object',
      properties: {
        forceRefresh: { type: 'boolean' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'page.screenshot',
    description: 'Capture a screenshot of the page, an element, or the full app window.',
    inputSchema: {
      type: 'object',
      properties: {
        target: {
          type: 'string',
          enum: ['page', 'element', 'window'],
        },
        selector: { type: 'string' },
        format: {
          type: 'string',
          enum: ['png', 'jpeg'],
        },
        quality: { type: 'number' },
        fileNameHint: { type: 'string' },
      },
      required: ['target'],
      additionalProperties: false,
    },
  },
  {
    name: 'browser.getWindowState',
    description: 'Inspect the current window, content, and page viewport bounds.',
    inputSchema: {
      type: 'object',
      properties: {},
      additionalProperties: false,
    },
  },
  {
    name: 'browser.resizeWindow',
    description: 'Resize the app window, content area, or page viewport.',
    inputSchema: {
      type: 'object',
      properties: {
        width: { type: 'number' },
        height: { type: 'number' },
        target: {
          type: 'string',
          enum: ['window', 'content', 'pageViewport'],
        },
      },
      required: ['width', 'height'],
      additionalProperties: false,
    },
  },
  {
    name: 'artifacts.get',
    description: 'Return metadata and local file path for a saved artifact.',
    inputSchema: {
      type: 'object',
      properties: {
        artifactId: { type: 'string' },
      },
      required: ['artifactId'],
      additionalProperties: false,
    },
  },
  {
    name: 'artifacts.list',
    description: 'List saved screenshot artifacts.',
    inputSchema: {
      type: 'object',
      properties: {},
      additionalProperties: false,
    },
  },
  {
    name: 'artifacts.delete',
    description: 'Delete a saved screenshot artifact.',
    inputSchema: {
      type: 'object',
      properties: {
        artifactId: { type: 'string' },
      },
      required: ['artifactId'],
      additionalProperties: false,
    },
  },
];

const EMPTY_SELF_TEST: McpSelfTestSummary = {
  status: 'idle',
  checkedAt: null,
  summary: 'Waiting for initial verification.',
  healthOk: null,
  initializeOk: null,
  toolsListOk: null,
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const toolResult = (value: unknown) => ({
  content: [
    {
      type: 'text',
      text: JSON.stringify(value),
    },
  ],
  structuredContent: value,
});

const jsonResponse = (response: ServerResponse, statusCode: number, body: JsonRpcResponse): void => {
  response.writeHead(statusCode, { 'content-type': 'application/json; charset=utf-8' });
  response.end(JSON.stringify(body));
};

const jsonError = (
  response: ServerResponse,
  statusCode: number,
  id: JsonRpcId,
  code: number,
  message: string,
): void => {
  jsonResponse(response, statusCode, {
    jsonrpc: '2.0',
    id,
    error: {
      code,
      message,
    },
  });
};

const readBody = async (request: IncomingMessage): Promise<string> => {
  const chunks: Buffer[] = [];

  for await (const chunk of request) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
  }

  return Buffer.concat(chunks).toString('utf8');
};

const describeRequest = (method: string, params: unknown): { method: string; detail: string } => {
  if (method === 'tools/call' && isRecord(params) && typeof params.name === 'string') {
    return {
      method,
      detail: params.name,
    };
  }

  return {
    method,
    detail: method,
  };
};

const cloneRecentRequests = (recentRequests: McpRecentRequest[]): McpRecentRequest[] =>
  recentRequests.map((entry) => ({ ...entry }));

const cloneSelfTest = (summary: McpSelfTestSummary): McpSelfTestSummary => ({ ...summary });

const cloneAgentActivity = (activity: McpAgentActivity | null): McpAgentActivity | null =>
  activity ? { ...activity } : null;

const nowIso = (): string => new Date().toISOString();

export class ToolServer {
  private readonly runtime: ToolServerRuntime;
  private readonly storageDir: string;
  private readonly host: string;
  private readonly port: number;
  private readonly busyHoldMs: number;
  private readonly logger: Pick<Console, 'error' | 'info' | 'warn'>;
  private readonly artifactStore: ArtifactStore;
  private readonly diagnosticsListeners = new Set<
    (snapshot: ToolServerDiagnosticsSnapshot) => void
  >();
  private server: http.Server | null = null;
  private connectionInfo: ToolServerConnectionInfo | null = null;
  private diagnostics: ToolServerDiagnosticsSnapshot;
  private busyReleaseTimer: NodeJS.Timeout | null = null;

  constructor(options: {
    runtime: ToolServerRuntime;
    storageDir: string;
    host?: string;
    port?: number;
    busyHoldMs?: number;
    logger?: Pick<Console, 'error' | 'info' | 'warn'>;
  }) {
    this.runtime = options.runtime;
    this.storageDir = options.storageDir;
    this.host = options.host ?? '127.0.0.1';
    this.port = options.port ?? DEFAULT_TOOL_SERVER_PORT;
    this.busyHoldMs = options.busyHoldMs ?? DEFAULT_BUSY_HOLD_MS;
    this.logger = options.logger ?? console;
    this.artifactStore = new ArtifactStore(this.storageDir);
    this.diagnostics = {
      lifecycle: 'starting',
      url: null,
      host: this.host,
      port: this.port > 0 ? this.port : null,
      token: null,
      registrationFile: null,
      tools: TOOL_DEFINITIONS.map((tool) => tool.name),
      requestCount: 0,
      lastRequestAt: null,
      recentRequests: [],
      activeToolCalls: 0,
      busySince: null,
      lastBusyAt: null,
      agentActivity: null,
      lastSelfTest: cloneSelfTest(EMPTY_SELF_TEST),
      lastError: null,
      lastUpdatedAt: nowIso(),
    };
  }

  async start(): Promise<ToolServerConnectionInfo> {
    if (this.connectionInfo) {
      return this.connectionInfo;
    }

    await fs.mkdir(this.storageDir, { recursive: true });
    await this.artifactStore.ensureReady();

    const token = await this.loadOrCreateToken();
    const registrationFile = path.join(this.storageDir, 'mcp-registration.json');

    this.updateDiagnostics({
      lifecycle: 'starting',
      token,
      registrationFile,
      lastError: null,
    });

    this.server = http.createServer((request, response) => {
      void this.handleRequest(request, response, token);
    });

    try {
      await new Promise<void>((resolve, reject) => {
        this.server?.once('error', reject);
        this.server?.listen(this.port, this.host, () => {
          this.server?.off('error', reject);
          resolve();
        });
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to bind MCP tool server.';
      this.updateDiagnostics({
        lifecycle: 'error',
        lastError: message,
      });
      throw error;
    }

    const address = this.server.address() as AddressInfo | null;
    if (!address) {
      const message = 'Tool server could not determine its listening address.';
      this.updateDiagnostics({
        lifecycle: 'error',
        lastError: message,
      });
      throw new Error(message);
    }

    this.connectionInfo = {
      url: `http://${this.host}:${address.port}/mcp`,
      token,
      registrationFile,
    };

    await fs.writeFile(
      registrationFile,
      JSON.stringify(
        {
          name: SERVER_NAME,
          version: SERVER_VERSION,
          transport: {
            type: 'streamable-http',
            url: this.connectionInfo.url,
            headers: {
              Authorization: `Bearer ${token}`,
            },
          },
          tools: TOOL_DEFINITIONS.map((tool) => tool.name),
        },
        null,
        2,
      ),
      'utf8',
    );

    this.updateDiagnostics({
      lifecycle: 'listening',
      url: this.connectionInfo.url,
      host: this.host,
      port: address.port,
      token,
      registrationFile,
      lastError: null,
    });

    this.logger.info(`Loop Browser tool server ready at ${this.connectionInfo.url}`);
    return this.connectionInfo;
  }

  async stop(): Promise<void> {
    this.connectionInfo = null;
    this.clearBusyReleaseTimer();

    if (!this.server) {
      this.updateDiagnostics({
        lifecycle: 'stopped',
        url: null,
        port: this.port > 0 ? this.port : null,
        activeToolCalls: 0,
        busySince: null,
      });
      return;
    }

    await new Promise<void>((resolve, reject) => {
      this.server?.close((error) => {
        if (error) {
          reject(error);
          return;
        }

        resolve();
      });
    });

    this.server = null;
    this.updateDiagnostics({
      lifecycle: 'stopped',
      url: null,
      port: this.port > 0 ? this.port : null,
      activeToolCalls: 0,
      busySince: null,
    });
  }

  getConnectionInfo(): ToolServerConnectionInfo | null {
    return this.connectionInfo;
  }

  getDiagnostics(): ToolServerDiagnosticsSnapshot {
    return this.cloneDiagnostics();
  }

  subscribe(listener: (snapshot: ToolServerDiagnosticsSnapshot) => void): () => void {
    this.diagnosticsListeners.add(listener);
    return () => {
      this.diagnosticsListeners.delete(listener);
    };
  }

  reportLifecycleError(message: string): void {
    this.updateDiagnostics({
      lifecycle: 'error',
      lastError: message,
    });
  }

  async runSelfTest(): Promise<ToolServerDiagnosticsSnapshot> {
    const checkedAt = nowIso();

    if (!this.connectionInfo) {
      this.updateDiagnostics({
        lastSelfTest: {
          status: 'failed',
          checkedAt,
          summary: 'MCP server is not listening.',
          healthOk: false,
          initializeOk: null,
          toolsListOk: null,
        },
        lastError: 'MCP server is not listening.',
      });
      return this.cloneDiagnostics();
    }

    this.updateDiagnostics({
      lastSelfTest: {
        status: 'running',
        checkedAt: null,
        summary: 'Running MCP self-test...',
        healthOk: null,
        initializeOk: null,
        toolsListOk: null,
      },
      lastError: null,
    });

    let healthOk: boolean | null = null;
    let initializeOk: boolean | null = null;
    let toolsListOk: boolean | null = null;

    try {
      const healthUrl = new URL('/health', this.connectionInfo.url);
      healthUrl.search = '';
      healthUrl.hash = '';

      const healthResponse = await fetch(healthUrl, { method: 'GET' });
      healthOk = healthResponse.ok;

      if (!healthOk) {
        throw new Error(`Health probe returned ${healthResponse.status}.`);
      }

      const headers = {
        authorization: `Bearer ${this.connectionInfo.token}`,
        'content-type': 'application/json',
      };

      const initializeResponse = await fetch(this.connectionInfo.url, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 'self-test-initialize',
          method: 'initialize',
        }),
      });

      if (!initializeResponse.ok) {
        throw new Error(`initialize returned ${initializeResponse.status}.`);
      }

      const initializePayload = (await initializeResponse.json()) as {
        result?: {
          serverInfo?: {
            name?: string;
          };
        };
      };

      initializeOk = initializePayload.result?.serverInfo?.name === SERVER_NAME;
      if (!initializeOk) {
        throw new Error('initialize returned an unexpected server name.');
      }

      const toolsResponse = await fetch(this.connectionInfo.url, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 'self-test-tools',
          method: 'tools/list',
        }),
      });

      if (!toolsResponse.ok) {
        throw new Error(`tools/list returned ${toolsResponse.status}.`);
      }

      const toolsPayload = (await toolsResponse.json()) as {
        result?: {
          tools?: Array<{ name?: string }>;
        };
      };

      const returnedTools = toolsPayload.result?.tools?.map((tool) => tool.name ?? '') ?? [];
      toolsListOk = TOOL_DEFINITIONS.every((tool) => returnedTools.includes(tool.name));

      if (!toolsListOk) {
        throw new Error('tools/list did not return the expected tool inventory.');
      }

      this.updateDiagnostics({
        lastSelfTest: {
          status: 'passed',
          checkedAt,
          summary: 'Health, initialize, and tools/list succeeded.',
          healthOk,
          initializeOk,
          toolsListOk,
        },
        lastError: null,
      });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'The MCP self-test failed unexpectedly.';
      this.updateDiagnostics({
        lastSelfTest: {
          status: 'failed',
          checkedAt,
          summary: message,
          healthOk,
          initializeOk,
          toolsListOk,
        },
        lastError: message,
      });
    }

    return this.cloneDiagnostics();
  }

  private async handleRequest(
    request: IncomingMessage,
    response: ServerResponse,
    token: string,
  ): Promise<void> {
    if (request.url === '/health') {
      response.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
      response.end(JSON.stringify({ ok: true }));
      this.recordRequest('GET', '/health', 'success');
      return;
    }

    if (request.method !== 'POST' || request.url !== '/mcp') {
      response.writeHead(404);
      response.end();
      this.recordRequest(request.method ?? 'UNKNOWN', request.url ?? '/', 'rejected');
      return;
    }

    if (!this.isAuthorized(request, token)) {
      response.writeHead(401, { 'content-type': 'application/json; charset=utf-8' });
      response.end(JSON.stringify({ error: 'Unauthorized' }));
      this.recordRequest('POST', '/mcp unauthorized', 'rejected');
      return;
    }

    if (!this.isAllowedOrigin(request.headers.origin)) {
      response.writeHead(403, { 'content-type': 'application/json; charset=utf-8' });
      response.end(JSON.stringify({ error: 'Forbidden origin' }));
      this.recordRequest('POST', '/mcp forbidden origin', 'rejected');
      return;
    }

    let body: string;
    try {
      body = await readBody(request);
    } catch (error) {
      this.logger.warn('Failed reading tool-server request body', error);
      response.writeHead(400);
      response.end();
      this.recordRequest('POST', '/mcp invalid body', 'rejected');
      return;
    }

    let payload: unknown;
    try {
      payload = JSON.parse(body);
    } catch {
      jsonError(response, 400, null, -32700, 'Parse error');
      this.recordRequest('POST', 'parse error', 'error');
      return;
    }

    if (Array.isArray(payload)) {
      jsonError(response, 400, null, -32600, 'Batch requests are not supported.');
      this.recordRequest('POST', 'batch request', 'error');
      return;
    }

    if (!isRecord(payload)) {
      jsonError(response, 400, null, -32600, 'Invalid request');
      this.recordRequest('POST', 'invalid request', 'error');
      return;
    }

    const requestPayload = payload as JsonRpcRequest;
    if (requestPayload.jsonrpc !== '2.0' || typeof requestPayload.method !== 'string') {
      jsonError(response, 400, requestPayload.id ?? null, -32600, 'Invalid request');
      this.recordRequest('POST', 'invalid json-rpc envelope', 'error');
      return;
    }

    if (requestPayload.id === undefined && requestPayload.method === 'notifications/initialized') {
      response.writeHead(202);
      response.end();
      this.recordRequest('notifications/initialized', 'notifications/initialized', 'success');
      return;
    }

    const requestId = requestPayload.id ?? null;
    const requestMeta = describeRequest(requestPayload.method, requestPayload.params);
    const isExternalToolCall = requestPayload.method === 'tools/call';

    if (isExternalToolCall) {
      this.beginExternalToolCall();
    }

    try {
      const result = await this.dispatch(requestPayload.method, requestPayload.params);
      jsonResponse(response, 200, {
        jsonrpc: '2.0',
        id: requestId,
        result,
      });
      this.recordRequest(requestMeta.method, requestMeta.detail, 'success');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Internal server error';
      jsonError(response, 500, requestId, -32000, message);
      this.updateDiagnostics({
        lastError: message,
      });
      this.recordRequest(requestMeta.method, requestMeta.detail, 'error');
    } finally {
      if (isExternalToolCall) {
        this.finishExternalToolCall();
      }
    }
  }

  private async dispatch(method: string, params: unknown): Promise<unknown> {
    switch (method) {
      case 'initialize':
        return {
          protocolVersion: '2026-03-26',
          serverInfo: {
            name: SERVER_NAME,
            version: SERVER_VERSION,
          },
          capabilities: {
            tools: {
              listChanged: false,
            },
          },
        };
      case 'tools/list':
        return {
          tools: TOOL_DEFINITIONS,
        };
      case 'tools/call':
        return this.executeToolCall(params);
      default:
        throw new Error(`Unknown JSON-RPC method: ${method}`);
    }
  }

  private async executeToolCall(params: unknown): Promise<unknown> {
    if (!isRecord(params) || typeof params.name !== 'string') {
      throw new Error('Tool calls require a name.');
    }

    const args = isRecord(params.arguments) ? params.arguments : {};

    switch (params.name) {
      case 'browser.listTabs':
        return toolResult({ tabs: this.runtime.listTabs() });
      case 'page.navigate':
        if (typeof args.target !== 'string' || args.target.trim().length === 0) {
          throw new Error('page.navigate requires a non-empty target.');
        }

        return toolResult({
          navigation: await this.runtime.executeNavigationCommand({
            action: 'navigate',
            target: args.target,
          }),
        });
      case 'page.reload':
        return toolResult({
          navigation: await this.runtime.executeNavigationCommand({
            action: 'reload',
          }),
        });
      case 'picker.enable':
        return toolResult({
          picker: await this.runtime.executePickerCommand({ action: 'enable' }),
        });
      case 'picker.disable':
        return toolResult({
          picker: await this.runtime.executePickerCommand({ action: 'disable' }),
        });
      case 'picker.lastSelection':
        return toolResult({
          picker: this.runtime.getPickerState(),
        });
      case 'chrome.getAppearance':
        return toolResult({
          appearance: this.runtime.getChromeAppearanceState(),
        });
      case 'chrome.setAppearance': {
        if (
          typeof args.chromeColor !== 'string' &&
          typeof args.accentColor !== 'string' &&
          typeof args.projectIconPath !== 'string'
        ) {
          throw new Error(
            'chrome.setAppearance requires at least one of chromeColor, accentColor, or projectIconPath.',
          );
        }

        return toolResult({
          appearance: await this.runtime.executeChromeAppearanceCommand({
            action: 'set',
            chromeColor: typeof args.chromeColor === 'string' ? args.chromeColor : undefined,
            accentColor: typeof args.accentColor === 'string' ? args.accentColor : undefined,
            projectIconPath:
              typeof args.projectIconPath === 'string' ? args.projectIconPath : undefined,
          }),
        });
      }
      case 'chrome.resetAppearance':
        return toolResult({
          appearance: await this.runtime.executeChromeAppearanceCommand({
            action: 'reset',
          }),
        });
      case 'feedback.getState':
        return toolResult({
          feedback: this.runtime.getFeedbackState(),
        });
      case 'feedback.list': {
        const state = this.runtime.getFeedbackState();
        const annotations =
          typeof args.status === 'string'
            ? state.annotations.filter((annotation) => annotation.status === args.status)
            : state.annotations;
        return toolResult({ annotations });
      }
      case 'feedback.create': {
        const selection = this.runtime.getPickerState().lastSelection;
        if (!selection) {
          throw new Error('feedback.create requires an existing picker selection.');
        }

        await this.runtime.executeFeedbackCommand({
          action: 'startDraftFromSelection',
          selection,
        });
        await this.runtime.executeFeedbackCommand({
          action: 'updateDraft',
          summary: typeof args.summary === 'string' ? args.summary : undefined,
          note: typeof args.note === 'string' ? args.note : undefined,
          kind:
            args.kind === 'bug' ||
            args.kind === 'change' ||
            args.kind === 'question' ||
            args.kind === 'praise'
              ? args.kind
              : undefined,
          priority:
            args.priority === 'low' ||
            args.priority === 'medium' ||
            args.priority === 'high' ||
            args.priority === 'critical'
              ? args.priority
              : undefined,
        });
        const feedback = await this.runtime.executeFeedbackCommand({ action: 'submitDraft' });
        return toolResult({
          feedback,
          annotation: feedback.annotations[0] ?? null,
        });
      }
      case 'feedback.reply':
        if (typeof args.annotationId !== 'string' || args.annotationId.trim().length === 0) {
          throw new Error('feedback.reply requires a non-empty annotationId.');
        }

        if (typeof args.body !== 'string' || args.body.trim().length === 0) {
          throw new Error('feedback.reply requires a non-empty body.');
        }

        return toolResult({
          feedback: await this.runtime.executeFeedbackCommand({
            action: 'reply',
            annotationId: args.annotationId,
            body: args.body,
            author:
              args.author === 'human' || args.author === 'system' || args.author === 'agent'
                ? args.author
                : 'agent',
          }),
        });
      case 'feedback.progress': {
        if (typeof args.annotationId !== 'string' || args.annotationId.trim().length === 0) {
          throw new Error('feedback.progress requires a non-empty annotationId.');
        }

        if (
          args.phase !== 'acknowledged' &&
          args.phase !== 'in_progress' &&
          args.phase !== 'done'
        ) {
          throw new Error('feedback.progress requires a valid phase.');
        }

        const currentState = this.runtime.getFeedbackState();
        const annotation = currentState.annotations.find(
          (entry) => entry.id === args.annotationId,
        );

        if (!annotation) {
          throw new Error(`feedback.progress could not find annotation ${args.annotationId}.`);
        }

        const phase = args.phase;
        const message =
          typeof args.message === 'string' && args.message.trim().length > 0
            ? args.message.trim()
            : DEFAULT_PROGRESS_MESSAGE[phase];

        await this.runtime.executeFeedbackCommand({
          action: 'setStatus',
          annotationId: annotation.id,
          status: PROGRESS_STATUS_BY_PHASE[phase],
        });
        const feedback = await this.runtime.executeFeedbackCommand({
          action: 'reply',
          annotationId: annotation.id,
          body: message,
          author: 'agent',
        });
        const updatedAt = nowIso();
        const agentActivity = {
          annotationId: annotation.id,
          phase,
          message,
          updatedAt,
        } satisfies McpAgentActivity;

        this.updateDiagnostics({
          agentActivity,
        });

        return toolResult({
          feedback,
          annotation:
            feedback.annotations.find((entry) => entry.id === annotation.id) ?? null,
          agentActivity,
        });
      }
      case 'feedback.setStatus':
        if (typeof args.annotationId !== 'string' || args.annotationId.trim().length === 0) {
          throw new Error('feedback.setStatus requires a non-empty annotationId.');
        }

        if (
          args.status !== 'open' &&
          args.status !== 'acknowledged' &&
          args.status !== 'in_progress' &&
          args.status !== 'resolved' &&
          args.status !== 'dismissed'
        ) {
          throw new Error('feedback.setStatus requires a valid status.');
        }

        return toolResult({
          feedback: await this.runtime.executeFeedbackCommand({
            action: 'setStatus',
            annotationId: args.annotationId,
            status: args.status,
          }),
        });
      case 'page.viewAsMarkdown': {
        const markdownView = await this.runtime.getMarkdownForCurrentPage(
          typeof args.forceRefresh === 'boolean' ? args.forceRefresh : false,
        );

        if (markdownView.status !== 'ready') {
          throw new Error(markdownView.lastError ?? 'Markdown view is not ready.');
        }

        return toolResult({
          url: markdownView.sourceUrl,
          title: markdownView.title,
          markdown: markdownView.markdown,
          author: markdownView.author,
          site: markdownView.site,
          wordCount: markdownView.wordCount,
        });
      }
      case 'page.screenshot': {
        if (!isScreenshotRequest(args)) {
          throw new Error('page.screenshot requires a valid screenshot request.');
        }

        const capture = await this.runtime.captureScreenshot(args);
        const artifact = await this.saveScreenshotArtifact(capture);
        return toolResult(artifact);
      }
      case 'browser.getWindowState':
        return toolResult({
          window: this.runtime.getWindowState(),
        });
      case 'browser.resizeWindow': {
        if (!isResizeWindowRequest(args)) {
          throw new Error('browser.resizeWindow requires numeric width and height.');
        }

        return toolResult({
          window: await this.runtime.resizeWindow(args),
        });
      }
      case 'artifacts.get':
        return toolResult({
          artifact: await this.getArtifact(args),
        });
      case 'artifacts.list':
        return toolResult({
          artifacts: await this.artifactStore.listArtifacts(),
        });
      case 'artifacts.delete':
        return toolResult({
          artifact: await this.deleteArtifact(args),
        });
      default:
        throw new Error(`Unknown tool: ${params.name}`);
    }
  }

  private async saveScreenshotArtifact(
    capture: BrowserScreenshotCapture,
  ): Promise<ScreenshotArtifact> {
    return this.artifactStore.saveScreenshot({
      buffer: capture.data,
      format: capture.format,
      target: capture.target,
      pixelWidth: capture.pixelWidth,
      pixelHeight: capture.pixelHeight,
      fileNameHint: capture.fileNameHint,
    });
  }

  private async getArtifact(args: Record<string, unknown>): Promise<ArtifactRecord> {
    if (typeof args.artifactId !== 'string' || args.artifactId.trim().length === 0) {
      throw new Error('artifacts.get requires a non-empty artifactId.');
    }

    return this.artifactStore.getArtifact(args.artifactId);
  }

  private async deleteArtifact(
    args: Record<string, unknown>,
  ): Promise<{ artifactId: string; deleted: true }> {
    if (typeof args.artifactId !== 'string' || args.artifactId.trim().length === 0) {
      throw new Error('artifacts.delete requires a non-empty artifactId.');
    }

    await this.artifactStore.deleteArtifact(args.artifactId);
    return {
      artifactId: args.artifactId,
      deleted: true,
    };
  }

  private isAuthorized(request: IncomingMessage, token: string): boolean {
    const authorization = request.headers.authorization;
    return authorization === `Bearer ${token}`;
  }

  private isAllowedOrigin(originHeader: string | undefined): boolean {
    if (!originHeader) {
      return true;
    }

    if (originHeader === 'null') {
      return true;
    }

    try {
      const origin = new URL(originHeader);
      return origin.hostname === '127.0.0.1' || origin.hostname === 'localhost';
    } catch {
      return false;
    }
  }

  private recordRequest(method: string, detail: string, outcome: McpRequestOutcome): void {
    const at = nowIso();
    const recentRequests = [
      {
        at,
        method,
        detail,
        outcome,
      },
      ...this.diagnostics.recentRequests,
    ].slice(0, RECENT_REQUEST_LIMIT);

    this.updateDiagnostics({
      requestCount: this.diagnostics.requestCount + 1,
      lastRequestAt: at,
      recentRequests,
    });
  }

  private cloneDiagnostics(): ToolServerDiagnosticsSnapshot {
    return {
      ...this.diagnostics,
      recentRequests: cloneRecentRequests(this.diagnostics.recentRequests),
      agentActivity: cloneAgentActivity(this.diagnostics.agentActivity),
      lastSelfTest: cloneSelfTest(this.diagnostics.lastSelfTest),
    };
  }

  private updateDiagnostics(
    patch: Partial<Omit<ToolServerDiagnosticsSnapshot, 'recentRequests' | 'lastSelfTest'>> & {
      recentRequests?: McpRecentRequest[];
      lastSelfTest?: McpSelfTestSummary;
    },
  ): void {
    this.diagnostics = {
      ...this.diagnostics,
      ...patch,
      recentRequests: patch.recentRequests
        ? cloneRecentRequests(patch.recentRequests)
        : this.diagnostics.recentRequests,
      agentActivity:
        'agentActivity' in patch
          ? cloneAgentActivity(patch.agentActivity ?? null)
          : this.diagnostics.agentActivity,
      lastSelfTest: patch.lastSelfTest
        ? cloneSelfTest(patch.lastSelfTest)
        : this.diagnostics.lastSelfTest,
      lastUpdatedAt: nowIso(),
    };

    const snapshot = this.cloneDiagnostics();
    for (const listener of this.diagnosticsListeners) {
      listener(snapshot);
    }
  }

  private beginExternalToolCall(): void {
    this.clearBusyReleaseTimer();
    const at = nowIso();
    this.updateDiagnostics({
      activeToolCalls: this.diagnostics.activeToolCalls + 1,
      busySince: this.diagnostics.busySince ?? at,
      lastBusyAt: at,
    });
  }

  private finishExternalToolCall(): void {
    const at = nowIso();
    const activeToolCalls = Math.max(this.diagnostics.activeToolCalls - 1, 0);

    this.updateDiagnostics({
      activeToolCalls,
      lastBusyAt: at,
    });

    if (activeToolCalls > 0) {
      return;
    }

    this.clearBusyReleaseTimer();
    this.busyReleaseTimer = setTimeout(() => {
      this.busyReleaseTimer = null;
      if (this.diagnostics.activeToolCalls === 0) {
        this.updateDiagnostics({
          busySince: null,
        });
      }
    }, this.busyHoldMs);
  }

  private clearBusyReleaseTimer(): void {
    if (!this.busyReleaseTimer) {
      return;
    }

    clearTimeout(this.busyReleaseTimer);
    this.busyReleaseTimer = null;
  }

  private async loadOrCreateToken(): Promise<string> {
    const tokenFile = path.join(this.storageDir, 'mcp-token');

    try {
      const existingToken = (await fs.readFile(tokenFile, 'utf8')).trim();
      if (existingToken.length > 0) {
        return existingToken;
      }
    } catch {
      // Ignore missing token file and generate a new one.
    }

    const token = randomBytes(24).toString('hex');
    await fs.writeFile(tokenFile, token, 'utf8');
    return token;
  }
}
