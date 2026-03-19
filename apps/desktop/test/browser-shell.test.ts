import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createEmptyChromeAppearanceState,
  createEmptyFeedbackState,
  createEmptyMarkdownViewState,
  createEmptyMcpViewState,
} from '@agent-browser/protocol';
import { dialog } from 'electron';

vi.mock('electron', () => ({
  BaseWindow: class {},
  WebContentsView: class {},
  app: {
    getAppPath: () => '/tmp/app',
    getPath: () => '/tmp/user-data',
    isPackaged: false,
  },
  desktopCapturer: {
    getSources: vi.fn(async () => []),
  },
  dialog: {
    showOpenDialog: vi.fn(async () => ({
      canceled: true,
      filePaths: [],
    })),
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
  nativeImage: {
    createFromBuffer: vi.fn(() => ({
      isEmpty: () => false,
    })),
  },
}));

import { BrowserShell } from '../src/main/browser-shell';

const createFakePanelView = () => ({
  setBounds: vi.fn(),
  webContents: {
    id: Math.floor(Math.random() * 1000) + 1,
    isDestroyed: () => false,
    send: vi.fn(),
    getURL: () => 'https://example.com',
    getTitle: () => 'Example Domain',
    isLoading: () => false,
    navigationHistory: {
      canGoBack: () => false,
      canGoForward: () => false,
    },
  },
});

const createProjectAppearanceRuntime = () => {
  let state = {
    ...createEmptyChromeAppearanceState(),
    projectRoot: '/tmp/project',
    configPath: '/tmp/project/.loop-browser.json',
  };

  return {
    getState: () => state,
    subscribe: () => () => undefined,
    selectProject: async (projectRoot: string | null) => {
      state = {
        ...createEmptyChromeAppearanceState(),
        projectRoot: projectRoot ?? '',
        configPath: projectRoot ? `${projectRoot}/.loop-browser.json` : '',
      };
      return state;
    },
    setAppearance: async (update: {
      chromeColor?: string;
      accentColor?: string;
      projectIconPath?: string;
    }) => {
      state = {
        ...state,
        chromeColor: update.chromeColor ?? state.chromeColor,
        accentColor: update.accentColor ?? state.accentColor,
        projectIconPath: update.projectIconPath ?? state.projectIconPath,
      };
      return state;
    },
    resetAppearance: async () => {
      state = {
        ...state,
        chromeColor: createEmptyChromeAppearanceState().chromeColor,
        accentColor: createEmptyChromeAppearanceState().accentColor,
        projectIconPath: '',
        resolvedProjectIconPath: null,
        lastError: null,
      };
      return state;
    },
    dispose: () => undefined,
  };
};

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
  pageView: ReturnType<typeof createFakePanelView> | null;
  feedbackState: ReturnType<typeof createEmptyFeedbackState>;
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
    const shell = new BrowserShell({
      projectAppearance: createProjectAppearanceRuntime(),
    });
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
        activeToolCalls: 0,
        busySince: null,
        lastBusyAt: null,
        agentActivity: null,
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
    expect(state.agentActivity?.phase).toBe('in_progress');
    expect(subscribe).toHaveBeenCalledTimes(1);
  });

  it('keeps Markdown and MCP panels mutually exclusive', async () => {
    const shell = new BrowserShell({
      projectAppearance: createProjectAppearanceRuntime(),
    });
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

  it('emits a page overlay payload for the active agent annotation on the current page', () => {
    const shell = new BrowserShell({
      projectAppearance: createProjectAppearanceRuntime(),
    });
    const subject = shell as unknown as BrowserShellHarness;
    const pageView = createFakePanelView();

    subject.pageView = pageView;
    subject.feedbackState = {
      ...createEmptyFeedbackState(),
      activeAnnotationId: 'annotation-1',
      annotations: [
        {
          id: 'annotation-1',
          selection: {
            selector: '#cta',
            xpath: '//*[@id="cta"]',
            tag: 'button',
            id: 'cta',
            classList: ['primary'],
            role: 'button',
            accessibleName: 'Launch',
            playwrightLocator: "getByRole('button', { name: 'Launch' })",
            textSnippet: 'Launch',
            bbox: {
              x: 8,
              y: 12,
              width: 120,
              height: 32,
              devicePixelRatio: 2,
            },
            attributes: {
              role: 'button',
            },
            outerHTMLExcerpt: '<button id="cta">Launch</button>',
            frame: {
              url: 'https://example.com',
              isMainFrame: true,
            },
          },
          summary: 'Button copy is vague',
          note: 'Tighten the CTA.',
          kind: 'change',
          priority: 'medium',
          status: 'in_progress',
          createdAt: '2026-03-14T00:00:00.000Z',
          updatedAt: '2026-03-14T00:00:01.000Z',
          url: 'https://example.com',
          pageTitle: 'Example Domain',
          replies: [],
        },
      ],
      lastUpdatedAt: '2026-03-14T00:00:01.000Z',
    };
    subject.mcpViewState = {
      ...createEmptyMcpViewState(),
      agentActivity: {
        annotationId: 'annotation-1',
        phase: 'in_progress',
        message: 'Agent is working on this.',
        updatedAt: '2026-03-14T00:00:01.000Z',
      },
    };

    const internalShell = shell as unknown as {
      sendPageAgentOverlay(): void;
    };
    internalShell.sendPageAgentOverlay();

    expect(pageView.webContents.send).toHaveBeenCalledWith(
      'page-agent:overlay',
      expect.objectContaining({
        annotationId: 'annotation-1',
        phase: 'in_progress',
        message: 'Agent is working on this.',
      }),
    );
  });

  it('applies chrome appearance changes through the project runtime', async () => {
    const shell = new BrowserShell({
      projectAppearance: createProjectAppearanceRuntime(),
    });
    const subject = shell as unknown as BrowserShellHarness & {
      window: {
        setBackgroundColor: ReturnType<typeof vi.fn>;
        isDestroyed: () => boolean;
      } | null;
    };

    subject.window = {
      contentView: {
        addChildView: vi.fn(),
        removeChildView: vi.fn(),
      },
      setBackgroundColor: vi.fn(),
      isDestroyed: () => false,
    };

    const state = await shell.executeChromeAppearanceCommand({
      action: 'set',
      chromeColor: '#112233',
    });

    expect(state.chromeColor).toBe('#112233');
    expect(subject.window?.setBackgroundColor).toHaveBeenCalledWith('#112233');
  });

  it('switches the selected project folder through the chrome appearance command', async () => {
    vi.mocked(dialog.showOpenDialog).mockResolvedValueOnce({
      canceled: false,
      filePaths: ['/tmp/client-project'],
    });

    const shell = new BrowserShell({
      projectAppearance: createProjectAppearanceRuntime(),
    });
    const subject = shell as unknown as BrowserShellHarness & {
      window: {
        contentView: {
          addChildView: ReturnType<typeof vi.fn>;
          removeChildView: ReturnType<typeof vi.fn>;
        };
        setBackgroundColor: ReturnType<typeof vi.fn>;
        isDestroyed: () => boolean;
        focus: ReturnType<typeof vi.fn>;
      } | null;
    };

    subject.window = {
      contentView: {
        addChildView: vi.fn(),
        removeChildView: vi.fn(),
      },
      setBackgroundColor: vi.fn(),
      isDestroyed: () => false,
      focus: vi.fn(),
    };

    const state = await shell.executeChromeAppearanceCommand({
      action: 'selectProject',
    });

    expect(state.projectRoot).toBe('/tmp/client-project');
    expect(state.configPath).toBe('/tmp/client-project/.loop-browser.json');
  });
});
