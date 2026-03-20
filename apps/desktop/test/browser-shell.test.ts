import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createEmptyChromeAppearanceState,
  createEmptyFeedbackState,
  createEmptyMarkdownViewState,
  createEmptyMcpViewState,
} from '@agent-browser/protocol';
import { app, dialog, nativeImage } from 'electron';

vi.mock('node:child_process', () => ({
  execFile: vi.fn((command: string, args: string[], callback: (error: Error | null) => void) => {
    if (command === 'qlmanage') {
      const outputDirectory = args[args.indexOf('-o') + 1];
      const sourcePath = args[args.length - 1];
      fs.writeFileSync(
        path.join(outputDirectory, `${path.basename(sourcePath)}.png`),
        Buffer.from(
          'iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAIAAAAlC+aJAAAAWUlEQVR4nO3PQQ0AIBDAMMC/58MCP7KkVbDX1pk5A6QNaA3QGqA1QGuA1gCtAVoDtAZoDdAaoDVAb+BkYGBgYGBgYGBgYGBgYGBgYGBgYGBgYJgBQ7UCP6xF9WAAAAAASUVORK5CYII=',
          'base64',
        ),
      );
    }

    callback(null);
  }),
}));

vi.mock('electron', () => ({
  BaseWindow: class {},
  WebContentsView: class {},
  app: {
    dock: {
      hide: vi.fn(),
      setIcon: vi.fn(),
      show: vi.fn(),
    },
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
    createFromBitmap: vi.fn(() => ({
      isEmpty: () => false,
    })),
    createFromBuffer: vi.fn(() => ({
      isEmpty: () => false,
    })),
    createFromDataURL: vi.fn(() => ({
      isEmpty: () => false,
    })),
  },
}));

import { BrowserShell } from '../src/main/browser-shell';

const tempDirs: string[] = [];

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
        resolvedProjectIconPath:
          update.projectIconPath === undefined
            ? state.resolvedProjectIconPath
            : update.projectIconPath
              ? path.join('/tmp/project', update.projectIconPath.replace(/^\.\//, ''))
              : null,
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

  afterEach(async () => {
    await Promise.all(
      tempDirs.splice(0).map(async (directory) => {
        await rm(directory, { recursive: true, force: true });
      }),
    );
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

  it('returns a project-relative icon path from the native icon picker', async () => {
    vi.mocked(dialog.showOpenDialog).mockResolvedValueOnce({
      canceled: false,
      filePaths: ['/tmp/project/assets/icon.png'],
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
        focus: ReturnType<typeof vi.fn>;
      } | null;
    };

    subject.window = {
      contentView: {
        addChildView: vi.fn(),
        removeChildView: vi.fn(),
      },
      focus: vi.fn(),
    };

    await expect(shell.browseProjectIcon()).resolves.toBe('./assets/icon.png');
  });

  it('rejects icon files outside the selected project folder', async () => {
    vi.mocked(dialog.showOpenDialog).mockResolvedValueOnce({
      canceled: false,
      filePaths: ['/tmp/other/icon.png'],
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
        focus: ReturnType<typeof vi.fn>;
      } | null;
    };

    subject.window = {
      contentView: {
        addChildView: vi.fn(),
        removeChildView: vi.fn(),
      },
      focus: vi.fn(),
    };

    await expect(shell.browseProjectIcon()).rejects.toThrow(
      'Selected icon must be inside the current project folder.',
    );
  });

  it('updates the macOS dock icon when a saved project icon exists', async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), 'loop-browser-browser-shell-'));
    tempDirs.push(tempDir);

    const projectRoot = tempDir;
    const projectIconPath = path.join(projectRoot, 'red-square.svg');
    await writeFile(
      projectIconPath,
      '<svg width="512" height="512" xmlns="http://www.w3.org/2000/svg"><rect width="512" height="512" fill="red"/></svg>',
      'utf8',
    );

    let state = {
      ...createEmptyChromeAppearanceState(),
      projectRoot,
      configPath: path.join(projectRoot, '.loop-browser.json'),
      chromeColor: '#FF0ADE',
    };
    const listeners = new Set<(nextState: typeof state) => void>();
    const projectAppearance = {
      getState: () => state,
      subscribe: (listener: (nextState: typeof state) => void) => {
        listeners.add(listener);
        return () => {
          listeners.delete(listener);
        };
      },
      selectProject: async () => state,
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
          resolvedProjectIconPath:
            update.projectIconPath === undefined
              ? state.resolvedProjectIconPath
              : update.projectIconPath
                ? path.join(projectRoot, update.projectIconPath.replace(/^\.\//, ''))
                : null,
        };
        for (const listener of listeners) {
          listener(state);
        }
        return state;
      },
      resetAppearance: async () => state,
      dispose: () => undefined,
    };

    const shell = new BrowserShell({
      projectAppearance,
      dockIconTemplatePath: path.resolve('apps/desktop/static/dock-icon-template.svg'),
    });
    const subject = shell as unknown as BrowserShellHarness & {
      window: {
        contentView: {
          addChildView: ReturnType<typeof vi.fn>;
          removeChildView: ReturnType<typeof vi.fn>;
        };
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

    await shell.executeChromeAppearanceCommand({
      action: 'set',
      projectIconPath: './red-square.svg',
    });

    await vi.waitFor(() => {
      expect(app.dock?.setIcon).toHaveBeenCalled();
    });
  });

  it('hides the launcher dock icon while project sessions are open', () => {
    const listeners = new Set<(state: {
      role: 'launcher';
      sessions: Array<{
        sessionId: string;
        projectRoot: string;
        projectName: string;
        chromeColor: string;
        projectIconPath: string;
        isFocused: boolean;
        isHome: boolean;
        dockIconStatus: 'idle' | 'applied' | 'failed';
        status: 'launching' | 'ready' | 'closing' | 'closed' | 'error';
      }>;
      currentSessionId: string | null;
      lastError: string | null;
    }) => void>();
    const sessionRuntime = {
      getState: () => ({
        role: 'launcher' as const,
        sessions: [],
        currentSessionId: null,
        lastError: null,
      }),
      subscribe: (
        listener: (state: {
          role: 'launcher';
          sessions: Array<{
            sessionId: string;
            projectRoot: string;
            projectName: string;
            chromeColor: string;
            projectIconPath: string;
            isFocused: boolean;
            isHome: boolean;
            dockIconStatus: 'idle' | 'applied' | 'failed';
            status: 'launching' | 'ready' | 'closing' | 'closed' | 'error';
          }>;
          currentSessionId: string | null;
          lastError: string | null;
        }) => void,
      ) => {
        listeners.add(listener);
        return () => {
          listeners.delete(listener);
        };
      },
      executeCommand: async () => ({
        role: 'launcher' as const,
        sessions: [],
        currentSessionId: null,
        lastError: null,
      }),
    };

    new BrowserShell({
      projectAppearance: createProjectAppearanceRuntime(),
      sessionRuntime,
      role: 'launcher',
    });

    expect(app.dock?.show).toHaveBeenCalled();

    for (const listener of listeners) {
      listener({
        role: 'launcher',
        sessions: [
          {
            sessionId: 'project-1',
            projectRoot: '/tmp/project-1',
            projectName: 'Project 1',
            chromeColor: '#F297E7',
            projectIconPath: './icon.svg',
            isFocused: true,
            isHome: false,
            dockIconStatus: 'applied',
            status: 'ready',
          },
        ],
        currentSessionId: 'project-1',
        lastError: null,
      });
    }

    expect(app.dock?.hide).toHaveBeenCalled();

    for (const listener of listeners) {
      listener({
        role: 'launcher',
        sessions: [],
        currentSessionId: null,
        lastError: null,
      });
    }

    expect(app.dock?.show).toHaveBeenCalledTimes(2);
  });

  it('surfaces a dock icon error when Electron creates an empty dock image', async () => {
    vi.mocked(nativeImage.createFromDataURL).mockReturnValue({
      isEmpty: () => true,
    } as ReturnType<typeof nativeImage.createFromDataURL>);

    const shell = new BrowserShell({
      projectAppearance: createProjectAppearanceRuntime(),
      dockIconTemplatePath: path.resolve('apps/desktop/static/dock-icon-template.svg'),
    });

    await shell.executeChromeAppearanceCommand({
      action: 'set',
      projectIconPath: './project-icon.svg',
    });

    await vi.waitFor(() => {
      expect(shell.getChromeAppearanceState().dockIconStatus).toBe('failed');
    });

    const state = shell.getChromeAppearanceState();
    expect(state.dockIconSource).toBe('projectIcon');
    expect(state.dockIconLastError).toContain('Could not compose project dock icon');
    expect(state.lastError).toContain('Could not compose project dock icon');
  });
});
