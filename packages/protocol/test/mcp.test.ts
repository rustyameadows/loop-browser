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
    expect(
      isMcpViewCommand({ action: 'setPresentation', mode: 'floating-pill' }),
    ).toBe(true);
    expect(
      isMcpViewCommand({ action: 'moveFloatingPill', deltaX: -10, deltaY: 6 }),
    ).toBe(true);
  });

  it('accepts a valid MCP state', () => {
    expect(
      isMcpViewState({
        ...createEmptyMcpViewState(),
        indicator: 'green',
        lifecycle: 'listening',
        statusLabel: 'MCP ready',
        setupLabel: 'This window',
        setupTransportUrl: 'http://127.0.0.1:46255/mcp',
        setupAuthToken: '25b79a64f932e91b0a7b8ae13002eb0593a5dbfcf5ed16f3',
        setupRegistrationFile: '/tmp/mcp-registration.json',
        transportUrl: 'http://127.0.0.1:46255/mcp',
        host: '127.0.0.1',
        port: 46255,
        authToken: '25b79a64f932e91b0a7b8ae13002eb0593a5dbfcf5ed16f3',
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
        activeToolCalls: 1,
        busySince: '2026-03-13T21:09:58.000Z',
        lastBusyAt: '2026-03-13T21:10:00.000Z',
        agentActivity: {
          annotationId: 'annotation-1',
          phase: 'in_progress',
          message: 'Agent is working on this.',
          updatedAt: '2026-03-13T21:10:00.000Z',
        },
        lastSelfTest: {
          status: 'passed',
          checkedAt: '2026-03-13T21:09:00.000Z',
          summary:
            'Health, initialize, tools/list, resources/list, resources/templates/list, and resources/read succeeded.',
          healthOk: true,
          initializeOk: true,
          toolsListOk: true,
          resourcesListOk: true,
          resourceTemplatesListOk: true,
          resourceReadOk: true,
        },
        lastUpdatedAt: '2026-03-13T21:10:00.000Z',
      }),
    ).toBe(true);
  });

  it('rejects malformed MCP payloads', () => {
    expect(isMcpViewCommand({ action: 'restart' })).toBe(false);
    expect(
      isMcpViewCommand({ action: 'setPresentation', mode: 'sidebar', side: 'bottom' }),
    ).toBe(false);
    expect(
      isMcpViewCommand({ action: 'moveFloatingPill', deltaX: 0, deltaY: '6' }),
    ).toBe(false);
    expect(
      isMcpViewState({
        ...createEmptyMcpViewState(),
        recentRequests: [{ at: 'now', method: 'initialize', detail: 'initialize', outcome: 'ok' }],
      }),
    ).toBe(false);
    expect(
      isMcpViewState({
        ...createEmptyMcpViewState(),
        agentActivity: {
          annotationId: 'annotation-1',
          phase: 'working',
          message: 'nope',
          updatedAt: '2026-03-13T21:10:00.000Z',
        },
      }),
    ).toBe(false);
  });
});
