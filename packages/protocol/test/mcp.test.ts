import { describe, expect, it } from 'vitest';
import {
  createEmptyMcpViewState,
  isMcpViewCommand,
  isMcpViewState,
} from '../src/index';

describe('mcp view protocol guards', () => {
  it('accepts valid commands', () => {
    expect(isMcpViewCommand({ action: 'open' })).toBe(true);
    expect(isMcpViewCommand({ action: 'refresh' })).toBe(true);
    expect(isMcpViewCommand({ action: 'selfTest' })).toBe(true);
  });

  it('accepts a valid MCP state', () => {
    expect(
      isMcpViewState({
        ...createEmptyMcpViewState(),
        indicator: 'green',
        lifecycle: 'listening',
        statusLabel: 'MCP ready',
        transportUrl: 'http://127.0.0.1:46255/mcp',
        host: '127.0.0.1',
        port: 46255,
        authTokenPreview: '25b7…16f3',
        hasAuthToken: true,
        registrationFile: '/tmp/mcp-registration.json',
        tools: ['browser.listTabs'],
        requestCount: 4,
        lastRequestAt: '2026-03-13T21:10:00.000Z',
        recentRequests: [
          {
            at: '2026-03-13T21:10:00.000Z',
            method: 'tools/call',
            detail: 'browser.listTabs',
            outcome: 'success',
          },
        ],
        lastSelfTest: {
          status: 'passed',
          checkedAt: '2026-03-13T21:09:00.000Z',
          summary: 'Health, initialize, and tools/list succeeded.',
          healthOk: true,
          initializeOk: true,
          toolsListOk: true,
        },
        lastUpdatedAt: '2026-03-13T21:10:00.000Z',
      }),
    ).toBe(true);
  });

  it('rejects malformed MCP payloads', () => {
    expect(isMcpViewCommand({ action: 'restart' })).toBe(false);
    expect(
      isMcpViewState({
        ...createEmptyMcpViewState(),
        recentRequests: [{ at: 'now', method: 'initialize', detail: 'initialize', outcome: 'ok' }],
      }),
    ).toBe(false);
  });
});
