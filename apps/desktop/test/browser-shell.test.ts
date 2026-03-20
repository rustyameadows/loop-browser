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
  createEmptyPickerState,
  createEmptyProjectAgentLoginState,
  createEmptyStyleViewState,
  PAGE_PICKER_EVENT_CHANNEL,
  type ElementDescriptor,
  type StyleInspectionPayload,
} from '@agent-browser/protocol';
import { app, dialog, ipcMain, nativeImage } from 'electron';

const createMockNativeImage = (width = 1, height = 1) => ({
  isEmpty: () => false,
  toJPEG: () => Buffer.from('jpeg'),
  toPNG: () => Buffer.from('png'),
  getSize: () => ({ width, height }),
  getScaleFactors: () => [1],
});

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
    focus: vi.fn(),
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
    createFromBitmap: vi.fn(() => createMockNativeImage()),
    createFromBuffer: vi.fn(() => createMockNativeImage()),
    createFromDataURL: vi.fn(() => createMockNativeImage()),
  },
}));

import { BrowserShell } from '../src/main/browser-shell';

const tempDirs: string[] = [];

const createFakePanelView = () => {
  const debuggerSession = {
    isAttached: vi.fn(() => false),
    attach: vi.fn(),
    detach: vi.fn(),
    sendCommand: vi.fn(async (command: string) => {
      if (command === 'Page.getLayoutMetrics') {
        return {
          cssContentSize: {
            width: 1280,
            height: 2400,
          },
        };
      }

      if (command === 'Page.captureScreenshot') {
        return {
          data: Buffer.from(
            'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wn8pJkAAAAASUVORK5CYII=',
            'base64',
          ).toString('base64'),
        };
      }

      return {};
    }),
  };

  return {
    setBounds: vi.fn(),
    getBounds: () => ({ x: 0, y: 152, width: 1280, height: 720 }),
    webContents: {
      id: Math.floor(Math.random() * 1000) + 1,
      isDestroyed: () => false,
      loadURL: vi.fn(async () => undefined),
      reload: vi.fn(),
      stop: vi.fn(),
      send: vi.fn(),
      getURL: () => 'https://example.com',
      getTitle: () => 'Example Domain',
      isLoading: () => false,
      capturePage: vi.fn(async () => nativeImage.createFromBuffer(Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wn8pJkAAAAASUVORK5CYII=',
        'base64',
      ))),
      executeJavaScript: vi.fn(async () => ({})),
      debugger: debuggerSession,
      navigationHistory: {
        canGoBack: () => false,
        canGoForward: () => false,
      },
    },
  };
};

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
      defaultUrl?: string;
      agentLoginUsernameEnv?: string;
      agentLoginPasswordEnv?: string;
    }) => {
      state = {
        ...state,
        chromeColor: update.chromeColor ?? state.chromeColor,
        accentColor: update.accentColor ?? state.accentColor,
        defaultUrl: update.defaultUrl ?? state.defaultUrl,
        agentLoginUsernameEnv:
          update.agentLoginUsernameEnv ?? state.agentLoginUsernameEnv,
        agentLoginPasswordEnv:
          update.agentLoginPasswordEnv ?? state.agentLoginPasswordEnv,
        agentLoginUsernameResolved: Boolean(
          (update.agentLoginUsernameEnv ?? state.agentLoginUsernameEnv) &&
            process.env[update.agentLoginUsernameEnv ?? state.agentLoginUsernameEnv]?.trim(),
        ),
        agentLoginPasswordResolved: Boolean(
          (update.agentLoginPasswordEnv ?? state.agentLoginPasswordEnv) &&
            process.env[update.agentLoginPasswordEnv ?? state.agentLoginPasswordEnv]?.trim(),
        ),
        agentLoginReady: Boolean(
          (update.agentLoginUsernameEnv ?? state.agentLoginUsernameEnv) &&
            (update.agentLoginPasswordEnv ?? state.agentLoginPasswordEnv) &&
            process.env[update.agentLoginUsernameEnv ?? state.agentLoginUsernameEnv]?.trim() &&
            process.env[update.agentLoginPasswordEnv ?? state.agentLoginPasswordEnv]?.trim(),
        ),
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
  sendFeedbackState: ReturnType<typeof vi.fn>;
  sendMarkdownViewState: ReturnType<typeof vi.fn>;
  sendMcpViewState: ReturnType<typeof vi.fn>;
  sendStyleViewState: ReturnType<typeof vi.fn>;
  sendChromeAppearanceState: ReturnType<typeof vi.fn>;
  syncMcpViewState: ReturnType<typeof vi.fn>;
  refreshMarkdownView: ReturnType<typeof vi.fn>;
  ensureStylePanelMounted: ReturnType<typeof vi.fn>;
  ensureMcpPanelMounted: ReturnType<typeof vi.fn>;
  ensureMarkdownPanelMounted: ReturnType<typeof vi.fn>;
  pageView: ReturnType<typeof createFakePanelView> | null;
  feedbackState: ReturnType<typeof createEmptyFeedbackState>;
  feedbackPanelMounted: boolean;
  feedbackPanelView: ReturnType<typeof createFakePanelView> | null;
  markdownViewState: ReturnType<typeof createEmptyMarkdownViewState>;
  markdownPanelMounted: boolean;
  markdownPanelView: ReturnType<typeof createFakePanelView> | null;
  mcpViewState: ReturnType<typeof createEmptyMcpViewState>;
  mcpPanelMounted: boolean;
  mcpPanelView: ReturnType<typeof createFakePanelView> | null;
  styleViewState: ReturnType<typeof createEmptyStyleViewState>;
  stylePanelMounted: boolean;
  stylePanelView: ReturnType<typeof createFakePanelView> | null;
  chromeAppearanceState: ReturnType<typeof createEmptyChromeAppearanceState>;
  projectPanelMounted: boolean;
  projectPanelView: ReturnType<typeof createFakePanelView> | null;
  pickerState: ReturnType<typeof createEmptyPickerState>;
};

const createSelection = (): ElementDescriptor => ({
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
    'data-testid': 'cta',
  },
  outerHTMLExcerpt: '<button id="cta">Launch</button>',
  frame: {
    url: 'https://example.com',
    isMainFrame: true,
  },
});

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
        setupLabel: 'This window',
        setupUrl: 'http://127.0.0.1:46255/mcp',
        setupToken: '25b79a64f932e91b0a7b8ae13002eb0593a5dbfcf5ed16f3',
        setupRegistrationFile: '/tmp/mcp-registration.json',
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
          summary:
            'Health, initialize, tools/list, resources/list, resources/templates/list, and resources/read succeeded.',
          healthOk: true,
          initializeOk: true,
          toolsListOk: true,
          resourcesListOk: true,
          resourceTemplatesListOk: true,
          resourceReadOk: true,
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
        setupLabel: 'This window',
        setupUrl: 'http://127.0.0.1:46255/mcp',
        setupToken: '25b79a64',
        setupRegistrationFile: '/tmp/mcp-registration.json',
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
          resourcesListOk: true,
          resourceTemplatesListOk: true,
          resourceReadOk: true,
        },
        lastError: null,
        lastUpdatedAt: '2026-03-13T21:10:00.000Z',
      }),
    });

    const state = shell.getMcpViewState();
    expect(state.indicator).toBe('green');
    expect(state.setupTransportUrl).toBe('http://127.0.0.1:46255/mcp');
    expect(state.authToken).toBe('25b79a64f932e91b0a7b8ae13002eb0593a5dbfcf5ed16f3');
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

  it('keeps the style panel mutually exclusive with the other side panels', async () => {
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
    subject.sendFeedbackState = vi.fn();
    subject.sendMarkdownViewState = vi.fn();
    subject.sendMcpViewState = vi.fn();
    subject.sendStyleViewState = vi.fn();
    subject.sendChromeAppearanceState = vi.fn();
    subject.ensureStylePanelMounted = vi.fn(() => {
      subject.stylePanelMounted = true;
      subject.stylePanelView = createFakePanelView();
    });

    subject.feedbackState = {
      ...createEmptyFeedbackState(),
      isOpen: true,
    };
    subject.feedbackPanelMounted = true;
    subject.feedbackPanelView = createFakePanelView();
    subject.markdownViewState = {
      ...createEmptyMarkdownViewState(),
      isOpen: true,
    };
    subject.markdownPanelMounted = true;
    subject.markdownPanelView = createFakePanelView();
    subject.mcpViewState = {
      ...createEmptyMcpViewState(),
      isOpen: true,
    };
    subject.mcpPanelMounted = true;
    subject.mcpPanelView = createFakePanelView();
    subject.chromeAppearanceState = {
      ...createEmptyChromeAppearanceState(),
      projectRoot: '/tmp/project',
      configPath: '/tmp/project/.loop-browser.json',
      isOpen: true,
    };
    subject.projectPanelMounted = true;
    subject.projectPanelView = createFakePanelView();

    await shell.executeStyleViewCommand({ action: 'open' });

    expect(shell.getStyleViewState().isOpen).toBe(true);
    expect(shell.getFeedbackState().isOpen).toBe(false);
    expect(shell.getMarkdownViewState().isOpen).toBe(false);
    expect(shell.getMcpViewState().isOpen).toBe(false);
    expect(shell.getChromeAppearanceState().isOpen).toBe(false);
  });

  it('routes style picker selections into style inspection instead of feedback draft creation', () => {
    const shell = new BrowserShell({
      projectAppearance: createProjectAppearanceRuntime(),
    });
    const subject = shell as unknown as BrowserShellHarness & {
      startStyleInspection: ReturnType<typeof vi.fn>;
      executeFeedbackCommand: ReturnType<typeof vi.fn>;
    };
    const pageView = createFakePanelView();
    const selection = createSelection();

    subject.pageView = pageView;
    subject.startStyleInspection = vi.fn(async () => createEmptyStyleViewState());
    subject.executeFeedbackCommand = vi.fn(async () => createEmptyFeedbackState());

    const pickerListener = vi
      .mocked(ipcMain.on)
      .mock.calls.find(([channel]) => channel === PAGE_PICKER_EVENT_CHANNEL)?.[1];
    expect(pickerListener).toBeTypeOf('function');

    pickerListener?.(
      { sender: { id: pageView.webContents.id } } as Parameters<NonNullable<typeof pickerListener>>[0],
      {
        type: 'selection',
        intent: 'style',
        descriptor: selection,
      },
    );

    expect(subject.startStyleInspection).toHaveBeenCalledWith(selection);
    expect(subject.executeFeedbackCommand).not.toHaveBeenCalled();
    expect(shell.getPickerState()).toEqual({
      enabled: false,
      intent: 'style',
      lastSelection: selection,
    });
  });

  it('upserts a single style annotation as overrides accumulate on the same element', async () => {
    const shell = new BrowserShell({
      projectAppearance: createProjectAppearanceRuntime(),
    });
    const subject = shell as unknown as BrowserShellHarness & {
      requestPageStyleInspection: ReturnType<typeof vi.fn>;
    };
    const selection = createSelection();
    const pageView = createFakePanelView();

    subject.pageView = pageView;
    subject.sendStyleViewState = vi.fn();
    subject.sendFeedbackState = vi.fn();
    subject.styleViewState = {
      ...createEmptyStyleViewState(),
      isOpen: true,
      status: 'ready',
      selection,
      computedValues: {
        color: 'rgb(0, 0, 0)',
        'background-color': 'rgb(255, 255, 255)',
      },
      overrideDeclarations: {},
    };
    subject.requestPageStyleInspection = vi.fn(
      async (
        command: { action: 'inspect'; selection: ElementDescriptor; declarations: Record<string, string> },
      ): Promise<StyleInspectionPayload> => ({
        selection: command.selection,
        matchedRules: [],
        computedValues: {
          color: command.declarations.color ?? 'rgb(0, 0, 0)',
          'background-color':
            command.declarations['background-color'] ?? 'rgb(255, 255, 255)',
        },
        unreadableStylesheetCount: 0,
        unreadableStylesheetWarning: null,
        overrideDeclarations: command.declarations,
        previewStatus: Object.keys(command.declarations).length > 0 ? 'applied' : 'idle',
        lastError: null,
      }),
    );

    await shell.executeStyleViewCommand({
      action: 'setOverrideDeclaration',
      property: 'color',
      value: '#ffffff',
    });

    const firstAnnotationId = shell.getFeedbackState().annotations[0]?.id;
    expect(firstAnnotationId).toBeTruthy();
    expect(shell.getFeedbackState().annotations).toHaveLength(1);
    expect(shell.getFeedbackState().annotations[0]).toMatchObject({
      intent: 'style',
      status: 'open',
      styleTweaks: [
        {
          property: 'color',
          value: '#ffffff',
        },
      ],
    });

    await shell.executeStyleViewCommand({
      action: 'setOverrideDeclaration',
      property: 'background-color',
      value: '#000000',
    });

    const annotation = shell.getFeedbackState().annotations[0];
    expect(shell.getFeedbackState().annotations).toHaveLength(1);
    expect(annotation?.id).toBe(firstAnnotationId);
    expect(annotation?.styleTweaks.map(({ property, value }) => [property, value])).toEqual([
      ['background-color', '#000000'],
      ['color', '#ffffff'],
    ]);
    expect(annotation?.note).toContain('Current overrides:');
    expect(annotation?.note).toContain('- background-color: #000000');
    expect(annotation?.note).toContain('- color: #ffffff');
  });

  it('resets style preview state on navigation while preserving the open panel and linked annotation', () => {
    const shell = new BrowserShell({
      projectAppearance: createProjectAppearanceRuntime(),
    });
    const subject = shell as unknown as BrowserShellHarness & {
      resetPickerOnNavigation: () => void;
      sendPickerState: ReturnType<typeof vi.fn>;
    };
    const selection = createSelection();
    const pageView = createFakePanelView();

    subject.pageView = pageView;
    subject.sendPickerState = vi.fn();
    subject.sendFeedbackState = vi.fn();
    subject.sendStyleViewState = vi.fn();
    subject.pickerState = {
      enabled: true,
      intent: 'style',
      lastSelection: selection,
    };
    subject.feedbackState = {
      ...createEmptyFeedbackState(),
      draft: {
        ...createEmptyFeedbackState().draft,
        selection,
        summary: 'Draft summary',
        sourceUrl: 'https://example.com',
        sourceTitle: 'Example Domain',
      },
    };
    subject.styleViewState = {
      ...createEmptyStyleViewState(),
      isOpen: true,
      status: 'ready',
      selection,
      computedValues: {
        color: 'rgb(0, 0, 0)',
      },
      overrideDeclarations: {
        color: '#ffffff',
      },
      previewStatus: 'applied',
      linkedAnnotationId: 'annotation-style-1',
    };

    subject.resetPickerOnNavigation();

    expect(pageView.webContents.send).toHaveBeenCalledWith('page-picker:control', {
      action: 'disable',
    });
    expect(shell.getPickerState()).toEqual(createEmptyPickerState());
    expect(shell.getFeedbackState().draft.selection).toBeNull();
    expect(shell.getStyleViewState()).toMatchObject({
      isOpen: true,
      status: 'idle',
      selection: null,
      overrideDeclarations: {},
      previewStatus: 'idle',
      linkedAnnotationId: 'annotation-style-1',
    });
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
          intent: 'feedback',
          styleTweaks: [],
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

  it('loads the saved project default URL when no explicit startup override is provided', async () => {
    const projectAppearance = {
      getState: () => ({
        ...createEmptyChromeAppearanceState(),
        projectRoot: '/tmp/project',
        configPath: '/tmp/project/.loop-browser.json',
        defaultUrl: 'http://127.0.0.1:3000/',
      }),
      subscribe: () => () => undefined,
      selectProject: async () => createEmptyChromeAppearanceState(),
      setAppearance: async () => createEmptyChromeAppearanceState(),
      resetAppearance: async () => createEmptyChromeAppearanceState(),
      dispose: () => undefined,
    };
    const shell = new BrowserShell({
      projectAppearance,
    });
    const subject = shell as unknown as BrowserShellHarness & {
      loadInitialPage(): Promise<void>;
    };

    subject.pageView = createFakePanelView();

    await subject.loadInitialPage();

    expect(subject.pageView.webContents.loadURL).toHaveBeenCalledWith('http://127.0.0.1:3000/');
  });

  it('scrolls the page to a selector and returns scroll state', async () => {
    const shell = new BrowserShell({
      projectAppearance: createProjectAppearanceRuntime(),
    });
    const subject = shell as unknown as BrowserShellHarness;

    subject.pageView = createFakePanelView();
    subject.pageView.webContents.executeJavaScript = vi.fn(async () => ({
      ok: true,
      result: {
        scrollX: 0,
        scrollY: 920,
        maxScrollX: 0,
        maxScrollY: 2800,
        url: 'https://example.com/deadlines',
      },
    }));

    const result = await shell.scrollPage({
      selector: '.ph-deadlines-secondary-grid',
      block: 'center',
    });

    expect(result).toEqual({
      scrollX: 0,
      scrollY: 920,
      maxScrollX: 0,
      maxScrollY: 2800,
      url: 'https://example.com/deadlines',
    });
    expect(subject.pageView.webContents.executeJavaScript).toHaveBeenCalledTimes(1);
  });

  it('auto-scrolls below-the-fold elements before capturing an element screenshot', async () => {
    const shell = new BrowserShell({
      projectAppearance: createProjectAppearanceRuntime(),
    });
    const subject = shell as unknown as BrowserShellHarness;

    subject.pageView = createFakePanelView();
    subject.pageView.webContents.executeJavaScript = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        result: {
          scrollX: 0,
          scrollY: 1200,
          maxScrollX: 0,
          maxScrollY: 2800,
          url: 'https://example.com/deadlines',
        },
      })
      .mockResolvedValueOnce({
        ok: true,
        box: {
          viewportX: 24,
          viewportY: 620,
          pageX: 24,
          pageY: 1820,
          width: 420,
          height: 260,
          devicePixelRatio: 2,
          viewportWidth: 1280,
          viewportHeight: 720,
          scrollX: 0,
          scrollY: 1200,
        },
      });

    const sendCommand = subject.pageView.webContents.debugger.sendCommand as ReturnType<typeof vi.fn>;
    sendCommand.mockImplementation(async (command: string, payload?: Record<string, unknown>) => {
      if (command === 'Page.captureScreenshot') {
        expect(payload).toMatchObject({
          clip: {
            x: 24,
            y: 1820,
            width: 420,
            height: 260,
            scale: 1,
          },
          captureBeyondViewport: true,
        });
        return {
          data: Buffer.from(
            'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wn8pJkAAAAASUVORK5CYII=',
            'base64',
          ).toString('base64'),
        };
      }

      return {};
    });

    const screenshot = await shell.captureScreenshot({
      target: 'element',
      selector: '.ph-deadlines-secondary-grid',
    });

    expect(subject.pageView.webContents.executeJavaScript).toHaveBeenCalledTimes(2);
    expect(screenshot.target).toBe('element');
    expect(sendCommand).toHaveBeenCalledWith('Page.enable');
    expect(sendCommand).toHaveBeenCalledWith(
      'Page.captureScreenshot',
      expect.objectContaining({
        captureBeyondViewport: true,
      }),
    );
  });

  it('captures true full-page screenshots with the debugger path', async () => {
    const shell = new BrowserShell({
      projectAppearance: createProjectAppearanceRuntime(),
    });
    const subject = shell as unknown as BrowserShellHarness;

    subject.pageView = createFakePanelView();
    const sendCommand = subject.pageView.webContents.debugger.sendCommand as ReturnType<typeof vi.fn>;
    sendCommand.mockImplementation(async (command: string, payload?: Record<string, unknown>) => {
      if (command === 'Page.getLayoutMetrics') {
        return {
          cssContentSize: {
            width: 1280,
            height: 3200,
          },
        };
      }

      if (command === 'Page.captureScreenshot') {
        expect(payload).toMatchObject({
          captureBeyondViewport: true,
          clip: {
            x: 0,
            y: 0,
            width: 1280,
            height: 3200,
            scale: 1,
          },
        });
        return {
          data: Buffer.from(
            'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wn8pJkAAAAASUVORK5CYII=',
            'base64',
          ).toString('base64'),
        };
      }

      return {};
    });

    const screenshot = await shell.captureScreenshot({
      target: 'page',
      fullPage: true,
      fileNameHint: 'deadlines-full',
    });

    expect(screenshot.target).toBe('page');
    expect(screenshot.fileNameHint).toBe('deadlines-full');
    expect(sendCommand).toHaveBeenCalledWith('Page.getLayoutMetrics');
    expect(sendCommand).toHaveBeenCalledWith(
      'Page.captureScreenshot',
      expect.objectContaining({
        captureBeyondViewport: true,
      }),
    );
  });

  it('exposes Use Agent Login CTA state on matching login pages', () => {
    const previousUsername = process.env.LOOP_AGENT_LOGIN_USERNAME;
    const previousPassword = process.env.LOOP_AGENT_LOGIN_PASSWORD;
    process.env.LOOP_AGENT_LOGIN_USERNAME = 'agent@example.com';
    process.env.LOOP_AGENT_LOGIN_PASSWORD = 'password123';

    try {
      const projectAppearance = {
        getState: () => ({
          ...createEmptyChromeAppearanceState(),
          projectRoot: '/tmp/project',
          configPath: '/tmp/project/.loop-browser.json',
          defaultUrl: 'http://127.0.0.1:3000/',
          agentLoginUsernameEnv: 'LOOP_AGENT_LOGIN_USERNAME',
          agentLoginPasswordEnv: 'LOOP_AGENT_LOGIN_PASSWORD',
          agentLoginUsernameResolved: true,
          agentLoginPasswordResolved: true,
          agentLoginReady: true,
        }),
        subscribe: () => () => undefined,
        selectProject: async () => createEmptyChromeAppearanceState(),
        setAppearance: async () => createEmptyChromeAppearanceState(),
        resetAppearance: async () => createEmptyChromeAppearanceState(),
        dispose: () => undefined,
      };
      const shell = new BrowserShell({
        projectAppearance,
      });
      const subject = shell as unknown as BrowserShellHarness & {
        hasVisibleLoginForm: boolean;
      };

      subject.pageView = createFakePanelView();
      subject.pageView.webContents.getURL = () => 'http://127.0.0.1:3000/login';
      subject.hasVisibleLoginForm = true;

      expect(shell.getNavigationState().agentLoginCta).toEqual({
        visible: true,
        enabled: true,
        reason: null,
      });
    } finally {
      if (previousUsername === undefined) {
        delete process.env.LOOP_AGENT_LOGIN_USERNAME;
      } else {
        process.env.LOOP_AGENT_LOGIN_USERNAME = previousUsername;
      }

      if (previousPassword === undefined) {
        delete process.env.LOOP_AGENT_LOGIN_PASSWORD;
      } else {
        process.env.LOOP_AGENT_LOGIN_PASSWORD = previousPassword;
      }
    }
  });

  it('routes Use Agent Login into the page preload fill command', async () => {
    const previousUsername = process.env.LOOP_AGENT_LOGIN_USERNAME;
    const previousPassword = process.env.LOOP_AGENT_LOGIN_PASSWORD;
    process.env.LOOP_AGENT_LOGIN_USERNAME = 'agent@example.com';
    process.env.LOOP_AGENT_LOGIN_PASSWORD = 'password123';

    try {
      const projectAppearance = {
        getState: () => ({
          ...createEmptyChromeAppearanceState(),
          projectRoot: '/tmp/project',
          configPath: '/tmp/project/.loop-browser.json',
          defaultUrl: 'http://127.0.0.1:3000/',
          agentLoginUsernameEnv: 'LOOP_AGENT_LOGIN_USERNAME',
          agentLoginPasswordEnv: 'LOOP_AGENT_LOGIN_PASSWORD',
          agentLoginUsernameResolved: true,
          agentLoginPasswordResolved: true,
          agentLoginReady: true,
        }),
        subscribe: () => () => undefined,
        selectProject: async () => createEmptyChromeAppearanceState(),
        setAppearance: async () => createEmptyChromeAppearanceState(),
        resetAppearance: async () => createEmptyChromeAppearanceState(),
        dispose: () => undefined,
      };
      const shell = new BrowserShell({
        projectAppearance,
      });
      const subject = shell as unknown as BrowserShellHarness & {
        hasVisibleLoginForm: boolean;
      };

      subject.pageView = createFakePanelView();
      subject.pageView.webContents.getURL = () => 'http://127.0.0.1:3000/login';
      subject.hasVisibleLoginForm = true;

      await shell.executeNavigationCommand({ action: 'useAgentLogin' });

      expect(subject.pageView.webContents.send).toHaveBeenCalledWith('page-login:control', {
        action: 'fill',
        username: 'agent@example.com',
        password: 'password123',
      });
    } finally {
      if (previousUsername === undefined) {
        delete process.env.LOOP_AGENT_LOGIN_USERNAME;
      } else {
        process.env.LOOP_AGENT_LOGIN_USERNAME = previousUsername;
      }

      if (previousPassword === undefined) {
        delete process.env.LOOP_AGENT_LOGIN_PASSWORD;
      } else {
        process.env.LOOP_AGENT_LOGIN_PASSWORD = previousPassword;
      }
    }
  });

  it('prefers repo-local saved login over the legacy env fallback', async () => {
    const previousUsername = process.env.LOOP_AGENT_LOGIN_USERNAME;
    const previousPassword = process.env.LOOP_AGENT_LOGIN_PASSWORD;
    process.env.LOOP_AGENT_LOGIN_USERNAME = 'env@example.com';
    process.env.LOOP_AGENT_LOGIN_PASSWORD = 'env-password';

    try {
      const projectAppearance = {
        getState: () => ({
          ...createEmptyChromeAppearanceState(),
          projectRoot: '/tmp/project',
          configPath: '/tmp/project/.loop-browser.json',
          defaultUrl: 'http://127.0.0.1:3000/',
          agentLoginUsernameEnv: 'LOOP_AGENT_LOGIN_USERNAME',
          agentLoginPasswordEnv: 'LOOP_AGENT_LOGIN_PASSWORD',
          agentLoginUsernameResolved: true,
          agentLoginPasswordResolved: true,
          agentLoginReady: true,
        }),
        subscribe: () => () => undefined,
        selectProject: async () => createEmptyChromeAppearanceState(),
        setAppearance: async () => createEmptyChromeAppearanceState(),
        resetAppearance: async () => createEmptyChromeAppearanceState(),
        dispose: () => undefined,
      };
      const projectAgentLogin = {
        getState: () => ({
          ...createEmptyProjectAgentLoginState(),
          projectRoot: '/tmp/project',
          filePath: '/tmp/project/.loop-browser.local.json',
          username: 'repo@example.com',
          hasPassword: true,
          isGitIgnored: true,
          source: 'local-file' as const,
        }),
        subscribe: () => () => undefined,
        selectProject: async () => createEmptyProjectAgentLoginState(),
        saveLogin: async () => createEmptyProjectAgentLoginState(),
        clearLogin: async () => createEmptyProjectAgentLoginState(),
        resolveLocalCredentials: () => ({
          username: 'repo@example.com',
          password: 'repo-password',
        }),
        dispose: () => undefined,
      };
      const shell = new BrowserShell({
        projectAppearance,
        projectAgentLogin,
      });
      const subject = shell as unknown as BrowserShellHarness & {
        hasVisibleLoginForm: boolean;
      };

      subject.pageView = createFakePanelView();
      subject.pageView.webContents.getURL = () => 'http://127.0.0.1:3000/login';
      subject.hasVisibleLoginForm = true;

      await shell.executeNavigationCommand({ action: 'useAgentLogin' });

      expect(shell.getProjectAgentLoginState().source).toBe('local-file');
      expect(subject.pageView.webContents.send).toHaveBeenCalledWith('page-login:control', {
        action: 'fill',
        username: 'repo@example.com',
        password: 'repo-password',
      });
    } finally {
      if (previousUsername === undefined) {
        delete process.env.LOOP_AGENT_LOGIN_USERNAME;
      } else {
        process.env.LOOP_AGENT_LOGIN_USERNAME = previousUsername;
      }

      if (previousPassword === undefined) {
        delete process.env.LOOP_AGENT_LOGIN_PASSWORD;
      } else {
        process.env.LOOP_AGENT_LOGIN_PASSWORD = previousPassword;
      }
    }
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
