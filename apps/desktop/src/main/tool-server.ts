import { randomBytes } from 'node:crypto';
import { promises as fs } from 'node:fs';
import http, { type IncomingMessage, type ServerResponse } from 'node:http';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import type {
  NavigationCommand,
  NavigationState,
  PickerCommand,
  PickerState,
} from '@agent-browser/protocol';

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
}

export interface ToolServerConnectionInfo {
  url: string;
  token: string;
  registrationFile: string;
}

type ToolDefinition = {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
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
];

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

export class ToolServer {
  private readonly runtime: ToolServerRuntime;
  private readonly storageDir: string;
  private readonly host: string;
  private readonly port: number;
  private readonly logger: Pick<Console, 'error' | 'info' | 'warn'>;
  private server: http.Server | null = null;
  private connectionInfo: ToolServerConnectionInfo | null = null;

  constructor(options: {
    runtime: ToolServerRuntime;
    storageDir: string;
    host?: string;
    port?: number;
    logger?: Pick<Console, 'error' | 'info' | 'warn'>;
  }) {
    this.runtime = options.runtime;
    this.storageDir = options.storageDir;
    this.host = options.host ?? '127.0.0.1';
    this.port = options.port ?? 46255;
    this.logger = options.logger ?? console;
  }

  async start(): Promise<ToolServerConnectionInfo> {
    if (this.connectionInfo) {
      return this.connectionInfo;
    }

    await fs.mkdir(this.storageDir, { recursive: true });

    const token = await this.loadOrCreateToken();
    const registrationFile = path.join(this.storageDir, 'mcp-registration.json');

    this.server = http.createServer((request, response) => {
      void this.handleRequest(request, response, token);
    });

    await new Promise<void>((resolve, reject) => {
      this.server?.once('error', reject);
      this.server?.listen(this.port, this.host, () => {
        this.server?.off('error', reject);
        resolve();
      });
    });

    const address = this.server.address() as AddressInfo | null;
    if (!address) {
      throw new Error('Tool server could not determine its listening address.');
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
          name: 'agent-browser',
          version: '0.1.0',
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

    this.logger.info(`Agent Browser tool server ready at ${this.connectionInfo.url}`);
    return this.connectionInfo;
  }

  async stop(): Promise<void> {
    this.connectionInfo = null;

    if (!this.server) {
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
  }

  getConnectionInfo(): ToolServerConnectionInfo | null {
    return this.connectionInfo;
  }

  private async handleRequest(
    request: IncomingMessage,
    response: ServerResponse,
    token: string,
  ): Promise<void> {
    if (request.url === '/health') {
      response.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
      response.end(JSON.stringify({ ok: true }));
      return;
    }

    if (request.method !== 'POST' || request.url !== '/mcp') {
      response.writeHead(404);
      response.end();
      return;
    }

    if (!this.isAuthorized(request, token)) {
      response.writeHead(401, { 'content-type': 'application/json; charset=utf-8' });
      response.end(JSON.stringify({ error: 'Unauthorized' }));
      return;
    }

    if (!this.isAllowedOrigin(request.headers.origin)) {
      response.writeHead(403, { 'content-type': 'application/json; charset=utf-8' });
      response.end(JSON.stringify({ error: 'Forbidden origin' }));
      return;
    }

    let body: string;
    try {
      body = await readBody(request);
    } catch (error) {
      this.logger.warn('Failed reading tool-server request body', error);
      response.writeHead(400);
      response.end();
      return;
    }

    let payload: unknown;
    try {
      payload = JSON.parse(body);
    } catch {
      jsonError(response, 400, null, -32700, 'Parse error');
      return;
    }

    if (Array.isArray(payload)) {
      jsonError(response, 400, null, -32600, 'Batch requests are not supported.');
      return;
    }

    if (!isRecord(payload)) {
      jsonError(response, 400, null, -32600, 'Invalid request');
      return;
    }

    const requestPayload = payload as JsonRpcRequest;
    if (requestPayload.jsonrpc !== '2.0' || typeof requestPayload.method !== 'string') {
      jsonError(response, 400, requestPayload.id ?? null, -32600, 'Invalid request');
      return;
    }

    if (requestPayload.id === undefined && requestPayload.method === 'notifications/initialized') {
      response.writeHead(202);
      response.end();
      return;
    }

    const requestId = requestPayload.id ?? null;

    try {
      const result = await this.dispatch(requestPayload.method, requestPayload.params);
      jsonResponse(response, 200, {
        jsonrpc: '2.0',
        id: requestId,
        result,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Internal server error';
      jsonError(response, 500, requestId, -32000, message);
    }
  }

  private async dispatch(method: string, params: unknown): Promise<unknown> {
    switch (method) {
      case 'initialize':
        return {
          protocolVersion: '2026-03-26',
          serverInfo: {
            name: 'agent-browser',
            version: '0.1.0',
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
      default:
        throw new Error(`Unknown tool: ${params.name}`);
    }
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
