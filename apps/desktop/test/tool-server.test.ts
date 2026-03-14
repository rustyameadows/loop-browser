import { mkdtemp, rm, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  createEmptyMarkdownViewState,
  createEmptyNavigationState,
  createEmptyPickerState,
} from '@agent-browser/protocol';
import { ToolServer } from '../src/main/tool-server';

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map(async (directory) => {
      await rm(directory, { recursive: true, force: true });
    }),
  );
});

describe('ToolServer', () => {
  it('requires auth and serves initialize plus tool calls', async () => {
    const storageDir = await mkdtemp(path.join(os.tmpdir(), 'agent-browser-tool-server-'));
    tempDirs.push(storageDir);

    let lastNavigationTarget: string | null = null;

    const server = new ToolServer({
      runtime: {
        listTabs: () => [
          {
            tabId: 'tab-1',
            url: 'https://example.com',
            title: 'Example Domain',
            isLoading: false,
          },
        ],
        executeNavigationCommand: async (command) => {
          lastNavigationTarget = command.action === 'navigate' ? command.target : null;
          return {
            ...createEmptyNavigationState(),
            url: command.action === 'navigate' ? command.target : '',
          };
        },
        executePickerCommand: async (command) => ({
          ...createEmptyPickerState(),
          enabled: command.action === 'enable',
        }),
        getPickerState: () => ({
          ...createEmptyPickerState(),
          lastSelection: null,
        }),
        getMarkdownForCurrentPage: async () => ({
          ...createEmptyMarkdownViewState(),
          status: 'ready',
          sourceUrl: 'https://example.com',
          title: 'Example Domain',
          markdown: '# Example Domain',
          site: 'example.com',
          wordCount: 2,
        }),
      },
      storageDir,
      port: 0,
      logger: {
        info: () => undefined,
        warn: () => undefined,
        error: () => undefined,
      },
    });

    const connection = await server.start();
    expect(server.getDiagnostics().lifecycle).toBe('listening');
    expect(server.getDiagnostics().tools).toContain('page.viewAsMarkdown');

    const unauthorized = await fetch(connection.url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
      }),
    });
    expect(unauthorized.status).toBe(401);

    const initializeResponse = await fetch(connection.url, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${connection.token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
      }),
    });

    const initializePayload = (await initializeResponse.json()) as {
      result: {
        serverInfo: {
          name: string;
        };
      };
    };
    expect(initializeResponse.status).toBe(200);
    expect(initializePayload.result.serverInfo.name).toBe('agent-browser');

    const toolsResponse = await fetch(connection.url, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${connection.token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 2,
        method: 'tools/list',
      }),
    });

    const toolsPayload = (await toolsResponse.json()) as {
      result: {
        tools: Array<{ name: string }>;
      };
    };
    expect(toolsPayload.result.tools.map((tool) => tool.name)).toContain('page.navigate');
    expect(toolsPayload.result.tools.map((tool) => tool.name)).toContain('page.viewAsMarkdown');

    const navigateResponse = await fetch(connection.url, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${connection.token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 3,
        method: 'tools/call',
        params: {
          name: 'page.navigate',
          arguments: {
            target: 'https://nodesnodesnodes.com',
          },
        },
      }),
    });

    const navigatePayload = (await navigateResponse.json()) as {
      result: {
        structuredContent: {
          navigation: {
            url: string;
          };
        };
      };
    };
    expect(navigatePayload.result.structuredContent.navigation.url).toBe(
      'https://nodesnodesnodes.com',
    );
    expect(lastNavigationTarget).toBe('https://nodesnodesnodes.com');

    const markdownResponse = await fetch(connection.url, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${connection.token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 4,
        method: 'tools/call',
        params: {
          name: 'page.viewAsMarkdown',
          arguments: {
            forceRefresh: true,
          },
        },
      }),
    });

    const markdownPayload = (await markdownResponse.json()) as {
      result: {
        structuredContent: {
          title: string;
          markdown: string;
        };
      };
    };
    expect(markdownPayload.result.structuredContent.title).toBe('Example Domain');
    expect(markdownPayload.result.structuredContent.markdown).toContain('# Example Domain');

    const diagnosticsAfterCalls = server.getDiagnostics();
    expect(diagnosticsAfterCalls.requestCount).toBeGreaterThanOrEqual(4);
    expect(diagnosticsAfterCalls.recentRequests[0]?.detail).toBe('page.viewAsMarkdown');

    const registrationStats = await stat(connection.registrationFile);
    expect(registrationStats.isFile()).toBe(true);

    const selfTestDiagnostics = await server.runSelfTest();
    expect(selfTestDiagnostics.lastSelfTest.status).toBe('passed');
    expect(selfTestDiagnostics.lastSelfTest.healthOk).toBe(true);
    expect(selfTestDiagnostics.lastSelfTest.initializeOk).toBe(true);
    expect(selfTestDiagnostics.lastSelfTest.toolsListOk).toBe(true);

    await server.stop();
  });

  it('records a failed self-test when the server is offline', async () => {
    const storageDir = await mkdtemp(path.join(os.tmpdir(), 'agent-browser-tool-server-'));
    tempDirs.push(storageDir);

    const server = new ToolServer({
      runtime: {
        listTabs: () => [],
        executeNavigationCommand: async () => createEmptyNavigationState(),
        executePickerCommand: async () => createEmptyPickerState(),
        getPickerState: () => createEmptyPickerState(),
        getMarkdownForCurrentPage: async () => createEmptyMarkdownViewState(),
      },
      storageDir,
      port: 0,
      logger: {
        info: () => undefined,
        warn: () => undefined,
        error: () => undefined,
      },
    });

    const diagnostics = await server.runSelfTest();
    expect(diagnostics.lastSelfTest.status).toBe('failed');
    expect(diagnostics.lastSelfTest.summary).toContain('not listening');
  });
});
