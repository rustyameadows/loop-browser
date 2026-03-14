import { describe, expect, it } from 'vitest';
import { mapDiagnosticsToMcpViewState } from '../src/main/mcp-view';

describe('mapDiagnosticsToMcpViewState', () => {
  it('maps a verified listening server to a green UI state', () => {
    const state = mapDiagnosticsToMcpViewState(
      {
        lifecycle: 'listening',
        url: 'http://127.0.0.1:46255/mcp',
        host: '127.0.0.1',
        port: 46255,
        token: '25b79a64f932e91b0a7b8ae13002eb0593a5dbfcf5ed16f3',
        registrationFile: '/tmp/mcp-registration.json',
        tools: ['browser.listTabs'],
        requestCount: 1,
        lastRequestAt: '2026-03-13T21:10:00.000Z',
        recentRequests: [],
        lastSelfTest: {
          status: 'passed',
          checkedAt: '2026-03-13T21:09:00.000Z',
          summary: 'Health, initialize, and tools/list succeeded.',
          healthOk: true,
          initializeOk: true,
          toolsListOk: true,
        },
        lastError: null,
        lastUpdatedAt: '2026-03-13T21:10:00.000Z',
      },
      true,
    );

    expect(state.isOpen).toBe(true);
    expect(state.indicator).toBe('green');
    expect(state.statusLabel).toBe('MCP server verified.');
    expect(state.authTokenPreview).toBe('25b7...16f3');
  });

  it('maps a failed self-test to a red UI state', () => {
    const state = mapDiagnosticsToMcpViewState(
      {
        lifecycle: 'listening',
        url: 'http://127.0.0.1:46255/mcp',
        host: '127.0.0.1',
        port: 46255,
        token: 'abcd1234',
        registrationFile: '/tmp/mcp-registration.json',
        tools: [],
        requestCount: 0,
        lastRequestAt: null,
        recentRequests: [],
        lastSelfTest: {
          status: 'failed',
          checkedAt: '2026-03-13T21:09:00.000Z',
          summary: 'tools/list failed.',
          healthOk: true,
          initializeOk: true,
          toolsListOk: false,
        },
        lastError: 'tools/list failed.',
        lastUpdatedAt: '2026-03-13T21:10:00.000Z',
      },
      false,
    );

    expect(state.indicator).toBe('red');
    expect(state.statusLabel).toContain('tools/list failed');
  });
});
