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
  SessionSummary,
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
        data?: unknown;
      };
    };

class ToolServerRpcError extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: number,
    message: string,
    readonly data?: unknown,
  ) {
    super(message);
    this.name = 'ToolServerRpcError';
  }
}

export interface ToolTabSnapshot {
  tabId: string;
  url: string;
  title: string;
  isLoading: boolean;
}

type Awaitable<T> = T | Promise<T>;

export interface ToolServerRuntime {
  listTabs(sessionId?: string): Awaitable<ToolTabSnapshot[]>;
  executeNavigationCommand(command: NavigationCommand, sessionId?: string): Promise<NavigationState>;
  executePickerCommand(command: PickerCommand, sessionId?: string): Promise<PickerState>;
  getPickerState(sessionId?: string): Awaitable<PickerState>;
  executeChromeAppearanceCommand(
    command: ChromeAppearanceCommand,
    sessionId?: string,
  ): Promise<ChromeAppearanceState>;
  getChromeAppearanceState(sessionId?: string): Awaitable<ChromeAppearanceState>;
  executeFeedbackCommand(command: FeedbackCommand, sessionId?: string): Promise<FeedbackState>;
  getFeedbackState(sessionId?: string): Awaitable<FeedbackState>;
  getMarkdownForCurrentPage(forceRefresh?: boolean, sessionId?: string): Promise<MarkdownViewState>;
  getWindowState(sessionId?: string): Awaitable<WindowState>;
  resizeWindow(request: ResizeWindowRequest, sessionId?: string): Promise<WindowState>;
  captureScreenshot(request: ScreenshotRequest, sessionId?: string): Promise<BrowserScreenshotCapture>;
  listSessions?(): Awaitable<SessionSummary[]>;
  getCurrentSession?(): Awaitable<SessionSummary | null>;
  openSession?(projectRoot?: string): Awaitable<SessionSummary[]>;
  focusSession?(sessionId: string): Awaitable<SessionSummary | null>;
  closeSession?(sessionId: string): Awaitable<SessionSummary[]>;
  proxyToolCall?(
    sessionId: string,
    toolName: string,
    args: Record<string, unknown>,
  ): Promise<unknown>;
  proxyResourceRead?(sessionId: string, uri: string): Promise<unknown>;
}

type ToolServerInternalControl = {
  focusWindow(): Promise<void> | void;
  closeWindow(): Promise<void> | void;
};

export interface ToolServerConnectionInfo {
  url: string;
  token: string;
  registrationFile: string;
}

export interface ToolServerDiagnosticsSnapshot {
  lifecycle: 'starting' | 'listening' | 'stopped' | 'error';
  setupLabel: string;
  setupUrl: string | null;
  setupToken: string | null;
  setupRegistrationFile: string | null;
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

type ResourceDefinition = {
  uri: string;
  name: string;
  title: string;
  description: string;
  mimeType: 'application/json';
};

type ResourceTemplateDefinition = {
  uriTemplate: string;
  name: string;
  title: string;
  description: string;
  mimeType: 'application/json';
};

type SupportedProtocolVersion = '2025-03-26' | '2025-06-18' | '2025-11-25';

type SessionResourceKind =
  | 'summary'
  | 'tabs'
  | 'window'
  | 'pickerSelection'
  | 'feedback'
  | 'pageMarkdown'
  | 'artifacts';

type ParsedResourceUri =
  | {
      kind: 'sessions';
      uri: string;
    }
  | {
      kind: 'session';
      uri: string;
      sessionId: string;
      resourceKind: SessionResourceKind;
    };

const SERVER_NAME = 'agent-browser';
const SERVER_VERSION = '0.1.0';
const RECENT_REQUEST_LIMIT = 10;
const DEFAULT_BUSY_HOLD_MS = 900;
const SUPPORTED_PROTOCOL_VERSIONS: SupportedProtocolVersion[] = [
  '2025-03-26',
  '2025-06-18',
  '2025-11-25',
];
const DEFAULT_PROTOCOL_VERSION: SupportedProtocolVersion = '2025-03-26';
const MCP_PROTOCOL_VERSION_HEADER = 'mcp-protocol-version';
const MCP_JSON_ACCEPT_HEADER = 'application/json, text/event-stream';
const GLOBAL_SESSIONS_RESOURCE_URI = 'loop-browser:///sessions';
const RESOURCE_NOT_FOUND_ERROR_CODE = -32002;

const SESSION_RESOURCE_CATALOG: Array<{
  resourceKind: SessionResourceKind;
  pathSegments: string[];
  name: string;
  title: string;
  description: string;
}> = [
  {
    resourceKind: 'summary',
    pathSegments: ['summary'],
    name: 'session-summary',
    title: 'Session Summary',
    description: 'Project session metadata for a Loop Browser window.',
  },
  {
    resourceKind: 'tabs',
    pathSegments: ['tabs'],
    name: 'session-tabs',
    title: 'Session Tabs',
    description: 'Current tab snapshots for a Loop Browser project session.',
  },
  {
    resourceKind: 'window',
    pathSegments: ['window'],
    name: 'session-window',
    title: 'Session Window',
    description: 'Window and viewport bounds for a Loop Browser project session.',
  },
  {
    resourceKind: 'pickerSelection',
    pathSegments: ['picker', 'selection'],
    name: 'session-picker-selection',
    title: 'Picker Selection',
    description: 'Latest DOM picker selection captured in a Loop Browser project session.',
  },
  {
    resourceKind: 'feedback',
    pathSegments: ['feedback'],
    name: 'session-feedback',
    title: 'Feedback State',
    description: 'Feedback annotations and draft state for a Loop Browser project session.',
  },
  {
    resourceKind: 'pageMarkdown',
    pathSegments: ['page', 'markdown'],
    name: 'session-page-markdown',
    title: 'Page Markdown',
    description: 'Markdown export for the active page in a Loop Browser project session.',
  },
  {
    resourceKind: 'artifacts',
    pathSegments: ['artifacts'],
    name: 'session-artifacts',
    title: 'Session Artifacts',
    description: 'Saved screenshot artifact metadata for a Loop Browser project session.',
  },
];

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

const SESSION_SCOPED_TOOL_NAMES = new Set([
  'browser.listTabs',
  'page.navigate',
  'page.reload',
  'picker.enable',
  'picker.disable',
  'picker.lastSelection',
  'chrome.getAppearance',
  'chrome.setAppearance',
  'chrome.resetAppearance',
  'feedback.getState',
  'feedback.list',
  'feedback.create',
  'feedback.reply',
  'feedback.progress',
  'feedback.setStatus',
  'page.viewAsMarkdown',
  'page.screenshot',
  'browser.getWindowState',
  'browser.resizeWindow',
  'artifacts.get',
  'artifacts.list',
  'artifacts.delete',
]);

const SESSION_TOOL_DEFINITIONS: ToolDefinition[] = [
  {
    name: 'session.list',
    description: 'List the currently open Loop Browser project sessions.',
    inputSchema: {
      type: 'object',
      properties: {},
      additionalProperties: false,
    },
  },
  {
    name: 'session.open',
    description: 'Open a project folder as a new Loop Browser project session.',
    inputSchema: {
      type: 'object',
      properties: {
        projectRoot: { type: 'string' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'session.focus',
    description: 'Focus an existing Loop Browser project session by session id.',
    inputSchema: {
      type: 'object',
      properties: {
        sessionId: { type: 'string' },
      },
      required: ['sessionId'],
      additionalProperties: false,
    },
  },
  {
    name: 'session.close',
    description: 'Close an existing Loop Browser project session by session id.',
    inputSchema: {
      type: 'object',
      properties: {
        sessionId: { type: 'string' },
      },
      required: ['sessionId'],
      additionalProperties: false,
    },
  },
  {
    name: 'session.getCurrent',
    description: 'Return the currently focused Loop Browser project session.',
    inputSchema: {
      type: 'object',
      properties: {},
      additionalProperties: false,
    },
  },
];

const withRequiredSessionId = (definition: ToolDefinition): ToolDefinition => {
  const properties = isRecord(definition.inputSchema.properties)
    ? { ...definition.inputSchema.properties }
    : {};
  const required = Array.isArray(definition.inputSchema.required)
    ? [...definition.inputSchema.required]
    : [];

  properties.sessionId = { type: 'string' };
  if (!required.includes('sessionId')) {
    required.push('sessionId');
  }

  return {
    ...definition,
    inputSchema: {
      ...definition.inputSchema,
      properties,
      required,
    },
  };
};

const buildToolDefinitions = (options: {
  requireSessionId: boolean;
  includeSessionTools: boolean;
}): ToolDefinition[] => {
  const scopedDefinitions = BASE_TOOL_DEFINITIONS.map((definition) =>
    options.requireSessionId && SESSION_SCOPED_TOOL_NAMES.has(definition.name)
      ? withRequiredSessionId(definition)
      : definition,
  );

  return options.includeSessionTools
    ? [...SESSION_TOOL_DEFINITIONS, ...scopedDefinitions]
    : scopedDefinitions;
};

const BASE_TOOL_DEFINITIONS: ToolDefinition[] = [
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
        defaultUrl: { type: 'string' },
        agentLoginUsernameEnv: { type: 'string' },
        agentLoginPasswordEnv: { type: 'string' },
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
  resourcesListOk: null,
  resourceTemplatesListOk: null,
  resourceReadOk: null,
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

const jsonResponse = (
  response: ServerResponse,
  statusCode: number,
  body: JsonRpcResponse,
  headers?: Record<string, string>,
): void => {
  response.writeHead(statusCode, {
    'content-type': 'application/json; charset=utf-8',
    ...headers,
  });
  response.end(JSON.stringify(body));
};

const jsonError = (
  response: ServerResponse,
  statusCode: number,
  id: JsonRpcId,
  code: number,
  message: string,
  data?: unknown,
  headers?: Record<string, string>,
): void => {
  jsonResponse(response, statusCode, {
    jsonrpc: '2.0',
    id,
    error: {
      code,
      message,
      ...(data === undefined ? {} : { data }),
    },
  }, headers);
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

  if (method === 'resources/read' && isRecord(params) && typeof params.uri === 'string') {
    return {
      method,
      detail: params.uri,
    };
  }

  return {
    method,
    detail: method,
  };
};

const isSupportedProtocolVersion = (value: string): value is SupportedProtocolVersion =>
  SUPPORTED_PROTOCOL_VERSIONS.includes(value as SupportedProtocolVersion);

const getHeaderValue = (value: string | string[] | undefined): string | undefined => {
  if (Array.isArray(value)) {
    return value[0];
  }

  return value;
};

const buildJsonResourceResult = (uri: string, value: unknown) => ({
  contents: [
    {
      uri,
      mimeType: 'application/json',
      text: `${JSON.stringify(value, null, 2)}\n`,
    },
  ],
});

const buildSessionResourceUri = (
  sessionId: string,
  pathSegments: string[],
): string => `loop-browser:///session/${encodeURIComponent(sessionId)}/${pathSegments.join('/')}`;

const buildResourceDefinitions = (sessions: SessionSummary[]): ResourceDefinition[] => [
  {
    uri: GLOBAL_SESSIONS_RESOURCE_URI,
    name: 'sessions',
    title: 'Loop Browser Sessions',
    description: 'Open Loop Browser project sessions that can be inspected through MCP resources.',
    mimeType: 'application/json',
  },
  ...sessions.flatMap((session) =>
    SESSION_RESOURCE_CATALOG.map((resource) => ({
      uri: buildSessionResourceUri(session.sessionId, resource.pathSegments),
      name: `${session.sessionId}-${resource.name}`,
      title: `${session.projectName}: ${resource.title}`,
      description: resource.description,
      mimeType: 'application/json' as const,
    })),
  ),
];

const RESOURCE_TEMPLATES: ResourceTemplateDefinition[] = SESSION_RESOURCE_CATALOG.map((resource) => ({
  uriTemplate: `loop-browser:///session/{sessionId}/${resource.pathSegments.join('/')}`,
  name: resource.name,
  title: resource.title,
  description: resource.description,
  mimeType: 'application/json',
}));

const parseResourceUri = (uri: string): ParsedResourceUri | null => {
  let parsedUrl: URL;

  try {
    parsedUrl = new URL(uri);
  } catch {
    return null;
  }

  if (parsedUrl.protocol !== 'loop-browser:') {
    return null;
  }

  const segments = parsedUrl.pathname.split('/').filter((segment) => segment.length > 0);
  if (segments.length === 1 && segments[0] === 'sessions') {
    return {
      kind: 'sessions',
      uri,
    };
  }

  if (segments.length < 3 || segments[0] !== 'session') {
    return null;
  }

  const sessionId = decodeURIComponent(segments[1]);
  const pathSuffix = segments.slice(2);
  const match = SESSION_RESOURCE_CATALOG.find(
    (resource) =>
      resource.pathSegments.length === pathSuffix.length &&
      resource.pathSegments.every((segment, index) => segment === pathSuffix[index]),
  );

  if (!match || sessionId.trim().length === 0) {
    return null;
  }

  return {
    kind: 'session',
    uri,
    sessionId,
    resourceKind: match.resourceKind,
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
  private readonly requireSessionId: boolean;
  private readonly toolDefinitions: ToolDefinition[];
  private readonly internalControl: ToolServerInternalControl | null;
  private readonly setupConnectionInfo: ToolServerConnectionInfo | null;
  private readonly setupConnectionLabel: string;
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
    requireSessionId?: boolean;
    includeSessionTools?: boolean;
    internalControl?: ToolServerInternalControl;
    setupConnectionInfo?: ToolServerConnectionInfo | null;
    setupConnectionLabel?: string;
  }) {
    this.runtime = options.runtime;
    this.storageDir = options.storageDir;
    this.host = options.host ?? '127.0.0.1';
    this.port = options.port ?? DEFAULT_TOOL_SERVER_PORT;
    this.busyHoldMs = options.busyHoldMs ?? DEFAULT_BUSY_HOLD_MS;
    this.logger = options.logger ?? console;
    this.artifactStore = new ArtifactStore(this.storageDir);
    this.requireSessionId = options.requireSessionId ?? false;
    this.toolDefinitions = buildToolDefinitions({
      requireSessionId: this.requireSessionId,
      includeSessionTools: options.includeSessionTools ?? false,
    });
    this.internalControl = options.internalControl ?? null;
    this.setupConnectionInfo = options.setupConnectionInfo ?? null;
    this.setupConnectionLabel = options.setupConnectionLabel ?? 'This window';
    this.diagnostics = {
      lifecycle: 'starting',
      setupLabel: this.setupConnectionLabel,
      setupUrl: this.setupConnectionInfo?.url ?? null,
      setupToken: this.setupConnectionInfo?.token ?? null,
      setupRegistrationFile: this.setupConnectionInfo?.registrationFile ?? null,
      url: null,
      host: this.host,
      port: this.port > 0 ? this.port : null,
      token: null,
      registrationFile: null,
      tools: this.toolDefinitions.map((tool) => tool.name),
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
          tools: this.toolDefinitions.map((tool) => tool.name),
        },
        null,
        2,
      ),
      'utf8',
    );

    this.updateDiagnostics({
      lifecycle: 'listening',
      setupLabel: this.setupConnectionLabel,
      setupUrl: this.setupConnectionInfo?.url ?? this.connectionInfo.url,
      setupToken: this.setupConnectionInfo?.token ?? token,
      setupRegistrationFile:
        this.setupConnectionInfo?.registrationFile ?? this.connectionInfo.registrationFile,
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
          resourcesListOk: null,
          resourceTemplatesListOk: null,
          resourceReadOk: null,
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
        resourcesListOk: null,
        resourceTemplatesListOk: null,
        resourceReadOk: null,
      },
      lastError: null,
    });

    let healthOk: boolean | null = null;
    let initializeOk: boolean | null = null;
    let toolsListOk: boolean | null = null;
    let resourcesListOk: boolean | null = null;
    let resourceTemplatesListOk: boolean | null = null;
    let resourceReadOk: boolean | null = null;

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
        accept: MCP_JSON_ACCEPT_HEADER,
        'content-type': 'application/json',
      };

      const initializeResponse = await fetch(this.connectionInfo.url, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 'self-test-initialize',
          method: 'initialize',
          params: {
            protocolVersion: '2025-11-25',
            capabilities: {},
            clientInfo: {
              name: 'loop-browser-self-test',
              version: SERVER_VERSION,
            },
          },
        }),
      });

      if (!initializeResponse.ok) {
        throw new Error(`initialize returned ${initializeResponse.status}.`);
      }

      const initializePayload = (await initializeResponse.json()) as {
        result?: {
          protocolVersion?: string;
          serverInfo?: {
            name?: string;
          };
        };
      };

      initializeOk =
        initializePayload.result?.serverInfo?.name === SERVER_NAME &&
        typeof initializePayload.result?.protocolVersion === 'string' &&
        isSupportedProtocolVersion(initializePayload.result.protocolVersion);
      if (!initializeOk) {
        throw new Error('initialize returned an unexpected server name.');
      }

      const negotiatedProtocolVersion = initializePayload.result!.protocolVersion!;
      const requestHeaders = {
        ...headers,
        'mcp-protocol-version': negotiatedProtocolVersion,
      };

      const toolsResponse = await fetch(this.connectionInfo.url, {
        method: 'POST',
        headers: requestHeaders,
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
      toolsListOk = this.toolDefinitions.every((tool) => returnedTools.includes(tool.name));

      if (!toolsListOk) {
        throw new Error('tools/list did not return the expected tool inventory.');
      }

      const resourcesResponse = await fetch(this.connectionInfo.url, {
        method: 'POST',
        headers: requestHeaders,
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 'self-test-resources',
          method: 'resources/list',
        }),
      });

      if (!resourcesResponse.ok) {
        throw new Error(`resources/list returned ${resourcesResponse.status}.`);
      }

      const resourcesPayload = (await resourcesResponse.json()) as {
        result?: {
          resources?: Array<{ uri?: string }>;
        };
      };

      resourcesListOk = resourcesPayload.result?.resources?.some(
        (resource) => resource.uri === GLOBAL_SESSIONS_RESOURCE_URI,
      ) ?? false;
      if (!resourcesListOk) {
        throw new Error('resources/list did not return the expected resource inventory.');
      }

      const resourceTemplatesResponse = await fetch(this.connectionInfo.url, {
        method: 'POST',
        headers: requestHeaders,
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 'self-test-resource-templates',
          method: 'resources/templates/list',
        }),
      });

      if (!resourceTemplatesResponse.ok) {
        throw new Error(
          `resources/templates/list returned ${resourceTemplatesResponse.status}.`,
        );
      }

      const resourceTemplatesPayload = (await resourceTemplatesResponse.json()) as {
        result?: {
          resourceTemplates?: Array<{ uriTemplate?: string }>;
        };
      };

      resourceTemplatesListOk = resourceTemplatesPayload.result?.resourceTemplates?.some(
        (resourceTemplate) =>
          resourceTemplate.uriTemplate === 'loop-browser:///session/{sessionId}/summary',
      ) ?? false;
      if (!resourceTemplatesListOk) {
        throw new Error(
          'resources/templates/list did not return the expected template inventory.',
        );
      }

      const resourceReadResponse = await fetch(this.connectionInfo.url, {
        method: 'POST',
        headers: requestHeaders,
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 'self-test-resource-read',
          method: 'resources/read',
          params: {
            uri: GLOBAL_SESSIONS_RESOURCE_URI,
          },
        }),
      });

      if (!resourceReadResponse.ok) {
        throw new Error(`resources/read returned ${resourceReadResponse.status}.`);
      }

      const resourceReadPayload = (await resourceReadResponse.json()) as {
        result?: {
          contents?: Array<{ uri?: string; text?: string }>;
        };
      };

      resourceReadOk =
        resourceReadPayload.result?.contents?.[0]?.uri === GLOBAL_SESSIONS_RESOURCE_URI &&
        typeof resourceReadPayload.result?.contents?.[0]?.text === 'string';
      if (!resourceReadOk) {
        throw new Error('resources/read did not return the expected sessions resource.');
      }

      this.updateDiagnostics({
        lastSelfTest: {
          status: 'passed',
          checkedAt,
          summary:
            'Health, initialize, tools/list, resources/list, resources/templates/list, and resources/read succeeded.',
          healthOk,
          initializeOk,
          toolsListOk,
          resourcesListOk,
          resourceTemplatesListOk,
          resourceReadOk,
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
          resourcesListOk,
          resourceTemplatesListOk,
          resourceReadOk,
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

    if (request.method === 'GET' && request.url === '/mcp') {
      if (!this.isAllowedOrigin(request.headers.origin)) {
        response.writeHead(403, { 'content-type': 'application/json; charset=utf-8' });
        response.end(JSON.stringify({ error: 'Forbidden origin' }));
        this.recordRequest('GET', '/mcp forbidden origin', 'rejected');
        return;
      }

      response.writeHead(405, {
        allow: 'POST',
        'content-type': 'application/json; charset=utf-8',
      });
      response.end(JSON.stringify({ error: 'SSE streams are not supported on this endpoint.' }));
      this.recordRequest('GET', '/mcp sse unsupported', 'rejected');
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
    const protocolVersionHeader = getHeaderValue(request.headers[MCP_PROTOCOL_VERSION_HEADER]);

    if (protocolVersionHeader && !isSupportedProtocolVersion(protocolVersionHeader)) {
      jsonError(
        response,
        400,
        requestId,
        -32602,
        'Unsupported protocol version',
        {
          requested: protocolVersionHeader,
          supported: SUPPORTED_PROTOCOL_VERSIONS,
        },
      );
      this.recordRequest(requestMeta.method, requestMeta.detail, 'error');
      return;
    }

    if (isExternalToolCall) {
      this.beginExternalToolCall();
    }

    try {
      const result = await this.dispatch(requestPayload.method, requestPayload.params);
      jsonResponse(response, 200, {
        jsonrpc: '2.0',
        id: requestId,
        result,
      }, requestPayload.method === 'initialize' && isRecord(result) && typeof result.protocolVersion === 'string'
        ? { 'MCP-Protocol-Version': result.protocolVersion }
        : protocolVersionHeader
          ? { 'MCP-Protocol-Version': protocolVersionHeader }
          : undefined);
      this.recordRequest(requestMeta.method, requestMeta.detail, 'success');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Internal server error';
      if (error instanceof ToolServerRpcError) {
        jsonError(
          response,
          error.statusCode,
          requestId,
          error.code,
          error.message,
          error.data,
          protocolVersionHeader ? { 'MCP-Protocol-Version': protocolVersionHeader } : undefined,
        );
      } else {
        jsonError(
          response,
          500,
          requestId,
          -32000,
          message,
          undefined,
          protocolVersionHeader ? { 'MCP-Protocol-Version': protocolVersionHeader } : undefined,
        );
      }
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
      case 'initialize': {
        const protocolVersion = this.resolveInitializeProtocolVersion(params);
        return {
          protocolVersion,
          serverInfo: {
            name: SERVER_NAME,
            version: SERVER_VERSION,
          },
          capabilities: {
            resources: {},
            tools: {
              listChanged: false,
            },
          },
        };
      }
      case 'tools/list':
        return {
          tools: this.toolDefinitions,
        };
      case 'resources/list':
        return {
          resources: buildResourceDefinitions(await this.listResourceSessions()),
        };
      case 'resources/templates/list':
        return {
          resourceTemplates: RESOURCE_TEMPLATES,
        };
      case 'resources/read':
        return this.executeResourceRead(params);
      case 'tools/call':
        return this.executeToolCall(params);
      case 'internal/sessionFocus':
        if (!this.internalControl) {
          throw new Error('Internal session focus is unavailable.');
        }
        await this.internalControl.focusWindow();
        return { ok: true };
      case 'internal/sessionClose':
        if (!this.internalControl) {
          throw new Error('Internal session close is unavailable.');
        }
        await this.internalControl.closeWindow();
        return { ok: true };
      default:
        throw new ToolServerRpcError(404, -32601, `Unknown JSON-RPC method: ${method}`);
    }
  }

  private resolveInitializeProtocolVersion(params: unknown): SupportedProtocolVersion {
    const requestedVersion =
      isRecord(params) && typeof params.protocolVersion === 'string'
        ? params.protocolVersion
        : DEFAULT_PROTOCOL_VERSION;

    if (!isSupportedProtocolVersion(requestedVersion)) {
      throw new ToolServerRpcError(400, -32602, 'Unsupported protocol version', {
        requested: requestedVersion,
        supported: SUPPORTED_PROTOCOL_VERSIONS,
      });
    }

    return requestedVersion;
  }

  private async listResourceSessions(): Promise<SessionSummary[]> {
    if (this.runtime.listSessions) {
      return await this.runtime.listSessions();
    }

    if (this.runtime.getCurrentSession) {
      const currentSession = await this.runtime.getCurrentSession();
      return currentSession ? [currentSession] : [];
    }

    return [];
  }

  private async resolveSessionSummary(sessionId: string): Promise<SessionSummary | null> {
    const sessions = await this.listResourceSessions();
    return sessions.find((session) => session.sessionId === sessionId) ?? null;
  }

  private createResourceNotFoundError(uri: string): ToolServerRpcError {
    return new ToolServerRpcError(404, RESOURCE_NOT_FOUND_ERROR_CODE, 'Resource not found', {
      uri,
    });
  }

  private async executeResourceRead(params: unknown): Promise<unknown> {
    if (!isRecord(params) || typeof params.uri !== 'string' || params.uri.trim().length === 0) {
      throw new Error('resources/read requires a non-empty uri.');
    }

    const parsedResourceUri = parseResourceUri(params.uri);
    if (!parsedResourceUri) {
      throw this.createResourceNotFoundError(params.uri);
    }

    if (parsedResourceUri.kind === 'sessions') {
      return buildJsonResourceResult(parsedResourceUri.uri, {
        sessions: await this.listResourceSessions(),
      });
    }

    const session = await this.resolveSessionSummary(parsedResourceUri.sessionId);
    if (!session) {
      throw this.createResourceNotFoundError(parsedResourceUri.uri);
    }

    if (this.runtime.proxyResourceRead) {
      return this.runtime.proxyResourceRead(parsedResourceUri.sessionId, parsedResourceUri.uri);
    }

    switch (parsedResourceUri.resourceKind) {
      case 'summary':
        return buildJsonResourceResult(parsedResourceUri.uri, { session });
      case 'tabs':
        return buildJsonResourceResult(parsedResourceUri.uri, {
          tabs: await this.runtime.listTabs(parsedResourceUri.sessionId),
        });
      case 'window':
        return buildJsonResourceResult(parsedResourceUri.uri, {
          window: await this.runtime.getWindowState(parsedResourceUri.sessionId),
        });
      case 'pickerSelection':
        return buildJsonResourceResult(parsedResourceUri.uri, {
          picker: await this.runtime.getPickerState(parsedResourceUri.sessionId),
        });
      case 'feedback':
        return buildJsonResourceResult(parsedResourceUri.uri, {
          feedback: await this.runtime.getFeedbackState(parsedResourceUri.sessionId),
        });
      case 'pageMarkdown': {
        const markdownView = await this.runtime.getMarkdownForCurrentPage(
          false,
          parsedResourceUri.sessionId,
        );

        if (markdownView.status !== 'ready') {
          throw new Error(markdownView.lastError ?? 'Markdown view is not ready.');
        }

        return buildJsonResourceResult(parsedResourceUri.uri, {
          url: markdownView.sourceUrl,
          title: markdownView.title,
          markdown: markdownView.markdown,
          author: markdownView.author,
          site: markdownView.site,
          wordCount: markdownView.wordCount,
        });
      }
      case 'artifacts':
        return buildJsonResourceResult(parsedResourceUri.uri, {
          artifacts: await this.artifactStore.listArtifacts(),
        });
      default:
        throw this.createResourceNotFoundError(parsedResourceUri.uri);
    }
  }

  private resolveSessionId(argsToolName: string, args: Record<string, unknown>): string | undefined {
    if (!SESSION_SCOPED_TOOL_NAMES.has(argsToolName)) {
      return typeof args.sessionId === 'string' && args.sessionId.trim().length > 0
        ? args.sessionId
        : undefined;
    }

    if (!this.requireSessionId) {
      return typeof args.sessionId === 'string' && args.sessionId.trim().length > 0
        ? args.sessionId
        : undefined;
    }

    if (typeof args.sessionId !== 'string' || args.sessionId.trim().length === 0) {
      throw new Error(`Tool ${argsToolName} requires sessionId. Call session.list first.`);
    }

    return args.sessionId;
  }

  private async executeToolCall(params: unknown): Promise<unknown> {
    if (!isRecord(params) || typeof params.name !== 'string') {
      throw new Error('Tool calls require a name.');
    }

    const args = isRecord(params.arguments) ? params.arguments : {};
    const sessionId = this.resolveSessionId(params.name, args);

    if (
      sessionId &&
      this.requireSessionId &&
      SESSION_SCOPED_TOOL_NAMES.has(params.name) &&
      this.runtime.proxyToolCall
    ) {
      return this.runtime.proxyToolCall(sessionId, params.name, args);
    }

    switch (params.name) {
      case 'session.list':
        if (!this.runtime.listSessions) {
          throw new Error('Session listing is unavailable in this runtime.');
        }
        return toolResult({
          sessions: await this.runtime.listSessions(),
        });
      case 'session.open':
        if (!this.runtime.openSession) {
          throw new Error('Session opening is unavailable in this runtime.');
        }
        return toolResult({
          sessions: await this.runtime.openSession(
            typeof args.projectRoot === 'string' ? args.projectRoot : undefined,
          ),
        });
      case 'session.focus':
        if (!this.runtime.focusSession) {
          throw new Error('Session focusing is unavailable in this runtime.');
        }
        if (typeof args.sessionId !== 'string' || args.sessionId.trim().length === 0) {
          throw new Error('session.focus requires a non-empty sessionId.');
        }
        return toolResult({
          session: await this.runtime.focusSession(args.sessionId),
        });
      case 'session.close':
        if (!this.runtime.closeSession) {
          throw new Error('Session closing is unavailable in this runtime.');
        }
        if (typeof args.sessionId !== 'string' || args.sessionId.trim().length === 0) {
          throw new Error('session.close requires a non-empty sessionId.');
        }
        return toolResult({
          sessions: await this.runtime.closeSession(args.sessionId),
        });
      case 'session.getCurrent':
        if (!this.runtime.getCurrentSession) {
          throw new Error('Current session inspection is unavailable in this runtime.');
        }
        return toolResult({
          session: await this.runtime.getCurrentSession(),
        });
      case 'browser.listTabs':
        return toolResult({ tabs: await this.runtime.listTabs(sessionId) });
      case 'page.navigate':
        if (typeof args.target !== 'string' || args.target.trim().length === 0) {
          throw new Error('page.navigate requires a non-empty target.');
        }

        return toolResult({
          navigation: await this.runtime.executeNavigationCommand({
            action: 'navigate',
            target: args.target,
          }, sessionId),
        });
      case 'page.reload':
        return toolResult({
          navigation: await this.runtime.executeNavigationCommand({
            action: 'reload',
          }, sessionId),
        });
      case 'picker.enable':
        return toolResult({
          picker: await this.runtime.executePickerCommand({ action: 'enable' }, sessionId),
        });
      case 'picker.disable':
        return toolResult({
          picker: await this.runtime.executePickerCommand({ action: 'disable' }, sessionId),
        });
      case 'picker.lastSelection':
        return toolResult({
          picker: await this.runtime.getPickerState(sessionId),
        });
      case 'chrome.getAppearance':
        return toolResult({
          appearance: await this.runtime.getChromeAppearanceState(sessionId),
        });
      case 'chrome.setAppearance': {
        if (
          typeof args.chromeColor !== 'string' &&
          typeof args.accentColor !== 'string' &&
          typeof args.projectIconPath !== 'string' &&
          typeof args.defaultUrl !== 'string' &&
          typeof args.agentLoginUsernameEnv !== 'string' &&
          typeof args.agentLoginPasswordEnv !== 'string'
        ) {
          throw new Error(
            'chrome.setAppearance requires at least one of chromeColor, accentColor, projectIconPath, defaultUrl, agentLoginUsernameEnv, or agentLoginPasswordEnv.',
          );
        }

        return toolResult({
          appearance: await this.runtime.executeChromeAppearanceCommand({
            action: 'set',
            chromeColor: typeof args.chromeColor === 'string' ? args.chromeColor : undefined,
            accentColor: typeof args.accentColor === 'string' ? args.accentColor : undefined,
            defaultUrl: typeof args.defaultUrl === 'string' ? args.defaultUrl : undefined,
            agentLoginUsernameEnv:
              typeof args.agentLoginUsernameEnv === 'string'
                ? args.agentLoginUsernameEnv
                : undefined,
            agentLoginPasswordEnv:
              typeof args.agentLoginPasswordEnv === 'string'
                ? args.agentLoginPasswordEnv
                : undefined,
            projectIconPath:
              typeof args.projectIconPath === 'string' ? args.projectIconPath : undefined,
          }, sessionId),
        });
      }
      case 'chrome.resetAppearance':
        return toolResult({
          appearance: await this.runtime.executeChromeAppearanceCommand({
            action: 'reset',
          }, sessionId),
        });
      case 'feedback.getState':
        return toolResult({
          feedback: await this.runtime.getFeedbackState(sessionId),
        });
      case 'feedback.list': {
        const state = await this.runtime.getFeedbackState(sessionId);
        const annotations =
          typeof args.status === 'string'
            ? state.annotations.filter((annotation) => annotation.status === args.status)
            : state.annotations;
        return toolResult({ annotations });
      }
      case 'feedback.create': {
        const selection = (await this.runtime.getPickerState(sessionId)).lastSelection;
        if (!selection) {
          throw new Error('feedback.create requires an existing picker selection.');
        }

        await this.runtime.executeFeedbackCommand({
          action: 'startDraftFromSelection',
          selection,
        }, sessionId);
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
        }, sessionId);
        const feedback = await this.runtime.executeFeedbackCommand({ action: 'submitDraft' }, sessionId);
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
          }, sessionId),
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

        const currentState = await this.runtime.getFeedbackState(sessionId);
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
        }, sessionId);
        const feedback = await this.runtime.executeFeedbackCommand({
          action: 'reply',
          annotationId: annotation.id,
          body: message,
          author: 'agent',
        }, sessionId);
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
          }, sessionId),
        });
      case 'page.viewAsMarkdown': {
        const markdownView = await this.runtime.getMarkdownForCurrentPage(
          typeof args.forceRefresh === 'boolean' ? args.forceRefresh : false,
          sessionId,
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

        const capture = await this.runtime.captureScreenshot(args, sessionId);
        const artifact = await this.saveScreenshotArtifact(capture);
        return toolResult(artifact);
      }
      case 'browser.getWindowState':
        return toolResult({
          window: await this.runtime.getWindowState(sessionId),
        });
      case 'browser.resizeWindow': {
        if (!isResizeWindowRequest(args)) {
          throw new Error('browser.resizeWindow requires numeric width and height.');
        }

        return toolResult({
          window: await this.runtime.resizeWindow(args, sessionId),
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
