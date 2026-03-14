import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createEmptyMarkdownViewState,
  createEmptyMcpViewState,
} from '@agent-browser/protocol';

vi.mock('electron', () => ({
  BaseWindow: class {},
  WebContentsView: class {},
  app: {
    getAppPath: () => '/tmp/app',
    isPackaged: false,
  },
  desktopCapturer: {
    getSources: vi.fn(async () => []),
  },
  ipcMain: {
    removeHandler: vi.fn(),
    handle: vi.fn(),
    removeAllListeners: vi.fn(),
    on: vi.fn(),
  },
  screen: {
    getDisplayMatching: () => ({
      scaleFactor: 2,
    }),
  },
  shell: {
    openExternal: vi.fn(),
  },
}));

import { BrowserShell } from '../src/main/browser-shell';

const createFakePanelView = () => ({
  setBounds: vi.fn(),
  webContents: {
    id: Math.floor(Math.random() * 1000) + 1,
    isDestroyed: () => false,
    send: vi.fn(),
  },
});

type BrowserShellHarness = {
  window: {
    contentView: {
      addChildView: ReturnType<typeof vi.fn>;
      removeChildView: ReturnType<typeof vi.fn>;
    };
  } | null;
  layoutViews: ReturnType<typeof vi.fn>;
  sendMarkdownViewState: ReturnType<typeof vi.fn>;
  sendMcpViewState: ReturnType<typeof vi.fn>;
  syncMcpViewState: ReturnType<typeof vi.fn>;
  refreshMarkdownView: ReturnType<typeof vi.fn>;
  ensureMcpPanelMounted: ReturnType<typeof vi.fn>;
  ensureMarkdownPanelMounted: ReturnType<typeof vi.fn>;
  markdownViewState: ReturnType<typeof createEmptyMarkdownViewState>;
  markdownPanelMounted: boolean;
  markdownPanelView: ReturnType<typeof createFakePanelView> | null;
  mcpViewState: ReturnType<typeof createEmptyMcpViewState>;
  mcpPanelMounted: boolean;
  mcpPanelView: ReturnType<typeof createFakePanelView> | null;
};

describe('BrowserShell', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('maps attached MCP diagnostics into trusted UI state', () => {
    const shell = new BrowserShell();
    const subscribe = vi.fn();

    shell.attachMcpDiagnostics({
      getDiagnostics: () => ({
        lifecycle: 'listening',
        url: 'http://127.0.0.1:46255/mcp',
        host: '127.0.0.1',
        port: 46255,
        token: '25b79a64f932e91b0a7b8ae13002eb0593a5dbfcf5ed16f3',
        registrationFile: '/tmp/mcp-registration.json',
        tools: ['browser.listTabs', 'page.navigate'],
        requestCount: 3,
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
        lastError: null,
        lastUpdatedAt: '2026-03-13T21:10:00.000Z',
      }),
      subscribe: (listener) => {
        subscribe(listener);
        return () => undefined;
      },
      runSelfTest: async () => ({
        lifecycle: 'listening',
        url: 'http://127.0.0.1:46255/mcp',
        host: '127.0.0.1',
        port: 46255,
        token: '25b79a64',
        registrationFile: '/tmp/mcp-registration.json',
        tools: [],
        requestCount: 0,
        lastRequestAt: null,
        recentRequests: [],
        lastSelfTest: {
          status: 'passed',
          checkedAt: '2026-03-13T21:09:00.000Z',
          summary: 'ok',
          healthOk: true,
          initializeOk: true,
          toolsListOk: true,
        },
        lastError: null,
        lastUpdatedAt: '2026-03-13T21:10:00.000Z',
      }),
    });

    const state = shell.getMcpViewState();
    expect(state.indicator).toBe('green');
    expect(state.authTokenPreview).toBe('25b7...16f3');
    expect(state.tools).toContain('page.navigate');
    expect(subscribe).toHaveBeenCalledTimes(1);
  });

  it('keeps Markdown and MCP panels mutually exclusive', async () => {
    const shell = new BrowserShell();
    const subject = shell as unknown as BrowserShellHarness;

    subject.window = {
      contentView: {
        addChildView: vi.fn(),
        removeChildView: vi.fn(),
      },
    };
    subject.layoutViews = vi.fn();
    subject.sendMarkdownViewState = vi.fn();
    subject.sendMcpViewState = vi.fn();
    subject.syncMcpViewState = vi.fn();
    subject.refreshMarkdownView = vi.fn(async () => shell.getMarkdownViewState());
    subject.ensureMcpPanelMounted = vi.fn(() => {
      subject.mcpPanelMounted = true;
      subject.mcpPanelView = createFakePanelView();
    });
    subject.ensureMarkdownPanelMounted = vi.fn(() => {
      subject.markdownPanelMounted = true;
      subject.markdownPanelView = createFakePanelView();
    });

    subject.markdownViewState = {
      ...createEmptyMarkdownViewState(),
      isOpen: true,
    };
    subject.markdownPanelMounted = true;
    subject.markdownPanelView = createFakePanelView();

    await shell.executeMcpViewCommand({ action: 'open' });
    expect(shell.getMarkdownViewState().isOpen).toBe(false);
    expect(shell.getMcpViewState().isOpen).toBe(true);

    subject.mcpViewState = {
      ...createEmptyMcpViewState(),
      isOpen: true,
    };
    subject.mcpPanelMounted = true;
    subject.mcpPanelView = createFakePanelView();

    await shell.executeMarkdownViewCommand({ action: 'open' });
    expect(shell.getMcpViewState().isOpen).toBe(false);
    expect(shell.getMarkdownViewState().isOpen).toBe(true);
  });
});
