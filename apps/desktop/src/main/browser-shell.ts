import path from 'node:path';
import { randomUUID } from 'node:crypto';
import {
  BaseWindow,
  WebContentsView,
  type IpcMainEvent,
  type IpcMainInvokeEvent,
  type WebContents,
  app,
  desktopCapturer,
  dialog,
  ipcMain,
  nativeImage,
  screen,
  shell,
} from 'electron';
import {
  CHROME_APPEARANCE_BROWSE_ICON_CHANNEL,
  CHROME_APPEARANCE_COMMAND_CHANNEL,
  CHROME_APPEARANCE_GET_STATE_CHANNEL,
  CHROME_APPEARANCE_STATE_CHANNEL,
  FEEDBACK_COMMAND_CHANNEL,
  FEEDBACK_GET_STATE_CHANNEL,
  FEEDBACK_STATE_CHANNEL,
  createEmptyChromeAppearanceState,
  type ResizeWindowRequest,
  type ScreenshotFormat,
  type ScreenshotRequest,
  type ScreenshotTarget,
  type WindowState,
  MCP_VIEW_COMMAND_CHANNEL,
  MCP_VIEW_GET_STATE_CHANNEL,
  MCP_VIEW_STATE_CHANNEL,
  MARKDOWN_VIEW_COMMAND_CHANNEL,
  MARKDOWN_VIEW_GET_STATE_CHANNEL,
  MARKDOWN_VIEW_STATE_CHANNEL,
  NAVIGATION_COMMAND_CHANNEL,
  NAVIGATION_GET_STATE_CHANNEL,
  NAVIGATION_STATE_CHANNEL,
  PAGE_LOGIN_CONTROL_CHANNEL,
  PAGE_LOGIN_EVENT_CHANNEL,
  PAGE_AGENT_OVERLAY_CHANNEL,
  PAGE_PICKER_CONTROL_CHANNEL,
  PAGE_PICKER_EVENT_CHANNEL,
  PAGE_STYLE_CONTROL_CHANNEL,
  PAGE_STYLE_EVENT_CHANNEL,
  PICKER_COMMAND_CHANNEL,
  PICKER_GET_STATE_CHANNEL,
  PICKER_STATE_CHANNEL,
  PROJECT_AGENT_LOGIN_CLEAR_CHANNEL,
  PROJECT_AGENT_LOGIN_GET_STATE_CHANNEL,
  PROJECT_AGENT_LOGIN_SAVE_CHANNEL,
  PROJECT_AGENT_LOGIN_STATE_CHANNEL,
  SESSION_COMMAND_CHANNEL,
  SESSION_GET_STATE_CHANNEL,
  SESSION_STATE_CHANNEL,
  STYLE_VIEW_COMMAND_CHANNEL,
  STYLE_VIEW_GET_STATE_CHANNEL,
  STYLE_VIEW_STATE_CHANNEL,
  createEmptyProjectAgentLoginState,
  createEmptyFeedbackDraft,
  createEmptyFeedbackState,
  createEmptyMcpViewState,
  createEmptyMarkdownViewState,
  createEmptyNavigationState,
  createEmptyPickerState,
  createEmptySessionViewState,
  createEmptyStyleViewState,
  isFeedbackCommand,
  isChromeAppearanceCommand,
  isMcpViewCommand,
  isMarkdownViewCommand,
  isNavigationCommand,
  isPageStyleEvent,
  isProjectAgentLoginSaveRequest,
  isPagePickerEvent,
  isPageLoginEvent,
  normalizePanelPresentationPreference,
  panelSurfaceIds,
  isPickerCommand,
  isSessionCommand,
  isStyleViewCommand,
  type ChromeAppearanceCommand,
  type ChromeAppearanceState,
  type FeedbackAnnotation,
  type FeedbackAuthor,
  type FeedbackCommand,
  type FeedbackState,
  type McpViewCommand,
  type McpViewState,
  type MarkdownViewCommand,
  type MarkdownViewState,
  type PageScrollRequest,
  type PageScrollResult,
  type PageStyleControl,
  type PageStyleEvent,
  type StyleInspectionPayload,
  type StyleTweak,
  type StyleViewCommand,
  type StyleViewState,
  type NavigationCommand,
  type NavigationState,
  type PanelPresentationMode,
  type PanelPresentationPreference,
  type PanelSidebarSide,
  type PanelSurfaceId,
  type AgentLoginCtaState,
  type PageAgentOverlayState,
  type PickerCommand,
  type PickerState,
  type ProjectAgentLoginState,
  type SessionCommand,
  type SessionViewState,
} from '@agent-browser/protocol';
import { extractMarkdownFromHtml } from './markdown';
import { mapDiagnosticsToMcpViewState, type McpDiagnosticsSource } from './mcp-view';
import {
  composeDefaultDockIcon,
  composeProjectDockIcon,
  dockIconTemplatePath,
  resolveDefaultDockIconColor,
} from './project-dock-icon';
import {
  PROJECT_SELECTION_FILE_NAME,
  ProjectAppearanceController,
  toProjectRelativePath,
  type ProjectAppearanceRuntime,
} from './project-appearance';
import {
  ProjectAgentLoginController,
  type ProjectAgentLoginRuntime,
} from './project-agent-login';
import {
  CHROME_HEIGHT,
  SIDE_PANEL_BREAKPOINT,
  SIDE_PANEL_WIDTH,
  computeContentSizeForResize,
  getMimeTypeForFormat,
  inferPixelSizeFromScaleFactor,
  sanitizeFileNameHint,
  type ElementBox,
} from './screenshot';
import { fixtureFileUrl, isSafeExternalUrl, normalizeAddress } from './url';

export const PRIMARY_TAB_ID = 'tab-1';
const AGENT_DONE_PULSE_MS = 1600;
const LAUNCHER_WINDOW_WIDTH = 560;
const LAUNCHER_WINDOW_HEIGHT = 520;
const LAUNCHER_WINDOW_MIN_WIDTH = 420;
const LAUNCHER_WINDOW_MIN_HEIGHT = 420;
const FLOATING_PILL_MAX_WIDTH = 720;
const FLOATING_PILL_MIN_WIDTH = 360;
const FLOATING_PILL_MAX_HEIGHT = 680;
const FLOATING_PILL_MARGIN = 24;
const POPOUT_WINDOW_WIDTH = 520;
const POPOUT_WINDOW_HEIGHT = 760;
const POPOUT_WINDOW_MIN_WIDTH = 360;
const POPOUT_WINDOW_MIN_HEIGHT = 480;

const panelSurfaceLabels: Record<PanelSurfaceId, string> = {
  feedback: 'Feedback',
  style: 'Style',
  markdown: 'Markdown',
  mcp: 'MCP',
  project: 'Project Settings',
};

type TrustedSurface =
  | 'chrome'
  | 'launcher'
  | 'markdown'
  | 'mcp'
  | 'feedback'
  | 'project'
  | 'style';

type PageMarkupSnapshot = {
  html: string;
  title: string;
  url: string;
};

type FloatingPillPosition = {
  x: number;
  y: number;
};

export interface BrowserScreenshotCapture {
  target: ScreenshotTarget;
  format: ScreenshotFormat;
  mimeType: string;
  data: Buffer;
  pixelWidth: number;
  pixelHeight: number;
  fileNameHint: string;
}

export interface BrowserTabSnapshot {
  tabId: string;
  url: string;
  title: string;
  isLoading: boolean;
}

interface BrowserShellOptions {
  initialUrl?: string;
  projectAppearance?: ProjectAppearanceRuntime;
  projectAgentLogin?: ProjectAgentLoginRuntime;
  dockIconTemplatePath?: string;
  sessionRuntime?: BrowserSessionRuntime;
  role?: SessionViewState['role'];
}

interface BrowserSessionRuntime {
  getState(): SessionViewState;
  subscribe(listener: (state: SessionViewState) => void): () => void;
  executeCommand(command: SessionCommand): Promise<SessionViewState>;
}

export class BrowserShell {
  private window: BaseWindow | null = null;
  private uiView: WebContentsView | null = null;
  private pageView: WebContentsView | null = null;
  private markdownPanelView: WebContentsView | null = null;
  private mcpPanelView: WebContentsView | null = null;
  private feedbackPanelView: WebContentsView | null = null;
  private projectPanelView: WebContentsView | null = null;
  private stylePanelView: WebContentsView | null = null;
  private markdownPanelMounted = false;
  private mcpPanelMounted = false;
  private feedbackPanelMounted = false;
  private projectPanelMounted = false;
  private stylePanelMounted = false;
  private popoutWindow: BaseWindow | null = null;
  private popoutSurface: PanelSurfaceId | null = null;
  private suppressNextPopoutCloseForSurface: PanelSurfaceId | null = null;
  private readonly floatingPillPositions: Partial<Record<PanelSurfaceId, FloatingPillPosition>> =
    {};
  private lastError: string | null = null;
  private hasVisibleLoginForm = false;
  private pickerState: PickerState = createEmptyPickerState();
  private sessionState: SessionViewState = createEmptySessionViewState();
  private feedbackState: FeedbackState = createEmptyFeedbackState();
  private markdownViewState: MarkdownViewState = createEmptyMarkdownViewState();
  private mcpViewState: McpViewState = createEmptyMcpViewState();
  private styleViewState: StyleViewState = createEmptyStyleViewState();
  private chromeAppearanceState: ChromeAppearanceState = createEmptyChromeAppearanceState();
  private projectAgentLoginState: ProjectAgentLoginState =
    createEmptyProjectAgentLoginState();
  private markdownRequestId = 0;
  private readonly pendingStyleRequests = new Map<
    string,
    {
      resolve: (inspection: StyleInspectionPayload) => void;
      reject: (error: Error) => void;
    }
  >();
  private mcpDiagnosticsSource: McpDiagnosticsSource | null = null;
  private mcpDiagnosticsUnsubscribe: (() => void) | null = null;
  private readonly projectAppearance: ProjectAppearanceRuntime;
  private readonly disposeProjectAppearance: boolean;
  private readonly projectAgentLogin: ProjectAgentLoginRuntime;
  private readonly disposeProjectAgentLogin: boolean;
  private readonly projectDockTemplatePath: string;
  private readonly projectAppearanceUnsubscribe: () => void;
  private readonly projectAgentLoginUnsubscribe: () => void;
  private readonly sessionRuntime: BrowserSessionRuntime | null;
  private readonly sessionRuntimeUnsubscribe: (() => void) | null;
  private readonly role: SessionViewState['role'];
  private dockIconError: string | null = null;
  private dockIconStatus: ChromeAppearanceState['dockIconStatus'] = 'idle';
  private dockIconSource: ChromeAppearanceState['dockIconSource'] = 'chromeColor';
  private appliedDockIconKey: string | null = null;
  private launcherDockVisibility: 'shown' | 'hidden' | null = null;
  private readonly windowFocusListeners = new Set<(isFocused: boolean) => void>();

  constructor(private readonly options: BrowserShellOptions = {}) {
    this.role = options.role ?? 'project-session';
    this.projectAppearance =
      options.projectAppearance ??
      new ProjectAppearanceController(path.join(app.getPath('userData'), PROJECT_SELECTION_FILE_NAME));
    this.disposeProjectAppearance = !options.projectAppearance;
    this.projectAgentLogin =
      options.projectAgentLogin ??
      new ProjectAgentLoginController(this.projectAppearance.getState().projectRoot || null);
    this.disposeProjectAgentLogin = !options.projectAgentLogin;
    this.projectDockTemplatePath =
      options.dockIconTemplatePath ??
      dockIconTemplatePath({
        appPath: app.getAppPath(),
        isPackaged: app.isPackaged,
        resourcesPath: process.resourcesPath,
      });
    this.chromeAppearanceState = {
      ...this.mergeChromeAppearanceDiagnostics(this.projectAppearance.getState()),
      isOpen: false,
    };
    this.projectAgentLoginState = this.createProjectAgentLoginState(
      this.projectAgentLogin.getState(),
    );
    this.sessionRuntime = options.sessionRuntime ?? null;
    this.sessionState = this.sessionRuntime?.getState() ?? {
      ...createEmptySessionViewState(),
      role: this.role,
    };
    this.syncLauncherDockVisibility();
    this.registerIpcHandlers();
    this.projectAppearanceUnsubscribe = this.projectAppearance.subscribe((state) => {
      const previousProjectRoot = this.chromeAppearanceState.projectRoot;
      const previousPanelPreferences = this.chromeAppearanceState.panelPreferences;
      this.chromeAppearanceState = {
        ...this.mergeChromeAppearanceDiagnostics(state),
        isOpen: this.chromeAppearanceState.isOpen,
      };
      this.applyChromeAppearance();
      if (
        previousPanelPreferences !== this.chromeAppearanceState.panelPreferences &&
        this.getOpenPanelSurface() !== null
      ) {
        this.ensureOpenPanelHosted();
        this.layoutViews();
      }
      void this.syncDockIcon();
      this.sendChromeAppearanceState();
      if (state.projectRoot !== previousProjectRoot) {
        void this.syncProjectAgentLoginProjectRoot(state.projectRoot);
      } else {
        this.projectAgentLoginState = this.createProjectAgentLoginState(
          this.projectAgentLogin.getState(),
        );
        this.sendProjectAgentLoginState();
      }
      this.sendNavigationState();
    });
    this.projectAgentLoginUnsubscribe = this.projectAgentLogin.subscribe((state) => {
      this.projectAgentLoginState = this.createProjectAgentLoginState(state);
      this.sendProjectAgentLoginState();
      this.sendNavigationState();
    });
    this.sessionRuntimeUnsubscribe = this.sessionRuntime
      ? this.sessionRuntime.subscribe((state) => {
          this.sessionState = state;
          this.syncLauncherDockVisibility();
          this.sendSessionState();
        })
      : null;
  }

  ensureWindow(): void {
    if (this.window) {
      this.window.focus();
      return;
    }

    const isLauncherWindow = this.role === 'launcher';
    this.window = new BaseWindow({
      width: isLauncherWindow ? LAUNCHER_WINDOW_WIDTH : 1480,
      height: isLauncherWindow ? LAUNCHER_WINDOW_HEIGHT : 960,
      minWidth: isLauncherWindow ? LAUNCHER_WINDOW_MIN_WIDTH : 980,
      minHeight: isLauncherWindow ? LAUNCHER_WINDOW_MIN_HEIGHT : 720,
      title: isLauncherWindow ? 'Loop Browser Launcher' : 'Loop Browser',
      backgroundColor: this.chromeAppearanceState.chromeColor,
      titleBarStyle: 'hiddenInset',
    });

    this.uiView = this.createTrustedView(isLauncherWindow ? 'launcher' : 'chrome');

    this.window.contentView.addChildView(this.uiView);

    if (!isLauncherWindow) {
      this.pageView = new WebContentsView({
        webPreferences: {
          preload: path.join(__dirname, 'page.js'),
          contextIsolation: true,
          nodeIntegration: false,
          sandbox: true,
        },
      });
      this.window.contentView.addChildView(this.pageView);
    }

    this.attachWindowLifecycle();
    this.attachPageEvents();
    this.attachPopupPolicy();
    this.layoutViews();
    this.applyChromeAppearance();
    void this.syncDockIcon();
    if (!isLauncherWindow) {
      void this.loadInitialPage();
    }
  }

  dispose(): void {
    ipcMain.removeHandler(NAVIGATION_COMMAND_CHANNEL);
    ipcMain.removeHandler(NAVIGATION_GET_STATE_CHANNEL);
    ipcMain.removeHandler(SESSION_COMMAND_CHANNEL);
    ipcMain.removeHandler(SESSION_GET_STATE_CHANNEL);
    ipcMain.removeHandler(PICKER_COMMAND_CHANNEL);
    ipcMain.removeHandler(PICKER_GET_STATE_CHANNEL);
    ipcMain.removeHandler(MARKDOWN_VIEW_COMMAND_CHANNEL);
    ipcMain.removeHandler(MARKDOWN_VIEW_GET_STATE_CHANNEL);
    ipcMain.removeHandler(MCP_VIEW_COMMAND_CHANNEL);
    ipcMain.removeHandler(MCP_VIEW_GET_STATE_CHANNEL);
    ipcMain.removeHandler(STYLE_VIEW_COMMAND_CHANNEL);
    ipcMain.removeHandler(STYLE_VIEW_GET_STATE_CHANNEL);
    ipcMain.removeHandler(CHROME_APPEARANCE_COMMAND_CHANNEL);
    ipcMain.removeHandler(CHROME_APPEARANCE_GET_STATE_CHANNEL);
    ipcMain.removeHandler(PROJECT_AGENT_LOGIN_GET_STATE_CHANNEL);
    ipcMain.removeHandler(PROJECT_AGENT_LOGIN_SAVE_CHANNEL);
    ipcMain.removeHandler(PROJECT_AGENT_LOGIN_CLEAR_CHANNEL);
    ipcMain.removeHandler(FEEDBACK_COMMAND_CHANNEL);
    ipcMain.removeHandler(FEEDBACK_GET_STATE_CHANNEL);
    ipcMain.removeAllListeners(PAGE_PICKER_EVENT_CHANNEL);
    ipcMain.removeAllListeners(PAGE_LOGIN_EVENT_CHANNEL);
    ipcMain.removeAllListeners(PAGE_STYLE_EVENT_CHANNEL);
    this.mcpDiagnosticsUnsubscribe?.();
    this.mcpDiagnosticsUnsubscribe = null;
    this.projectAppearanceUnsubscribe();
    this.projectAgentLoginUnsubscribe();
    this.sessionRuntimeUnsubscribe?.();
    if (this.disposeProjectAppearance) {
      this.projectAppearance.dispose();
    }
    if (this.disposeProjectAgentLogin) {
      this.projectAgentLogin.dispose();
    }
    this.destroyWindow();
  }

  reloadPage(ignoreCache = false): void {
    if (!this.pageView) {
      return;
    }

    if (ignoreCache) {
      this.pageView.webContents.reloadIgnoringCache();
      return;
    }

    this.pageView.webContents.reload();
  }

  togglePageDevTools(): void {
    this.toggleDevToolsFor(this.pageView?.webContents);
  }

  toggleChromeDevTools(): void {
    this.toggleDevToolsFor(this.uiView?.webContents);
  }

  togglePicker(): void {
    if (!this.pageView) {
      return;
    }

    void this.executePickerCommand({ action: 'toggle' });
  }

  toggleMarkdownView(): void {
    if (!this.pageView) {
      return;
    }

    void this.executeMarkdownViewCommand({ action: 'toggle' });
  }

  toggleMcpView(): void {
    void this.executeMcpViewCommand({ action: 'toggle' });
  }

  toggleFeedbackView(): void {
    if (!this.pageView) {
      return;
    }

    void this.executeFeedbackCommand({ action: 'toggle' });
  }

  selectProjectFolder(): void {
    void this.executeChromeAppearanceCommand({ action: 'selectProject' });
  }

  async browseProjectIcon(): Promise<string | null> {
    this.ensureWindow();

    const projectRoot = this.chromeAppearanceState.projectRoot.trim();
    if (!projectRoot) {
      throw new Error('Choose a project folder before picking an icon.');
    }

    if (!this.window) {
      return null;
    }

    const result = await dialog.showOpenDialog(this.window, {
      title: 'Choose Project Icon',
      buttonLabel: 'Choose Icon',
      defaultPath: this.chromeAppearanceState.resolvedProjectIconPath ?? projectRoot,
      properties: ['openFile'],
      filters: [
        {
          name: 'Images',
          extensions: ['png', 'jpg', 'jpeg', 'webp', 'svg'],
        },
      ],
    });

    if (result.canceled || result.filePaths.length === 0) {
      return null;
    }

    return toProjectRelativePath(projectRoot, result.filePaths[0]);
  }

  listTabs(): BrowserTabSnapshot[] {
    const navigationState = this.createNavigationState();

    return [
      {
        tabId: PRIMARY_TAB_ID,
        url: navigationState.url,
        title: navigationState.title,
        isLoading: navigationState.isLoading,
      },
    ];
  }

  getPickerState(): PickerState {
    return {
      enabled: this.pickerState.enabled,
      intent: this.pickerState.intent,
      lastSelection: this.pickerState.lastSelection,
    };
  }

  getNavigationState(): NavigationState {
    return this.createNavigationState();
  }

  getMarkdownViewState(): MarkdownViewState {
    return { ...this.markdownViewState };
  }

  getMcpViewState(): McpViewState {
    return {
      ...this.mcpViewState,
      tools: [...this.mcpViewState.tools],
      recentRequests: this.mcpViewState.recentRequests.map((entry) => ({ ...entry })),
      agentActivity: this.mcpViewState.agentActivity ? { ...this.mcpViewState.agentActivity } : null,
      lastSelfTest: { ...this.mcpViewState.lastSelfTest },
    };
  }

  getStyleViewState(): StyleViewState {
    return {
      ...this.styleViewState,
      selection: this.styleViewState.selection ? { ...this.styleViewState.selection } : null,
      matchedRules: this.styleViewState.matchedRules.map((rule) => ({
        ...rule,
        atRuleContext: [...rule.atRuleContext],
      })),
      computedValues: { ...this.styleViewState.computedValues },
      overrideDeclarations: { ...this.styleViewState.overrideDeclarations },
    };
  }

  getChromeAppearanceState(): ChromeAppearanceState {
    return {
      ...this.chromeAppearanceState,
      panelPreferences: this.clonePanelPreferences(),
    };
  }

  getProjectAgentLoginState(): ProjectAgentLoginState {
    return { ...this.projectAgentLoginState };
  }

  getSessionState(): SessionViewState {
    return {
      ...this.sessionState,
      sessions: this.sessionState.sessions.map((session) => ({ ...session })),
    };
  }

  getFeedbackState(): FeedbackState {
    return {
      ...this.feedbackState,
      draft: {
        ...this.feedbackState.draft,
        selection: this.feedbackState.draft.selection
          ? { ...this.feedbackState.draft.selection }
          : null,
        styleTweaks: this.feedbackState.draft.styleTweaks.map((entry) => ({ ...entry })),
      },
      annotations: this.feedbackState.annotations.map((annotation) => ({
        ...annotation,
        selection: { ...annotation.selection },
        styleTweaks: annotation.styleTweaks.map((entry) => ({ ...entry })),
        replies: annotation.replies.map((reply) => ({ ...reply })),
      })),
    };
  }

  getWindowState(): WindowState {
    if (!this.window || !this.pageView) {
      throw new Error('Window is not ready.');
    }

    const outerBounds = this.window.getBounds();
    const contentBounds = this.window.getContentBounds();
    const pageViewportBounds = this.pageView.getBounds();
    const display = screen.getDisplayMatching(outerBounds);

    return {
      outerBounds,
      contentBounds,
      pageViewportBounds,
      chromeHeight: CHROME_HEIGHT,
      deviceScaleFactor: display.scaleFactor,
    };
  }

  private clonePanelPreferences(): ChromeAppearanceState['panelPreferences'] {
    return panelSurfaceIds.reduce<ChromeAppearanceState['panelPreferences']>((result, surface) => {
      result[surface] = { ...normalizePanelPresentationPreference(this.chromeAppearanceState.panelPreferences[surface]) };
      return result;
    }, {} as ChromeAppearanceState['panelPreferences']);
  }

  private getPanelPresentation(surface: PanelSurfaceId): PanelPresentationPreference {
    return normalizePanelPresentationPreference(this.chromeAppearanceState.panelPreferences[surface]);
  }

  private getPanelView(surface: PanelSurfaceId): WebContentsView | null {
    switch (surface) {
      case 'feedback':
        return this.feedbackPanelView;
      case 'style':
        return this.stylePanelView;
      case 'markdown':
        return this.markdownPanelView;
      case 'mcp':
        return this.mcpPanelView;
      case 'project':
        return this.projectPanelView;
    }
  }

  private isPanelMounted(surface: PanelSurfaceId): boolean {
    switch (surface) {
      case 'feedback':
        return this.feedbackPanelMounted;
      case 'style':
        return this.stylePanelMounted;
      case 'markdown':
        return this.markdownPanelMounted;
      case 'mcp':
        return this.mcpPanelMounted;
      case 'project':
        return this.projectPanelMounted;
    }
  }

  private setPanelMounted(surface: PanelSurfaceId, mounted: boolean): void {
    switch (surface) {
      case 'feedback':
        this.feedbackPanelMounted = mounted;
        return;
      case 'style':
        this.stylePanelMounted = mounted;
        return;
      case 'markdown':
        this.markdownPanelMounted = mounted;
        return;
      case 'mcp':
        this.mcpPanelMounted = mounted;
        return;
      case 'project':
        this.projectPanelMounted = mounted;
        return;
    }
  }

  private isPanelOpen(surface: PanelSurfaceId): boolean {
    switch (surface) {
      case 'feedback':
        return this.feedbackState.isOpen;
      case 'style':
        return this.styleViewState.isOpen;
      case 'markdown':
        return this.markdownViewState.isOpen;
      case 'mcp':
        return this.mcpViewState.isOpen;
      case 'project':
        return this.chromeAppearanceState.isOpen;
    }
  }

  private getOpenPanelSurface(): PanelSurfaceId | null {
    if (this.feedbackState.isOpen && this.feedbackPanelView) {
      return 'feedback';
    }

    if (this.styleViewState.isOpen && this.stylePanelView) {
      return 'style';
    }

    if (this.mcpViewState.isOpen && this.mcpPanelView) {
      return 'mcp';
    }

    if (this.chromeAppearanceState.isOpen && this.projectPanelView) {
      return 'project';
    }

    if (this.markdownViewState.isOpen && this.markdownPanelView) {
      return 'markdown';
    }

    return null;
  }

  private getActiveSidePanel(): PanelSurfaceId | null {
    const activeSurface = this.getOpenPanelSurface();
    if (!activeSurface) {
      return null;
    }

    return this.getPanelPresentation(activeSurface).mode === 'sidebar' ? activeSurface : null;
  }

  private getMainWindowPanelSurface(): PanelSurfaceId | null {
    const activeSurface = this.getOpenPanelSurface();
    if (!activeSurface) {
      return null;
    }

    return this.getPanelPresentation(activeSurface).mode === 'popout' ? null : activeSurface;
  }

  private ensureOpenPanelHosted(): void {
    const activeSurface = this.getOpenPanelSurface();
    if (!activeSurface) {
      return;
    }

    this.ensurePanelHosted(activeSurface);
  }

  private ensurePanelHosted(surface: PanelSurfaceId): void {
    const view = this.getPanelView(surface);
    if (!view) {
      return;
    }

    const presentation = this.getPanelPresentation(surface);
    if (presentation.mode === 'popout') {
      this.mountPanelInPopout(surface, view);
      return;
    }

    this.mountPanelInMainWindow(surface, view);
  }

  private mountPanelInMainWindow(surface: PanelSurfaceId, view: WebContentsView): void {
    if (!this.window) {
      throw new Error('Window is not ready.');
    }

    if (this.popoutSurface === surface) {
      this.detachPanelFromPopout(surface);
      this.closePopoutWindow(true);
    }

    if (!this.isPanelMounted(surface)) {
      this.window.contentView.addChildView(view);
      this.setPanelMounted(surface, true);
    }
  }

  private mountPanelInPopout(surface: PanelSurfaceId, view: WebContentsView): void {
    if (this.window && this.isPanelMounted(surface) && this.popoutSurface !== surface) {
      this.window.contentView.removeChildView(view);
      this.setPanelMounted(surface, false);
    }

    if (this.popoutSurface && this.popoutSurface !== surface) {
      this.closePopoutWindow(false);
    }

    if (!this.popoutWindow || this.popoutSurface !== surface) {
      this.createPopoutWindow(surface);
    }

    if (!this.popoutWindow) {
      return;
    }

    if (!this.isPanelMounted(surface)) {
      this.popoutWindow.contentView.addChildView(view);
      this.setPanelMounted(surface, true);
    }

    this.popoutSurface = surface;
    this.layoutPopoutWindow();
  }

  private detachPanelFromPopout(surface: PanelSurfaceId): void {
    const view = this.getPanelView(surface);
    if (!view || !this.popoutWindow || this.popoutSurface !== surface || !this.isPanelMounted(surface)) {
      return;
    }

    this.popoutWindow.contentView.removeChildView(view);
    this.setPanelMounted(surface, false);
  }

  private detachPanelSurface(surface: PanelSurfaceId): void {
    const view = this.getPanelView(surface);
    if (!view) {
      return;
    }

    if (this.popoutSurface === surface) {
      this.detachPanelFromPopout(surface);
      this.closePopoutWindow(false);
      return;
    }

    if (this.window && this.isPanelMounted(surface)) {
      this.window.contentView.removeChildView(view);
      this.setPanelMounted(surface, false);
    }
  }

  private getFloatingPillSize(
    windowWidth: number,
    contentHeight: number,
  ): { width: number; height: number } {
    const availableWidth = Math.max(windowWidth - FLOATING_PILL_MARGIN * 2, 0);
    const availableHeight = Math.max(contentHeight - FLOATING_PILL_MARGIN * 2, 0);

    return {
      width: Math.max(
        Math.min(FLOATING_PILL_MAX_WIDTH, availableWidth),
        Math.min(FLOATING_PILL_MIN_WIDTH, availableWidth),
      ),
      height: Math.min(FLOATING_PILL_MAX_HEIGHT, availableHeight),
    };
  }

  private clampFloatingPillPosition(
    windowWidth: number,
    contentHeight: number,
    pillWidth: number,
    pillHeight: number,
    position: FloatingPillPosition,
  ): FloatingPillPosition {
    const minX = FLOATING_PILL_MARGIN;
    const maxX = Math.max(windowWidth - pillWidth - FLOATING_PILL_MARGIN, FLOATING_PILL_MARGIN);
    const minY = CHROME_HEIGHT + FLOATING_PILL_MARGIN;
    const maxY = Math.max(
      CHROME_HEIGHT + contentHeight - pillHeight - FLOATING_PILL_MARGIN,
      CHROME_HEIGHT + FLOATING_PILL_MARGIN,
    );

    return {
      x: Math.min(Math.max(position.x, minX), maxX),
      y: Math.min(Math.max(position.y, minY), maxY),
    };
  }

  private getFloatingPillBounds(
    surface: PanelSurfaceId,
    windowWidth: number,
    contentHeight: number,
  ): { x: number; y: number; width: number; height: number } {
    const { width, height } = this.getFloatingPillSize(windowWidth, contentHeight);
    const defaultPosition = {
      x: Math.max(Math.round((windowWidth - width) / 2), FLOATING_PILL_MARGIN),
      y:
        CHROME_HEIGHT +
        Math.max(contentHeight - height - FLOATING_PILL_MARGIN, FLOATING_PILL_MARGIN),
    };
    const nextPosition = this.clampFloatingPillPosition(
      windowWidth,
      contentHeight,
      width,
      height,
      this.floatingPillPositions[surface] ?? defaultPosition,
    );

    this.floatingPillPositions[surface] = nextPosition;
    return {
      ...nextPosition,
      width,
      height,
    };
  }

  private moveFloatingPill(surface: PanelSurfaceId, deltaX: number, deltaY: number): void {
    if (!this.window || !this.isPanelOpen(surface) || this.getPanelPresentation(surface).mode !== 'floating-pill') {
      return;
    }

    const [windowWidth, windowHeight] = this.window.getContentSize();
    const contentHeight = Math.max(windowHeight - CHROME_HEIGHT, 0);
    const currentBounds = this.getFloatingPillBounds(surface, windowWidth, contentHeight);

    this.floatingPillPositions[surface] = this.clampFloatingPillPosition(
      windowWidth,
      contentHeight,
      currentBounds.width,
      currentBounds.height,
      {
        x: currentBounds.x + deltaX,
        y: currentBounds.y + deltaY,
      },
    );
    this.layoutViews();
  }

  private createPopoutWindow(surface: PanelSurfaceId): void {
    this.ensureWindow();

    const popoutWindow = new BaseWindow({
      width: POPOUT_WINDOW_WIDTH,
      height: POPOUT_WINDOW_HEIGHT,
      minWidth: POPOUT_WINDOW_MIN_WIDTH,
      minHeight: POPOUT_WINDOW_MIN_HEIGHT,
      title: `Loop Browser ${panelSurfaceLabels[surface]}`,
      backgroundColor: this.chromeAppearanceState.chromeColor,
      parent: this.window ?? undefined,
      titleBarStyle: 'hiddenInset',
    });

    popoutWindow.on('resize', () => {
      this.layoutPopoutWindow();
    });

    popoutWindow.on('close', () => {
      if (this.popoutSurface === surface) {
        this.detachPanelFromPopout(surface);
      }
    });

    popoutWindow.on('closed', () => {
      const shouldSuppress = this.suppressNextPopoutCloseForSurface === surface;
      if (shouldSuppress) {
        this.suppressNextPopoutCloseForSurface = null;
      }

      if (this.popoutWindow === popoutWindow) {
        this.popoutWindow = null;
        this.popoutSurface = null;
      }

      if (!shouldSuppress && this.isPanelOpen(surface)) {
        this.closePanelSurface(surface);
      }
    });

    this.popoutWindow = popoutWindow;
    this.popoutSurface = surface;
    for (const delayMs of [0, 50, 150, 300]) {
      setTimeout(() => {
        if (this.popoutWindow === popoutWindow && this.popoutSurface === surface) {
          this.layoutPopoutWindow();
        }
      }, delayMs);
    }
  }

  private closePopoutWindow(preserveSurfaceOpen: boolean): void {
    if (!this.popoutWindow) {
      return;
    }

    if (preserveSurfaceOpen && this.popoutSurface) {
      this.suppressNextPopoutCloseForSurface = this.popoutSurface;
    }

    const popoutWindow = this.popoutWindow;
    this.popoutWindow = null;
    this.popoutSurface = null;
    popoutWindow.close();
  }

  private layoutPopoutWindow(): void {
    if (!this.popoutWindow || !this.popoutSurface) {
      return;
    }

    const view = this.getPanelView(this.popoutSurface);
    if (!view) {
      return;
    }

    const [width, height] = this.popoutWindow.getContentSize();
    view.setBounds({
      x: 0,
      y: 0,
      width,
      height,
    });
  }

  private closePanelSurface(surface: PanelSurfaceId): void {
    switch (surface) {
      case 'feedback':
        this.closeFeedbackPanel();
        return;
      case 'style':
        this.closeStylePanel();
        return;
      case 'markdown':
        void this.closeMarkdownPanel();
        return;
      case 'mcp':
        this.closeMcpPanel();
        return;
      case 'project':
        this.closeProjectPanel();
        return;
    }
  }

  private async updatePanelPresentation(
    surface: PanelSurfaceId,
    mode: PanelPresentationMode,
    side?: PanelSidebarSide,
  ): Promise<void> {
    const nextState = await this.projectAppearance.setAppearance({
      panelPreferences: {
        [surface]: normalizePanelPresentationPreference({
          mode,
          side,
        }),
      } as Partial<ChromeAppearanceState['panelPreferences']>,
    });

    this.chromeAppearanceState = {
      ...this.mergeChromeAppearanceDiagnostics(nextState),
      isOpen: this.chromeAppearanceState.isOpen,
    };
    this.applyChromeAppearance();
    if (this.isPanelOpen(surface)) {
      this.ensurePanelHosted(surface);
      this.layoutViews();
    }
    this.sendChromeAppearanceState();
  }

  isWindowFocused(): boolean {
    return this.window?.isFocused() ?? false;
  }

  focusWindow(): void {
    this.ensureWindow();
    if (process.platform === 'darwin') {
      app.focus({ steal: true });
    } else {
      app.focus();
    }
    (this.window as BaseWindow & { show?: () => void }).show?.();
    this.window?.focus();
    this.scheduleWindowFocusRefresh();
  }

  subscribeWindowFocus(listener: (isFocused: boolean) => void): () => void {
    this.windowFocusListeners.add(listener);
    return () => {
      this.windowFocusListeners.delete(listener);
    };
  }

  closeWindow(): void {
    this.window?.close();
  }

  attachMcpDiagnostics(source: McpDiagnosticsSource): void {
    this.mcpDiagnosticsUnsubscribe?.();
    this.mcpDiagnosticsSource = source;
    this.syncMcpViewState();
    this.mcpDiagnosticsUnsubscribe = source.subscribe((snapshot) => {
      this.mcpViewState = mapDiagnosticsToMcpViewState(snapshot, this.mcpViewState.isOpen);
      this.sendMcpViewState();
    });
  }

  async executeNavigationCommand(command: NavigationCommand): Promise<NavigationState> {
    return this.executeNavigation(command);
  }

  async scrollPage(request: PageScrollRequest): Promise<PageScrollResult> {
    return this.executePageScroll(request);
  }

  async resizeWindow(request: ResizeWindowRequest): Promise<WindowState> {
    if (!this.window) {
      throw new Error('Window is not ready.');
    }

    const target = request.target ?? 'pageViewport';
    const { width, height } = computeContentSizeForResize({
      width: request.width,
      height: request.height,
      target,
      hasSidePanelOpen: this.getActiveSidePanel() !== null,
    });

    if (target === 'window') {
      this.window.setSize(width, height);
    } else {
      this.window.setContentSize(width, height);
    }

    this.layoutViews();
    return this.getWindowState();
  }

  async captureScreenshot(request: ScreenshotRequest): Promise<BrowserScreenshotCapture> {
    if (!this.pageView) {
      throw new Error('Page view is not ready.');
    }

    const format = request.format ?? 'png';

    switch (request.target) {
      case 'page':
        return this.capturePageViewport(
          format,
          request.fileNameHint,
          request.quality,
          request.fullPage ?? false,
        );
      case 'element':
        return this.captureElementScreenshot(request, format);
      case 'window':
        return this.captureWindowScreenshot(format, request.fileNameHint, request.quality);
      default:
        throw new Error(`Unsupported screenshot target: ${String(request.target)}`);
    }
  }

  async executePickerCommand(command: PickerCommand): Promise<PickerState> {
    if (!this.pageView) {
      throw new Error('Page view is not ready.');
    }

    const nextIntent = command.intent ?? this.pickerState.intent;

    switch (command.action) {
      case 'enable':
        this.pickerState = {
          enabled: true,
          intent: nextIntent,
          lastSelection: null,
        };
        this.pageView.webContents.send(PAGE_PICKER_CONTROL_CHANNEL, {
          action: 'enable',
          intent: nextIntent,
        });
        break;
      case 'disable':
        this.pickerState = {
          enabled: false,
          intent: nextIntent,
          lastSelection: this.pickerState.lastSelection,
        };
        this.pageView.webContents.send(PAGE_PICKER_CONTROL_CHANNEL, { action: 'disable' });
        break;
      case 'toggle':
        return this.executePickerCommand({
          action: this.pickerState.enabled ? 'disable' : 'enable',
          intent: nextIntent,
        });
      case 'clearSelection':
        this.pickerState = {
          enabled: this.pickerState.enabled,
          intent: nextIntent,
          lastSelection: null,
        };
        break;
      default:
        break;
    }

    this.sendPickerState();
    return this.getPickerState();
  }

  async executeMarkdownViewCommand(command: MarkdownViewCommand): Promise<MarkdownViewState> {
    switch (command.action) {
      case 'open':
        return this.openMarkdownPanel();
      case 'close':
        return this.closeMarkdownPanel();
      case 'toggle':
        return this.markdownViewState.isOpen
          ? this.closeMarkdownPanel()
          : this.openMarkdownPanel();
      case 'moveFloatingPill':
        this.moveFloatingPill('markdown', command.deltaX, command.deltaY);
        return this.getMarkdownViewState();
      case 'setPresentation':
        await this.updatePanelPresentation('markdown', command.mode, command.side);
        this.sendMarkdownViewState();
        return this.getMarkdownViewState();
      case 'refresh':
        return this.refreshMarkdownView(command.force ?? true);
      default:
        return this.getMarkdownViewState();
    }
  }

  async getMarkdownForCurrentPage(forceRefresh = false): Promise<MarkdownViewState> {
    return this.refreshMarkdownView(forceRefresh);
  }

  async executeMcpViewCommand(command: McpViewCommand): Promise<McpViewState> {
    switch (command.action) {
      case 'open':
        return this.openMcpPanel();
      case 'close':
        return this.closeMcpPanel();
      case 'toggle':
        return this.mcpViewState.isOpen ? this.closeMcpPanel() : this.openMcpPanel();
      case 'moveFloatingPill':
        this.moveFloatingPill('mcp', command.deltaX, command.deltaY);
        return this.getMcpViewState();
      case 'setPresentation':
        await this.updatePanelPresentation('mcp', command.mode, command.side);
        this.sendMcpViewState();
        return this.getMcpViewState();
      case 'refresh':
        this.syncMcpViewState();
        return this.getMcpViewState();
      case 'selfTest':
        if (!this.mcpDiagnosticsSource) {
          return this.getMcpViewState();
        }

        {
          const diagnostics = await this.mcpDiagnosticsSource.runSelfTest();
          this.mcpViewState = mapDiagnosticsToMcpViewState(diagnostics, this.mcpViewState.isOpen);
          this.sendMcpViewState();
          return this.getMcpViewState();
        }
      default:
        return this.getMcpViewState();
    }
  }

  async executeStyleViewCommand(command: StyleViewCommand): Promise<StyleViewState> {
    switch (command.action) {
      case 'open':
        return this.openStylePanel();
      case 'close':
        return this.closeStylePanel();
      case 'toggle':
        return this.styleViewState.isOpen ? this.closeStylePanel() : this.openStylePanel();
      case 'moveFloatingPill':
        this.moveFloatingPill('style', command.deltaX, command.deltaY);
        return this.getStyleViewState();
      case 'setPresentation':
        await this.updatePanelPresentation('style', command.mode, command.side);
        this.sendStyleViewState();
        return this.getStyleViewState();
      case 'startInspectionFromSelection':
        return this.startStyleInspection(command.selection);
      case 'refreshInspection':
        return this.refreshStyleInspection();
      case 'setOverrideDeclaration':
        return this.setStyleOverrideDeclaration(command.property, command.value);
      case 'removeOverrideDeclaration':
        return this.removeStyleOverrideDeclaration(command.property);
      case 'replaceOverridesFromRawCss':
        return this.replaceStyleOverridesFromRawCss(command.rawCss);
      case 'clearPreview':
        return this.clearStylePreview();
      default:
        return this.getStyleViewState();
    }
  }

  async executeChromeAppearanceCommand(
    command: ChromeAppearanceCommand,
  ): Promise<ChromeAppearanceState> {
    switch (command.action) {
      case 'open':
        return this.openProjectPanel();
      case 'close':
        return this.closeProjectPanel();
      case 'moveFloatingPill':
        this.moveFloatingPill('project', command.deltaX, command.deltaY);
        return this.getChromeAppearanceState();
      case 'setPresentation':
        await this.updatePanelPresentation('project', command.mode, command.side);
        this.sendChromeAppearanceState();
        return this.getChromeAppearanceState();
      case 'selectProject': {
        const nextState = await this.promptForProjectFolder();
        this.chromeAppearanceState = {
          ...this.mergeChromeAppearanceDiagnostics(nextState),
          isOpen: this.chromeAppearanceState.isOpen,
        };
        this.applyChromeAppearance();
        void this.syncDockIcon();
        this.sendChromeAppearanceState();
        return this.getChromeAppearanceState();
      }
      case 'set': {
        const nextState = await this.projectAppearance.setAppearance({
          chromeColor: command.chromeColor,
          accentColor: command.accentColor,
          defaultUrl: command.defaultUrl,
          agentLoginUsernameEnv: command.agentLoginUsernameEnv,
          agentLoginPasswordEnv: command.agentLoginPasswordEnv,
          projectIconPath: command.projectIconPath,
        });
        this.chromeAppearanceState = {
          ...this.mergeChromeAppearanceDiagnostics(nextState),
          isOpen: this.chromeAppearanceState.isOpen,
        };
        this.applyChromeAppearance();
        void this.syncDockIcon();
        this.sendChromeAppearanceState();
        return this.getChromeAppearanceState();
      }
      case 'reset': {
        const nextState = await this.projectAppearance.resetAppearance();
        this.chromeAppearanceState = {
          ...this.mergeChromeAppearanceDiagnostics(nextState),
          isOpen: this.chromeAppearanceState.isOpen,
        };
        this.applyChromeAppearance();
        void this.syncDockIcon();
        this.sendChromeAppearanceState();
        return this.getChromeAppearanceState();
      }
      default:
        return this.getChromeAppearanceState();
    }
  }

  async executeFeedbackCommand(command: FeedbackCommand): Promise<FeedbackState> {
    switch (command.action) {
      case 'open':
        return this.openFeedbackPanel();
      case 'close':
        return this.closeFeedbackPanel();
      case 'toggle':
        return this.feedbackState.isOpen ? this.closeFeedbackPanel() : this.openFeedbackPanel();
      case 'moveFloatingPill':
        this.moveFloatingPill('feedback', command.deltaX, command.deltaY);
        return this.getFeedbackState();
      case 'setPresentation':
        await this.updatePanelPresentation('feedback', command.mode, command.side);
        this.sendFeedbackState();
        return this.getFeedbackState();
      case 'clearDraft':
        this.feedbackState = {
          ...this.feedbackState,
          draft: createEmptyFeedbackDraft(),
          activeAnnotationId: null,
        };
        this.sendFeedbackState();
        return this.getFeedbackState();
      case 'startDraftFromSelection':
        this.closeMarkdownPanel(false);
        this.closeMcpPanel(false);
        this.closeStylePanel(false);
        this.feedbackState = {
          ...this.feedbackState,
          isOpen: true,
          draft: {
            selection: command.selection,
            summary: this.buildDraftSummary(command.selection),
            note: '',
            kind: 'bug',
            priority: 'medium',
            intent: command.intent ?? 'feedback',
            styleTweaks: command.styleTweaks ? command.styleTweaks.map((entry) => ({ ...entry })) : [],
            sourceUrl: command.sourceUrl ?? this.createNavigationState().url,
            sourceTitle: command.sourceTitle ?? this.createNavigationState().title,
          },
          activeAnnotationId: null,
          lastUpdatedAt: new Date().toISOString(),
        };
        this.ensureFeedbackPanelMounted();
        this.sendMarkdownViewState();
        this.sendMcpViewState();
        this.sendFeedbackState();
        this.layoutViews();
        return this.getFeedbackState();
      case 'updateDraft':
        this.feedbackState = {
          ...this.feedbackState,
          draft: {
            ...this.feedbackState.draft,
            summary:
              typeof command.summary === 'string'
                ? command.summary
                : this.feedbackState.draft.summary,
            note:
              typeof command.note === 'string' ? command.note : this.feedbackState.draft.note,
            kind: command.kind ?? this.feedbackState.draft.kind,
            priority: command.priority ?? this.feedbackState.draft.priority,
            intent: command.intent ?? this.feedbackState.draft.intent,
            styleTweaks:
              command.styleTweaks?.map((entry) => ({ ...entry })) ??
              this.feedbackState.draft.styleTweaks,
          },
          lastUpdatedAt: new Date().toISOString(),
        };
        this.sendFeedbackState();
        return this.getFeedbackState();
      case 'submitDraft': {
        const annotation = this.createAnnotationFromDraft();
        this.feedbackState = {
          ...this.feedbackState,
          annotations: [annotation, ...this.feedbackState.annotations],
          draft: createEmptyFeedbackDraft(),
          activeAnnotationId: annotation.id,
          lastUpdatedAt: annotation.updatedAt,
        };
        this.sendFeedbackState();
        return this.getFeedbackState();
      }
      case 'selectAnnotation':
        this.feedbackState = {
          ...this.feedbackState,
          activeAnnotationId: command.annotationId,
        };
        this.sendFeedbackState();
        return this.getFeedbackState();
      case 'setStatus':
        this.feedbackState = {
          ...this.feedbackState,
          annotations: this.feedbackState.annotations.map((annotation) =>
            annotation.id === command.annotationId
              ? {
                  ...annotation,
                  status: command.status,
                  updatedAt: new Date().toISOString(),
                }
              : annotation,
          ),
          activeAnnotationId: command.annotationId,
          lastUpdatedAt: new Date().toISOString(),
        };
        this.sendFeedbackState();
        return this.getFeedbackState();
      case 'reply':
        this.feedbackState = {
          ...this.feedbackState,
          annotations: this.feedbackState.annotations.map((annotation) =>
            annotation.id === command.annotationId
              ? {
                  ...annotation,
                  updatedAt: new Date().toISOString(),
                  replies: [
                    ...annotation.replies,
                    this.createReply(command.body, command.author ?? 'human'),
                  ],
                }
              : annotation,
          ),
          activeAnnotationId: command.annotationId,
          lastUpdatedAt: new Date().toISOString(),
        };
        this.sendFeedbackState();
        return this.getFeedbackState();
      default:
        return this.getFeedbackState();
    }
  }

  private registerIpcHandlers(): void {
    ipcMain.removeHandler(NAVIGATION_COMMAND_CHANNEL);
    ipcMain.removeHandler(NAVIGATION_GET_STATE_CHANNEL);
    ipcMain.removeHandler(SESSION_COMMAND_CHANNEL);
    ipcMain.removeHandler(SESSION_GET_STATE_CHANNEL);
    ipcMain.removeHandler(PICKER_COMMAND_CHANNEL);
    ipcMain.removeHandler(PICKER_GET_STATE_CHANNEL);
    ipcMain.removeHandler(MARKDOWN_VIEW_COMMAND_CHANNEL);
    ipcMain.removeHandler(MARKDOWN_VIEW_GET_STATE_CHANNEL);
    ipcMain.removeHandler(MCP_VIEW_COMMAND_CHANNEL);
    ipcMain.removeHandler(MCP_VIEW_GET_STATE_CHANNEL);
    ipcMain.removeHandler(CHROME_APPEARANCE_COMMAND_CHANNEL);
    ipcMain.removeHandler(CHROME_APPEARANCE_GET_STATE_CHANNEL);
    ipcMain.removeHandler(PROJECT_AGENT_LOGIN_GET_STATE_CHANNEL);
    ipcMain.removeHandler(PROJECT_AGENT_LOGIN_SAVE_CHANNEL);
    ipcMain.removeHandler(PROJECT_AGENT_LOGIN_CLEAR_CHANNEL);
    ipcMain.removeHandler(FEEDBACK_COMMAND_CHANNEL);
    ipcMain.removeHandler(FEEDBACK_GET_STATE_CHANNEL);
    ipcMain.removeAllListeners(PAGE_PICKER_EVENT_CHANNEL);
    ipcMain.removeAllListeners(PAGE_LOGIN_EVENT_CHANNEL);

    ipcMain.handle(
      NAVIGATION_COMMAND_CHANNEL,
      async (event: IpcMainInvokeEvent, payload: unknown): Promise<NavigationState> => {
        this.assertChromeSender(event);

        if (!isNavigationCommand(payload)) {
          throw new Error('Invalid navigation command payload.');
        }

        return this.executeNavigation(payload);
      },
    );

    ipcMain.handle(
      NAVIGATION_GET_STATE_CHANNEL,
      async (event: IpcMainInvokeEvent): Promise<NavigationState> => {
        this.assertChromeSender(event);
        return this.createNavigationState();
      },
    );

    ipcMain.handle(
      SESSION_COMMAND_CHANNEL,
      async (event: IpcMainInvokeEvent, payload: unknown): Promise<SessionViewState> => {
        this.assertChromeSender(event);

        if (!isSessionCommand(payload)) {
          throw new Error('Invalid session command payload.');
        }

        if (!this.sessionRuntime) {
          return this.getSessionState();
        }

        this.sessionState = await this.sessionRuntime.executeCommand(payload);
        this.syncLauncherDockVisibility();
        this.sendSessionState();
        if (this.role === 'launcher' && payload.action === 'openProject') {
          this.closeWindow();
        }
        return this.getSessionState();
      },
    );

    ipcMain.handle(
      SESSION_GET_STATE_CHANNEL,
      async (event: IpcMainInvokeEvent): Promise<SessionViewState> => {
        this.assertChromeSender(event);
        return this.getSessionState();
      },
    );

    ipcMain.handle(
      PICKER_COMMAND_CHANNEL,
      async (event: IpcMainInvokeEvent, payload: unknown): Promise<PickerState> => {
        this.assertChromeSender(event);

        if (!isPickerCommand(payload)) {
          throw new Error('Invalid picker command payload.');
        }

        return this.executePickerCommand(payload);
      },
    );

    ipcMain.handle(
      PICKER_GET_STATE_CHANNEL,
      async (event: IpcMainInvokeEvent): Promise<PickerState> => {
        this.assertChromeSender(event);
        return this.getPickerState();
      },
    );

    ipcMain.handle(
      MARKDOWN_VIEW_COMMAND_CHANNEL,
      async (event: IpcMainInvokeEvent, payload: unknown): Promise<MarkdownViewState> => {
        this.assertTrustedSender(event);

        if (!isMarkdownViewCommand(payload)) {
          throw new Error('Invalid markdown view command payload.');
        }

        return this.executeMarkdownViewCommand(payload);
      },
    );

    ipcMain.handle(
      MARKDOWN_VIEW_GET_STATE_CHANNEL,
      async (event: IpcMainInvokeEvent): Promise<MarkdownViewState> => {
        this.assertTrustedSender(event);
        return this.getMarkdownViewState();
      },
    );

    ipcMain.handle(
      MCP_VIEW_COMMAND_CHANNEL,
      async (event: IpcMainInvokeEvent, payload: unknown): Promise<McpViewState> => {
        this.assertTrustedSender(event);

        if (!isMcpViewCommand(payload)) {
          throw new Error('Invalid MCP view command payload.');
        }

        return this.executeMcpViewCommand(payload);
      },
    );

    ipcMain.handle(MCP_VIEW_GET_STATE_CHANNEL, async (event: IpcMainInvokeEvent) => {
      this.assertTrustedSender(event);
      return this.getMcpViewState();
    });

    ipcMain.handle(
      STYLE_VIEW_COMMAND_CHANNEL,
      async (event: IpcMainInvokeEvent, payload: unknown): Promise<StyleViewState> => {
        this.assertTrustedSender(event);

        if (!isStyleViewCommand(payload)) {
          throw new Error('Invalid style view command payload.');
        }

        return this.executeStyleViewCommand(payload);
      },
    );

    ipcMain.handle(STYLE_VIEW_GET_STATE_CHANNEL, async (event: IpcMainInvokeEvent) => {
      this.assertTrustedSender(event);
      return this.getStyleViewState();
    });

    ipcMain.handle(
      CHROME_APPEARANCE_COMMAND_CHANNEL,
      async (event: IpcMainInvokeEvent, payload: unknown): Promise<ChromeAppearanceState> => {
        this.assertTrustedSender(event);

        if (!isChromeAppearanceCommand(payload)) {
          throw new Error('Invalid chrome appearance command payload.');
        }

        return this.executeChromeAppearanceCommand(payload);
      },
    );

    ipcMain.handle(CHROME_APPEARANCE_GET_STATE_CHANNEL, async (event: IpcMainInvokeEvent) => {
      this.assertTrustedSender(event);
      return this.getChromeAppearanceState();
    });

    ipcMain.handle(
      PROJECT_AGENT_LOGIN_GET_STATE_CHANNEL,
      async (event: IpcMainInvokeEvent): Promise<ProjectAgentLoginState> => {
        this.assertTrustedSender(event);
        return this.getProjectAgentLoginState();
      },
    );

    ipcMain.handle(
      PROJECT_AGENT_LOGIN_SAVE_CHANNEL,
      async (event: IpcMainInvokeEvent, payload: unknown): Promise<ProjectAgentLoginState> => {
        this.assertTrustedSender(event);

        if (!isProjectAgentLoginSaveRequest(payload)) {
          throw new Error('Invalid project agent login payload.');
        }

        return this.saveProjectAgentLogin(payload);
      },
    );

    ipcMain.handle(
      PROJECT_AGENT_LOGIN_CLEAR_CHANNEL,
      async (event: IpcMainInvokeEvent): Promise<ProjectAgentLoginState> => {
        this.assertTrustedSender(event);
        return this.clearProjectAgentLogin();
      },
    );

    ipcMain.handle(
      CHROME_APPEARANCE_BROWSE_ICON_CHANNEL,
      async (event: IpcMainInvokeEvent): Promise<string | null> => {
        this.assertTrustedSender(event);
        return this.browseProjectIcon();
      },
    );

    ipcMain.handle(
      FEEDBACK_COMMAND_CHANNEL,
      async (event: IpcMainInvokeEvent, payload: unknown): Promise<FeedbackState> => {
        this.assertTrustedSender(event);

        if (!isFeedbackCommand(payload)) {
          throw new Error('Invalid feedback command payload.');
        }

        return this.executeFeedbackCommand(payload);
      },
    );

    ipcMain.handle(FEEDBACK_GET_STATE_CHANNEL, async (event: IpcMainInvokeEvent) => {
      this.assertTrustedSender(event);
      return this.getFeedbackState();
    });

    ipcMain.on(PAGE_PICKER_EVENT_CHANNEL, (event: IpcMainEvent, payload: unknown) => {
      if (!this.pageView || event.sender.id !== this.pageView.webContents.id) {
        return;
      }

      if (!isPagePickerEvent(payload)) {
        return;
      }

      if (payload.type === 'cancelled') {
        this.pickerState = {
          enabled: false,
          intent: this.pickerState.intent,
          lastSelection: this.pickerState.lastSelection,
        };
      } else {
        this.pickerState = {
          enabled: false,
          intent: payload.intent,
          lastSelection: payload.descriptor,
        };
        if (payload.intent === 'style') {
          void this.startStyleInspection(payload.descriptor);
        } else {
          void this.executeFeedbackCommand({
            action: 'startDraftFromSelection',
            selection: payload.descriptor,
            intent: 'feedback',
            sourceUrl: this.createNavigationState().url,
            sourceTitle: this.createNavigationState().title,
          });
        }
      }

      this.sendPickerState();
    });

    ipcMain.on(PAGE_LOGIN_EVENT_CHANNEL, (event: IpcMainEvent, payload: unknown) => {
      if (!this.pageView || event.sender.id !== this.pageView.webContents.id) {
        return;
      }

      if (!isPageLoginEvent(payload) || payload.type !== 'availability') {
        return;
      }

      if (this.hasVisibleLoginForm === payload.hasVisibleLoginForm) {
        return;
      }

      this.hasVisibleLoginForm = payload.hasVisibleLoginForm;
      this.sendNavigationState();
    });

    ipcMain.on(PAGE_STYLE_EVENT_CHANNEL, (event: IpcMainEvent, payload: unknown) => {
      if (!this.pageView || event.sender.id !== this.pageView.webContents.id) {
        return;
      }

      if (!isPageStyleEvent(payload)) {
        return;
      }

      if (payload.type === 'selectionLost') {
        this.styleViewState = {
          ...createEmptyStyleViewState(),
          isOpen: this.styleViewState.isOpen,
          status: 'error',
          linkedAnnotationId: this.styleViewState.linkedAnnotationId,
          lastError: payload.message,
          previewStatus: 'error',
        };
        this.sendStyleViewState();
        return;
      }

      const pending = this.pendingStyleRequests.get(payload.requestId);
      if (!pending) {
        return;
      }

      this.pendingStyleRequests.delete(payload.requestId);
      if (payload.type === 'error') {
        pending.reject(new Error(payload.message));
        return;
      }

      pending.resolve(payload.inspection);
    });
  }

  private assertChromeSender(event: IpcMainInvokeEvent): void {
    if (!this.uiView || event.sender.id !== this.uiView.webContents.id) {
      throw new Error('Unauthorized renderer sender.');
    }
  }

  private assertTrustedSender(event: IpcMainInvokeEvent): void {
    const trustedIds = [
      this.uiView?.webContents.id,
      this.markdownPanelView?.webContents.id,
      this.mcpPanelView?.webContents.id,
      this.projectPanelView?.webContents.id,
      this.feedbackPanelView?.webContents.id,
      this.stylePanelView?.webContents.id,
    ].filter((value): value is number => typeof value === 'number');

    if (!trustedIds.includes(event.sender.id)) {
      throw new Error('Unauthorized renderer sender.');
    }
  }

  private attachWindowLifecycle(): void {
    if (!this.window) {
      return;
    }

    this.window.on('focus', () => {
      this.notifyWindowFocusChanged();
    });

    this.window.on('blur', () => {
      this.notifyWindowFocusChanged();
    });

    this.window.on('resize', () => {
      this.layoutViews();
    });

    this.window.on('closed', () => {
      this.destroyWindow();
    });
  }

  private notifyWindowFocusChanged(): void {
    const isFocused = this.isWindowFocused();
    for (const listener of this.windowFocusListeners) {
      listener(isFocused);
    }
  }

  private scheduleWindowFocusRefresh(): void {
    for (const delayMs of [0, 100, 250, 500, 1_000]) {
      setTimeout(() => {
        this.notifyWindowFocusChanged();
      }, delayMs);
    }
  }

  private attachPageEvents(): void {
    if (!this.pageView) {
      return;
    }

    const { webContents } = this.pageView;

    webContents.on('did-start-loading', () => {
      this.lastError = null;
      this.hasVisibleLoginForm = false;
      this.resetPickerOnNavigation();
      this.invalidateMarkdownCache();
      this.sendNavigationState();
    });

    webContents.on('did-stop-loading', () => {
      this.sendNavigationState();
    });

    webContents.on('did-finish-load', () => {
      this.sendNavigationState();
      if (this.markdownViewState.isOpen) {
        void this.refreshMarkdownView(true);
      }
    });

    webContents.on('did-navigate', () => {
      this.sendNavigationState();
    });

    webContents.on('did-navigate-in-page', () => {
      this.sendNavigationState();
    });

    webContents.on('page-title-updated', () => {
      this.sendNavigationState();
    });

    webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedUrl) => {
      if (errorCode === -3) {
        return;
      }

      this.lastError = `${errorDescription} (${validatedUrl})`;
      this.sendNavigationState();

      if (this.markdownViewState.isOpen) {
        this.setMarkdownError(
          `Cannot generate Markdown while the page failed to load: ${errorDescription}.`,
          validatedUrl,
          this.createNavigationState().title,
        );
      }
    });
  }

  private attachPopupPolicy(): void {
    if (!this.pageView) {
      return;
    }

    this.pageView.webContents.setWindowOpenHandler(({ url }) => {
      if (isSafeExternalUrl(url)) {
        void shell.openExternal(url);
      }

      return { action: 'deny' };
    });
  }

  private createTrustedView(surface: TrustedSurface): WebContentsView {
    const view = new WebContentsView({
      webPreferences: {
        preload: path.join(__dirname, 'ui.js'),
        contextIsolation: true,
        nodeIntegration: false,
      },
    });

    view.webContents.once('did-finish-load', () => {
      this.sendNavigationState();
      this.sendSessionState();
      this.sendPickerState();
      this.sendFeedbackState();
      this.sendMarkdownViewState();
      this.sendMcpViewState();
      this.sendStyleViewState();
      this.sendChromeAppearanceState();
      this.layoutViews();
      this.layoutPopoutWindow();
    });

    this.loadTrustedSurface(view, surface);
    return view;
  }

  private loadTrustedSurface(view: WebContentsView, surface: TrustedSurface): void {
    if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
      const devUrl = new URL(MAIN_WINDOW_VITE_DEV_SERVER_URL);
      devUrl.searchParams.set('surface', surface);
      void view.webContents.loadURL(devUrl.toString());
      return;
    }

    void view.webContents.loadFile(
      path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`),
      {
        query: { surface },
      },
    );
  }

  private async loadInitialPage(): Promise<void> {
    if (this.role === 'launcher') {
      return;
    }

    const initialUrl =
      (this.options.initialUrl ?? this.chromeAppearanceState.defaultUrl) ||
      fixtureFileUrl({
        appPath: app.getAppPath(),
        isPackaged: app.isPackaged,
        resourcesPath: process.resourcesPath,
      });

    await this.navigateTo(normalizeAddress(initialUrl));
  }

  private layoutViews(): void {
    if (!this.window || !this.uiView) {
      return;
    }

    const [width, height] = this.window.getContentSize();
    if (!this.pageView) {
      this.uiView.setBounds({
        x: 0,
        y: 0,
        width,
        height,
      });

      for (const panelView of [
        this.feedbackPanelView,
        this.markdownPanelView,
        this.mcpPanelView,
        this.projectPanelView,
        this.stylePanelView,
      ]) {
        if (!panelView) {
          continue;
        }

        panelView.setBounds({
          x: width,
          y: 0,
          width: 0,
          height: 0,
        });
      }
      return;
    }

    const contentHeight = Math.max(height - CHROME_HEIGHT, 0);
    const activeSurface = this.getMainWindowPanelSurface();
    const activeView = activeSurface ? this.getPanelView(activeSurface) : null;
    const activePresentation = activeSurface ? this.getPanelPresentation(activeSurface) : null;

    this.uiView.setBounds({
      x: 0,
      y: 0,
      width,
      height: CHROME_HEIGHT,
    });

    if (activeView && activePresentation?.mode === 'sidebar') {
      if (width < SIDE_PANEL_BREAKPOINT) {
        this.pageView.setBounds({
          x: 0,
          y: CHROME_HEIGHT,
          width: 0,
          height: 0,
        });
        activeView.setBounds({
          x: 0,
          y: CHROME_HEIGHT,
          width,
          height: contentHeight,
        });
        return;
      }

      const panelWidth = Math.min(SIDE_PANEL_WIDTH, width);
      const pageWidth = Math.max(width - panelWidth, 0);
      const side = activePresentation.side === 'left' ? 'left' : 'right';

      if (side === 'left') {
        activeView.setBounds({
          x: 0,
          y: CHROME_HEIGHT,
          width: panelWidth,
          height: contentHeight,
        });
        this.pageView.setBounds({
          x: panelWidth,
          y: CHROME_HEIGHT,
          width: pageWidth,
          height: contentHeight,
        });
      } else {
        this.pageView.setBounds({
          x: 0,
          y: CHROME_HEIGHT,
          width: pageWidth,
          height: contentHeight,
        });
        activeView.setBounds({
          x: pageWidth,
          y: CHROME_HEIGHT,
          width: panelWidth,
          height: contentHeight,
        });
      }
      return;
    }

    if (activeSurface && activeView && activePresentation?.mode === 'floating-pill') {
      this.pageView.setBounds({
        x: 0,
        y: CHROME_HEIGHT,
        width,
        height: contentHeight,
      });
      const panelBounds = this.getFloatingPillBounds(activeSurface, width, contentHeight);

      activeView.setBounds({
        x: panelBounds.x,
        y: panelBounds.y,
        width: panelBounds.width,
        height: panelBounds.height,
      });
      return;
    }

    this.pageView.setBounds({
      x: 0,
      y: CHROME_HEIGHT,
      width,
      height: contentHeight,
    });

    for (const panelView of [
      this.feedbackPanelView,
      this.markdownPanelView,
      this.mcpPanelView,
      this.stylePanelView,
      this.projectPanelView,
    ]) {
      if (!panelView) {
        continue;
      }

      panelView.setBounds({
        x: width,
        y: CHROME_HEIGHT,
        width: 0,
        height: 0,
      });
    }
  }

  private async executeNavigation(command: NavigationCommand): Promise<NavigationState> {
    if (!this.pageView) {
      throw new Error('Page view is not ready.');
    }

    const { navigationHistory } = this.pageView.webContents;

    switch (command.action) {
      case 'navigate':
        return this.navigateTo(normalizeAddress(command.target));
      case 'reload':
        this.pageView.webContents.reload();
        break;
      case 'stop':
        this.pageView.webContents.stop();
        break;
      case 'back':
        if (navigationHistory.canGoBack()) {
          navigationHistory.goBack();
        }
        break;
      case 'forward':
        if (navigationHistory.canGoForward()) {
          navigationHistory.goForward();
        }
        break;
      case 'useAgentLogin':
        this.fillAgentLoginIntoPage();
        break;
      default:
        break;
    }

    return this.createNavigationState();
  }

  private async navigateTo(target: string): Promise<NavigationState> {
    if (!this.pageView) {
      throw new Error('Page view is not ready.');
    }

    this.lastError = null;

    try {
      await this.pageView.webContents.loadURL(target);
    } catch (error) {
      this.lastError = error instanceof Error ? error.message : 'Navigation failed.';
    }

    return this.createNavigationState();
  }

  private async executePageScroll(request: PageScrollRequest): Promise<PageScrollResult> {
    if (!this.pageView) {
      throw new Error('Page view is not ready.');
    }

    const payload = (await this.pageView.webContents.executeJavaScript(
      `(() => {
        const request = ${JSON.stringify({
          mode: typeof request.selector === 'string' ? 'selector' : 'delta',
          selector: request.selector ?? null,
          block: request.block ?? 'center',
          byX: typeof request.byX === 'number' ? request.byX : 0,
          byY: typeof request.byY === 'number' ? request.byY : 0,
        })};
        const scrollingElement =
          document.scrollingElement ?? document.documentElement ?? document.body;
        const serialize = () => ({
          scrollX: Number(window.scrollX.toFixed(2)),
          scrollY: Number(window.scrollY.toFixed(2)),
          maxScrollX: Number(
            Math.max((scrollingElement?.scrollWidth ?? window.innerWidth) - window.innerWidth, 0).toFixed(2),
          ),
          maxScrollY: Number(
            Math.max((scrollingElement?.scrollHeight ?? window.innerHeight) - window.innerHeight, 0).toFixed(2),
          ),
          url: window.location.href,
        });

        try {
          if (request.mode === 'selector') {
            const element = document.querySelector(request.selector);
            if (!element) {
              return { ok: false, error: 'The requested selector did not match any element.' };
            }

            element.scrollIntoView({
              block: request.block,
              inline: 'nearest',
            });
          } else {
            window.scrollBy(request.byX, request.byY);
          }

          return new Promise((resolve) => {
            requestAnimationFrame(() => {
              requestAnimationFrame(() => {
                resolve({
                  ok: true,
                  result: serialize(),
                });
              });
            });
          });
        } catch (error) {
          return {
            ok: false,
            error: error instanceof Error ? error.message : 'Could not scroll the page.',
          };
        }
      })()`,
    )) as { ok: boolean; result?: PageScrollResult; error?: string };

    if (!payload.ok || !payload.result) {
      throw new Error(payload.error ?? 'Could not scroll the page.');
    }

    return payload.result;
  }

  private async capturePageViewport(
    format: ScreenshotFormat,
    fileNameHint?: string,
    quality?: number,
    fullPage = false,
  ): Promise<BrowserScreenshotCapture> {
    if (!this.pageView) {
      throw new Error('Page view is not ready.');
    }

    const viewportBounds = this.pageView.getBounds();
    if (viewportBounds.width <= 0 || viewportBounds.height <= 0) {
      throw new Error('The page view is not currently visible.');
    }

    if (fullPage) {
      return this.captureFullPageScreenshot(format, fileNameHint, quality);
    }

    const image = await this.pageView.webContents.capturePage();
    return this.serializeScreenshotImage({
      image,
      target: 'page',
      format,
      quality,
      fileNameHint,
    });
  }

  private async captureElementScreenshot(
    request: ScreenshotRequest,
    format: ScreenshotFormat,
  ): Promise<BrowserScreenshotCapture> {
    if (!this.pageView) {
      throw new Error('Page view is not ready.');
    }

    const selector = request.selector?.trim() || this.pickerState.lastSelection?.selector;
    if (!selector) {
      throw new Error('Element screenshots require a selector or an existing picker selection.');
    }

    await this.executePageScroll({
      selector,
      block: 'center',
    });

    const elementBox = await this.snapshotElementBox(selector);
    if (elementBox.width <= 0 || elementBox.height <= 0) {
      throw new Error('The requested element is not currently visible.');
    }

    return this.capturePageClipScreenshot({
      clip: {
        x: elementBox.pageX,
        y: elementBox.pageY,
        width: elementBox.width,
        height: elementBox.height,
      },
      target: 'element',
      format,
      quality: request.quality,
      fileNameHint: request.fileNameHint ?? selector,
    });
  }

  private async captureWindowScreenshot(
    format: ScreenshotFormat,
    fileNameHint?: string,
    quality?: number,
  ): Promise<BrowserScreenshotCapture> {
    if (!this.window) {
      throw new Error('Window is not ready.');
    }

    const outerBounds = this.window.getBounds();
    const displayScaleFactor = screen.getDisplayMatching(outerBounds).scaleFactor;
    const sourceId = this.window.getMediaSourceId();
    const sources = await desktopCapturer.getSources({
      types: ['window'],
      thumbnailSize: inferPixelSizeFromScaleFactor(
        outerBounds.width,
        outerBounds.height,
        displayScaleFactor,
      ),
      fetchWindowIcons: false,
    });
    const source = sources.find((candidate) => candidate.id === sourceId);

    if (!source || source.thumbnail.isEmpty()) {
      throw new Error(
        'Full window capture is unavailable. On macOS, grant Screen Recording permission and try again.',
      );
    }

    return this.serializeScreenshotImage({
      image: source.thumbnail,
      target: 'window',
      format,
      quality,
      fileNameHint,
    });
  }

  private async snapshotElementBox(selector: string): Promise<ElementBox> {
    if (!this.pageView) {
      throw new Error('Page view is not ready.');
    }

    const payload = (await this.pageView.webContents.executeJavaScript(
      `(() => {
        const selector = ${JSON.stringify(selector)};

        try {
          const element = document.querySelector(selector);
          if (!element) {
            return { ok: false, error: 'The requested selector did not match any element.' };
          }

          const rect = element.getBoundingClientRect();
          return {
            ok: true,
            box: {
              viewportX: Number(rect.x.toFixed(2)),
              viewportY: Number(rect.y.toFixed(2)),
              pageX: Number((rect.x + window.scrollX).toFixed(2)),
              pageY: Number((rect.y + window.scrollY).toFixed(2)),
              width: Number(rect.width.toFixed(2)),
              height: Number(rect.height.toFixed(2)),
              devicePixelRatio: window.devicePixelRatio,
              viewportWidth: window.innerWidth,
              viewportHeight: window.innerHeight,
              scrollX: Number(window.scrollX.toFixed(2)),
              scrollY: Number(window.scrollY.toFixed(2)),
            },
          };
        } catch (error) {
          return {
            ok: false,
            error: error instanceof Error ? error.message : 'The selector could not be evaluated.',
          };
        }
      })()`,
    )) as { ok: boolean; box?: ElementBox; error?: string };

    if (!payload.ok || !payload.box) {
      throw new Error(payload.error ?? 'Could not locate the requested element.');
    }

    return payload.box;
  }

  private async captureFullPageScreenshot(
    format: ScreenshotFormat,
    fileNameHint?: string,
    quality?: number,
  ): Promise<BrowserScreenshotCapture> {
    const layoutMetrics = await this.withPageDebugger(async (debuggerSession) => {
      await debuggerSession.sendCommand('Page.enable');
      return debuggerSession.sendCommand('Page.getLayoutMetrics');
    }) as {
      cssContentSize?: { width: number; height: number };
      contentSize?: { width: number; height: number };
    };

    const contentSize = layoutMetrics.cssContentSize ?? layoutMetrics.contentSize;
    if (!contentSize) {
      throw new Error('Could not determine the full page size.');
    }

    return this.capturePageClipScreenshot({
      clip: {
        x: 0,
        y: 0,
        width: contentSize.width,
        height: contentSize.height,
      },
      target: 'page',
      format,
      quality,
      fileNameHint,
      captureBeyondViewport: true,
    });
  }

  private async capturePageClipScreenshot(options: {
    clip: {
      x: number;
      y: number;
      width: number;
      height: number;
    };
    target: ScreenshotTarget;
    format: ScreenshotFormat;
    quality?: number;
    fileNameHint?: string;
    captureBeyondViewport?: boolean;
  }): Promise<BrowserScreenshotCapture> {
    const buffer = await this.capturePageClipBuffer({
      clip: options.clip,
      format: options.format,
      quality: options.quality,
      captureBeyondViewport: options.captureBeyondViewport ?? true,
    });

    return this.serializeEncodedScreenshot({
      data: buffer,
      target: options.target,
      format: options.format,
      fileNameHint: options.fileNameHint,
      fallbackPixelSize: {
        width: Math.max(Math.round(options.clip.width), 1),
        height: Math.max(Math.round(options.clip.height), 1),
      },
    });
  }

  private async capturePageClipBuffer(options: {
    clip: {
      x: number;
      y: number;
      width: number;
      height: number;
    };
    format: ScreenshotFormat;
    quality?: number;
    captureBeyondViewport: boolean;
  }): Promise<Buffer> {
    const captureResult = await this.withPageDebugger(async (debuggerSession) => {
      await debuggerSession.sendCommand('Page.enable');
      return debuggerSession.sendCommand('Page.captureScreenshot', {
        format: options.format,
        quality:
          options.format === 'jpeg' ? this.normalizeJpegQuality(options.quality) : undefined,
        fromSurface: true,
        captureBeyondViewport: options.captureBeyondViewport,
        clip: {
          x: Number(options.clip.x.toFixed(2)),
          y: Number(options.clip.y.toFixed(2)),
          width: Math.max(Number(options.clip.width.toFixed(2)), 1),
          height: Math.max(Number(options.clip.height.toFixed(2)), 1),
          scale: 1,
        },
      });
    }) as { data?: string };

    if (typeof captureResult.data !== 'string' || captureResult.data.length === 0) {
      throw new Error('The screenshot capture returned an empty payload.');
    }

    return Buffer.from(captureResult.data, 'base64');
  }

  private async withPageDebugger<T>(
    callback: (debuggerSession: Electron.Debugger) => Promise<T>,
  ): Promise<T> {
    if (!this.pageView) {
      throw new Error('Page view is not ready.');
    }

    const debuggerSession = this.pageView.webContents.debugger;
    const alreadyAttached = debuggerSession.isAttached();

    if (!alreadyAttached) {
      debuggerSession.attach('1.3');
    }

    try {
      return await callback(debuggerSession);
    } finally {
      if (!alreadyAttached && debuggerSession.isAttached()) {
        debuggerSession.detach();
      }
    }
  }

  private serializeScreenshotImage(options: {
    image: Electron.NativeImage;
    target: ScreenshotTarget;
    format: ScreenshotFormat;
    quality?: number;
    fileNameHint?: string;
    fallbackPixelSize?: { width: number; height: number };
  }): BrowserScreenshotCapture {
    if (options.image.isEmpty()) {
      throw new Error('The screenshot capture returned an empty image.');
    }

    const data =
      options.format === 'jpeg'
        ? options.image.toJPEG(this.normalizeJpegQuality(options.quality))
        : options.image.toPNG();
    const imageSize = this.getImagePixelSize(options.image, options.fallbackPixelSize);

    return {
      target: options.target,
      format: options.format,
      mimeType: getMimeTypeForFormat(options.format),
      data,
      pixelWidth: imageSize.width,
      pixelHeight: imageSize.height,
      fileNameHint: sanitizeFileNameHint(options.fileNameHint, options.target),
    };
  }

  private serializeEncodedScreenshot(options: {
    data: Buffer;
    target: ScreenshotTarget;
    format: ScreenshotFormat;
    fileNameHint?: string;
    fallbackPixelSize?: { width: number; height: number };
  }): BrowserScreenshotCapture {
    if (options.data.length === 0) {
      throw new Error('The screenshot capture returned an empty image.');
    }

    const image = nativeImage.createFromBuffer(options.data);
    if (image.isEmpty()) {
      throw new Error('The screenshot capture returned an unreadable image.');
    }

    const imageSize = this.getImagePixelSize(image, options.fallbackPixelSize);
    return {
      target: options.target,
      format: options.format,
      mimeType: getMimeTypeForFormat(options.format),
      data: options.data,
      pixelWidth: imageSize.width,
      pixelHeight: imageSize.height,
      fileNameHint: sanitizeFileNameHint(options.fileNameHint, options.target),
    };
  }

  private getImagePixelSize(
    image: Electron.NativeImage,
    fallback?: { width: number; height: number },
  ): { width: number; height: number } {
    const baseSize = image.getSize();
    const scaleFactors = image.getScaleFactors();
    const maxScaleFactor = scaleFactors.length > 0 ? Math.max(...scaleFactors) : 1;
    const scaledSize = image.getSize(maxScaleFactor);

    if (scaledSize.width > baseSize.width || scaledSize.height > baseSize.height) {
      return scaledSize;
    }

    if (fallback) {
      return fallback;
    }

    return inferPixelSizeFromScaleFactor(baseSize.width, baseSize.height, maxScaleFactor);
  }

  private normalizeJpegQuality(value: number | undefined): number {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      return 90;
    }

    return Math.min(Math.max(Math.round(value), 1), 100);
  }

  private async requestPageStyleInspection(
    command: Omit<PageStyleControl, 'requestId'>,
  ): Promise<StyleInspectionPayload> {
    if (!this.pageView || this.pageView.webContents.isDestroyed()) {
      throw new Error('Page view is not ready.');
    }

    const requestId = randomUUID();
    return new Promise<StyleInspectionPayload>((resolve, reject) => {
      this.pendingStyleRequests.set(requestId, { resolve, reject });
      this.pageView?.webContents.send(PAGE_STYLE_CONTROL_CHANNEL, {
        ...command,
        requestId,
      });
    });
  }

  private rejectPendingStyleRequests(message: string): void {
    for (const [requestId, pending] of this.pendingStyleRequests.entries()) {
      pending.reject(new Error(message));
      this.pendingStyleRequests.delete(requestId);
    }
  }

  private buildStyleAnnotationSummary(selection: FeedbackAnnotation['selection']): string {
    const primary =
      selection.accessibleName || selection.textSnippet || selection.playwrightLocator || selection.selector;
    const descriptor = selection.role || selection.tag;
    return `Style tweak: ${descriptor} ${primary}`.slice(0, 120);
  }

  private buildStyleTweaks(
    declarations: Record<string, string>,
    previousComputedValues: Record<string, string>,
  ): StyleTweak[] {
    return Object.entries(declarations)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([property, value]) => ({
        property,
        value,
        previousValue: previousComputedValues[property] ?? '',
      }));
  }

  private buildStyleAnnotationNote(
    selection: FeedbackAnnotation['selection'],
    styleTweaks: StyleTweak[],
  ): string {
    const heading = this.buildStyleAnnotationSummary(selection);
    const detailLines = styleTweaks.map((entry) =>
      entry.previousValue
        ? `- ${entry.property}: ${entry.value} (was ${entry.previousValue})`
        : `- ${entry.property}: ${entry.value}`,
    );

    return [
      heading,
      `Selector: ${selection.playwrightLocator || selection.selector}`,
      `Frame: ${selection.frame.url || 'current page'}`,
      '',
      'Current overrides:',
      ...detailLines,
    ].join('\n');
  }

  private isUnresolvedStyleStatus(status: FeedbackAnnotation['status']): boolean {
    return status === 'open' || status === 'acknowledged' || status === 'in_progress';
  }

  private isSameStyleTarget(
    annotation: FeedbackAnnotation,
    selection: FeedbackAnnotation['selection'],
    pageUrl: string,
  ): boolean {
    if (annotation.intent !== 'style' || annotation.url !== pageUrl) {
      return false;
    }

    if (annotation.selection.frame.url !== selection.frame.url) {
      return false;
    }

    return this.isSameSelection(annotation.selection, selection);
  }

  private isSameSelection(
    left: FeedbackAnnotation['selection'],
    right: FeedbackAnnotation['selection'],
  ): boolean {
    return (
      left.selector === right.selector ||
      (left.xpath !== null && right.xpath !== null && left.xpath === right.xpath)
    );
  }

  private findStyleAnnotation(
    selection: FeedbackAnnotation['selection'],
    unresolvedOnly = false,
  ): FeedbackAnnotation | null {
    const pageUrl = this.createNavigationState().url;
    return (
      this.feedbackState.annotations.find((annotation) => {
        if (!this.isSameStyleTarget(annotation, selection, pageUrl)) {
          return false;
        }

        return !unresolvedOnly || this.isUnresolvedStyleStatus(annotation.status);
      }) ?? null
    );
  }

  private upsertStyleAnnotation(
    selection: FeedbackAnnotation['selection'],
    declarations: Record<string, string>,
    previousComputedValues: Record<string, string>,
  ): string | null {
    if (Object.keys(declarations).length === 0) {
      return this.findStyleAnnotation(selection)?.id ?? this.styleViewState.linkedAnnotationId;
    }

    const styleTweaks = this.buildStyleTweaks(declarations, previousComputedValues);
    const timestamp = new Date().toISOString();
    const pageUrl = this.createNavigationState().url;
    const pageTitle = this.createNavigationState().title;
    const summary = this.buildStyleAnnotationSummary(selection);
    const note = this.buildStyleAnnotationNote(selection, styleTweaks);
    const existing = this.findStyleAnnotation(selection, true);

    if (existing) {
      this.feedbackState = {
        ...this.feedbackState,
        annotations: this.feedbackState.annotations.map((annotation) =>
          annotation.id === existing.id
            ? {
                ...annotation,
                selection,
                summary,
                note,
                kind: 'change',
                priority: annotation.priority,
                intent: 'style',
                styleTweaks,
                updatedAt: timestamp,
                url: pageUrl,
                pageTitle,
              }
            : annotation,
        ),
        activeAnnotationId: existing.id,
        lastUpdatedAt: timestamp,
      };
      return existing.id;
    }

    const annotation: FeedbackAnnotation = {
      id: randomUUID(),
      selection,
      summary,
      note,
      kind: 'change',
      priority: 'medium',
      intent: 'style',
      styleTweaks,
      status: 'open',
      createdAt: timestamp,
      updatedAt: timestamp,
      url: pageUrl,
      pageTitle,
      replies: [],
    };

    this.feedbackState = {
      ...this.feedbackState,
      annotations: [annotation, ...this.feedbackState.annotations],
      activeAnnotationId: annotation.id,
      lastUpdatedAt: timestamp,
    };
    return annotation.id;
  }

  private applyStyleInspectionResult(
    inspection: StyleInspectionPayload,
    linkedAnnotationId: string | null,
  ): StyleViewState {
    this.styleViewState = {
      isOpen: this.styleViewState.isOpen,
      status: 'ready',
      selection: inspection.selection,
      matchedRules: inspection.matchedRules.map((entry) => ({
        ...entry,
        atRuleContext: [...entry.atRuleContext],
      })),
      computedValues: { ...inspection.computedValues },
      unreadableStylesheetCount: inspection.unreadableStylesheetCount,
      unreadableStylesheetWarning: inspection.unreadableStylesheetWarning,
      overrideDeclarations: { ...inspection.overrideDeclarations },
      previewStatus: inspection.previewStatus,
      linkedAnnotationId,
      lastError: inspection.lastError,
    };
    return this.getStyleViewState();
  }

  private setStyleViewError(message: string): StyleViewState {
    this.styleViewState = {
      ...this.styleViewState,
      status: 'error',
      previewStatus: 'error',
      lastError: message,
    };
    this.sendStyleViewState();
    return this.getStyleViewState();
  }

  private async startStyleInspection(
    selection: FeedbackAnnotation['selection'],
    notify = true,
  ): Promise<StyleViewState> {
    const declarations =
      this.styleViewState.selection && this.isSameSelection(this.styleViewState.selection, selection)
        ? this.styleViewState.overrideDeclarations
        : {};
    this.styleViewState = {
      ...this.styleViewState,
      status: 'loading',
      selection,
      lastError: null,
    };
    if (notify) {
      this.sendStyleViewState();
    }

    try {
      const inspection = await this.requestPageStyleInspection({
        action: 'inspect',
        selection,
        declarations,
      } as Omit<PageStyleControl, 'requestId'>);
      const linkedAnnotationId = this.findStyleAnnotation(selection)?.id ?? null;
      const nextState = this.applyStyleInspectionResult(inspection, linkedAnnotationId);
      this.sendStyleViewState();
      return nextState;
    } catch (error) {
      return this.setStyleViewError(
        error instanceof Error ? error.message : 'Could not inspect the selected element.',
      );
    }
  }

  private async refreshStyleInspection(): Promise<StyleViewState> {
    if (!this.styleViewState.selection) {
      return this.setStyleViewError('Pick an element before refreshing style inspection.');
    }

    return this.startStyleInspection(this.styleViewState.selection);
  }

  private async setStyleOverrideDeclaration(
    property: string,
    value: string,
  ): Promise<StyleViewState> {
    if (!this.styleViewState.selection) {
      return this.setStyleViewError('Pick an element before adjusting styles.');
    }

    const nextDeclarations = {
      ...this.styleViewState.overrideDeclarations,
      [property.trim().toLowerCase()]: value.trim(),
    };
    const previousComputedValues = { ...this.styleViewState.computedValues };
    this.styleViewState = {
      ...this.styleViewState,
      status: 'loading',
      lastError: null,
    };
    this.sendStyleViewState();

    try {
      const inspection = await this.requestPageStyleInspection({
        action: 'inspect',
        selection: this.styleViewState.selection,
        declarations: nextDeclarations,
      } as Omit<PageStyleControl, 'requestId'>);
      const linkedAnnotationId = this.upsertStyleAnnotation(
        inspection.selection,
        inspection.overrideDeclarations,
        previousComputedValues,
      );
      const nextState = this.applyStyleInspectionResult(inspection, linkedAnnotationId);
      this.sendFeedbackState();
      this.sendStyleViewState();
      return nextState;
    } catch (error) {
      return this.setStyleViewError(
        error instanceof Error ? error.message : 'Could not apply that style override.',
      );
    }
  }

  private async removeStyleOverrideDeclaration(property: string): Promise<StyleViewState> {
    if (!this.styleViewState.selection) {
      return this.setStyleViewError('Pick an element before adjusting styles.');
    }

    const nextDeclarations = { ...this.styleViewState.overrideDeclarations };
    delete nextDeclarations[property.trim().toLowerCase()];
    const previousComputedValues = { ...this.styleViewState.computedValues };
    this.styleViewState = {
      ...this.styleViewState,
      status: 'loading',
      lastError: null,
    };
    this.sendStyleViewState();

    try {
      const inspection = await this.requestPageStyleInspection({
        action: 'inspect',
        selection: this.styleViewState.selection,
        declarations: nextDeclarations,
      } as Omit<PageStyleControl, 'requestId'>);
      const linkedAnnotationId = this.upsertStyleAnnotation(
        inspection.selection,
        inspection.overrideDeclarations,
        previousComputedValues,
      );
      const nextState = this.applyStyleInspectionResult(inspection, linkedAnnotationId);
      this.sendFeedbackState();
      this.sendStyleViewState();
      return nextState;
    } catch (error) {
      return this.setStyleViewError(
        error instanceof Error ? error.message : 'Could not remove that style override.',
      );
    }
  }

  private async replaceStyleOverridesFromRawCss(rawCss: string): Promise<StyleViewState> {
    if (!this.styleViewState.selection) {
      return this.setStyleViewError('Pick an element before adjusting styles.');
    }

    const previousComputedValues = { ...this.styleViewState.computedValues };
    this.styleViewState = {
      ...this.styleViewState,
      status: 'loading',
      lastError: null,
    };
    this.sendStyleViewState();

    try {
      const inspection = await this.requestPageStyleInspection({
        action: 'replaceOverridesFromRawCss',
        selection: this.styleViewState.selection,
        rawCss,
      } as Omit<PageStyleControl, 'requestId'>);
      const linkedAnnotationId = this.upsertStyleAnnotation(
        inspection.selection,
        inspection.overrideDeclarations,
        previousComputedValues,
      );
      const nextState = this.applyStyleInspectionResult(inspection, linkedAnnotationId);
      this.sendFeedbackState();
      this.sendStyleViewState();
      return nextState;
    } catch (error) {
      return this.setStyleViewError(
        error instanceof Error ? error.message : 'Could not apply those CSS declarations.',
      );
    }
  }

  private async clearStylePreview(): Promise<StyleViewState> {
    if (!this.styleViewState.selection) {
      return this.setStyleViewError('Pick an element before clearing preview.');
    }

    this.styleViewState = {
      ...this.styleViewState,
      status: 'loading',
      lastError: null,
    };
    this.sendStyleViewState();

    try {
      const inspection = await this.requestPageStyleInspection({
        action: 'clearPreview',
        selection: this.styleViewState.selection,
      });
      const nextState = this.applyStyleInspectionResult(
        inspection,
        this.styleViewState.linkedAnnotationId,
      );
      this.sendStyleViewState();
      return nextState;
    } catch (error) {
      return this.setStyleViewError(
        error instanceof Error ? error.message : 'Could not clear the live style preview.',
      );
    }
  }

  private buildDraftSummary(selection: FeedbackState['draft']['selection']): string {
    if (!selection) {
      return '';
    }

    const primary = selection.accessibleName || selection.textSnippet || selection.selector;
    const descriptor = selection.role || selection.tag;
    return `${descriptor}: ${primary}`.slice(0, 120);
  }

  private createReply(body: string, author: FeedbackAuthor): FeedbackAnnotation['replies'][number] {
    return {
      id: randomUUID(),
      author,
      body: body.trim(),
      createdAt: new Date().toISOString(),
    };
  }

  private createAnnotationFromDraft(): FeedbackAnnotation {
    const selection = this.feedbackState.draft.selection;
    if (!selection) {
      throw new Error('Pick an element before saving feedback.');
    }

    const summary = this.feedbackState.draft.summary.trim() || this.buildDraftSummary(selection);
    const note = this.feedbackState.draft.note.trim();
    const timestamp = new Date().toISOString();

    return {
      id: randomUUID(),
      selection,
      summary,
      note,
      kind: this.feedbackState.draft.kind,
      priority: this.feedbackState.draft.priority,
      intent: this.feedbackState.draft.intent,
      styleTweaks: this.feedbackState.draft.styleTweaks.map((entry) => ({ ...entry })),
      status: 'open',
      createdAt: timestamp,
      updatedAt: timestamp,
      url: this.feedbackState.draft.sourceUrl || this.createNavigationState().url,
      pageTitle: this.feedbackState.draft.sourceTitle || this.createNavigationState().title,
      replies: note
        ? [
            {
              id: randomUUID(),
              author: 'human',
              body: note,
              createdAt: timestamp,
            },
          ]
        : [],
    };
  }

  private openFeedbackPanel(): FeedbackState {
    this.closeMarkdownPanel(false);
    this.closeMcpPanel(false);
    this.closeProjectPanel(false);
    this.closeStylePanel(false);
    this.ensureFeedbackPanelMounted();
    this.feedbackState = {
      ...this.feedbackState,
      isOpen: true,
      lastUpdatedAt: new Date().toISOString(),
    };
    this.layoutViews();
    this.sendStyleViewState();
    this.sendMarkdownViewState();
    this.sendMcpViewState();
    this.sendChromeAppearanceState();
    this.sendFeedbackState();
    return this.getFeedbackState();
  }

  private closeFeedbackPanel(notify = true): FeedbackState {
    this.detachPanelSurface('feedback');

    this.feedbackState = {
      ...this.feedbackState,
      isOpen: false,
      lastUpdatedAt: new Date().toISOString(),
    };
    this.layoutViews();
    if (notify) {
      this.sendFeedbackState();
    }
    return this.getFeedbackState();
  }

  private ensureFeedbackPanelMounted(): void {
    if (!this.feedbackPanelView) {
      this.feedbackPanelView = this.createTrustedView('feedback');
    }

    this.ensurePanelHosted('feedback');
  }

  private async openStylePanel(): Promise<StyleViewState> {
    this.closeFeedbackPanel(false);
    this.closeMarkdownPanel(false);
    this.closeMcpPanel(false);
    this.closeProjectPanel(false);
    this.ensureStylePanelMounted();
    this.styleViewState = {
      ...this.styleViewState,
      isOpen: true,
    };
    this.layoutViews();
    this.sendFeedbackState();
    this.sendStyleViewState();
    this.sendMarkdownViewState();
    this.sendMcpViewState();
    this.sendChromeAppearanceState();

    if (this.pickerState.lastSelection) {
      return this.startStyleInspection(this.pickerState.lastSelection, false);
    }

    this.sendStyleViewState();
    return this.getStyleViewState();
  }

  private closeStylePanel(notify = true): StyleViewState {
    this.detachPanelSurface('style');

    this.styleViewState = {
      ...this.styleViewState,
      isOpen: false,
    };
    this.layoutViews();
    if (notify) {
      this.sendStyleViewState();
    }
    return this.getStyleViewState();
  }

  private ensureStylePanelMounted(): void {
    if (!this.stylePanelView) {
      this.stylePanelView = this.createTrustedView('style');
    }

    this.ensurePanelHosted('style');
  }

  private async openMarkdownPanel(): Promise<MarkdownViewState> {
    this.closeFeedbackPanel(false);
    this.closeStylePanel(false);
    this.closeMcpPanel(false);
    this.closeProjectPanel(false);
    this.ensureMarkdownPanelMounted();

    this.markdownViewState = {
      ...this.markdownViewState,
      isOpen: true,
      status: this.createNavigationState().isLoading ? 'loading' : this.markdownViewState.status,
      lastError: this.createNavigationState().isLoading ? null : this.markdownViewState.lastError,
    };
    this.layoutViews();
    this.sendFeedbackState();
    this.sendMcpViewState();
    this.sendStyleViewState();
    this.sendChromeAppearanceState();
    this.sendMarkdownViewState();

    return this.refreshMarkdownView(false);
  }

  private closeMarkdownPanel(notify = true): MarkdownViewState {
    this.detachPanelSurface('markdown');

    this.markdownViewState = {
      ...this.markdownViewState,
      isOpen: false,
    };
    this.layoutViews();
    if (notify) {
      this.sendMarkdownViewState();
    }
    return this.getMarkdownViewState();
  }

  private ensureMarkdownPanelMounted(): void {
    if (!this.markdownPanelView) {
      this.markdownPanelView = this.createTrustedView('markdown');
    }

    this.ensurePanelHosted('markdown');
  }

  private openMcpPanel(): McpViewState {
    this.closeFeedbackPanel(false);
    this.closeStylePanel(false);
    this.closeMarkdownPanel(false);
    this.closeProjectPanel(false);
    this.ensureMcpPanelMounted();
    this.syncMcpViewState(false);
    this.mcpViewState = {
      ...this.mcpViewState,
      isOpen: true,
    };
    this.layoutViews();
    this.sendFeedbackState();
    this.sendMarkdownViewState();
    this.sendStyleViewState();
    this.sendMcpViewState();
    return this.getMcpViewState();
  }

  private closeMcpPanel(notify = true): McpViewState {
    this.detachPanelSurface('mcp');

    this.mcpViewState = {
      ...this.mcpViewState,
      isOpen: false,
    };
    this.layoutViews();
    if (notify) {
      this.sendMcpViewState();
    }
    return this.getMcpViewState();
  }

  private ensureMcpPanelMounted(): void {
    if (!this.mcpPanelView) {
      this.mcpPanelView = this.createTrustedView('mcp');
    }

    this.ensurePanelHosted('mcp');
  }

  private openProjectPanel(): ChromeAppearanceState {
    this.closeFeedbackPanel(false);
    this.closeStylePanel(false);
    this.closeMarkdownPanel(false);
    this.closeMcpPanel(false);
    this.ensureProjectPanelMounted();
    this.chromeAppearanceState = {
      ...this.chromeAppearanceState,
      isOpen: true,
    };
    this.layoutViews();
    this.sendFeedbackState();
    this.sendMarkdownViewState();
    this.sendMcpViewState();
    this.sendStyleViewState();
    this.sendChromeAppearanceState();
    return this.getChromeAppearanceState();
  }

  private closeProjectPanel(notify = true): ChromeAppearanceState {
    this.detachPanelSurface('project');

    this.chromeAppearanceState = {
      ...this.chromeAppearanceState,
      isOpen: false,
    };
    this.layoutViews();
    if (notify) {
      this.sendChromeAppearanceState();
    }
    return this.getChromeAppearanceState();
  }

  private async promptForProjectFolder(): Promise<ChromeAppearanceState> {
    this.ensureWindow();

    if (!this.window) {
      return this.getChromeAppearanceState();
    }

    const result = await dialog.showOpenDialog(this.window, {
      title: 'Choose Project Folder',
      buttonLabel: 'Choose Folder',
      properties: ['openDirectory', 'createDirectory'],
      defaultPath: this.chromeAppearanceState.projectRoot || undefined,
    });

    if (result.canceled || result.filePaths.length === 0) {
      return this.getChromeAppearanceState();
    }

    if (this.sessionRuntime) {
      this.sessionState = await this.sessionRuntime.executeCommand({
        action: 'openProject',
        projectRoot: result.filePaths[0],
      });
      this.sendSessionState();
      if (this.role === 'launcher') {
        this.closeWindow();
      }
      return this.getChromeAppearanceState();
    }

    return this.projectAppearance.selectProject(result.filePaths[0]);
  }

  private ensureProjectPanelMounted(): void {
    if (!this.projectPanelView) {
      this.projectPanelView = this.createTrustedView('project');
    }

    this.ensurePanelHosted('project');
  }

  private applyChromeAppearance(): void {
    if (this.window && !this.window.isDestroyed()) {
      this.window.setBackgroundColor(this.chromeAppearanceState.chromeColor);
    }

    if (this.popoutWindow && !this.popoutWindow.isDestroyed()) {
      this.popoutWindow.setBackgroundColor(this.chromeAppearanceState.chromeColor);
    }

    this.sendChromeAppearanceState();
  }

  private composeChromeAppearanceError(
    stateError: string | null,
    runtimeError: string | null,
  ): string | null {
    if (stateError && runtimeError) {
      return `${stateError} ${runtimeError}`;
    }

    return stateError ?? runtimeError;
  }

  private mergeChromeAppearanceDiagnostics(
    state: ChromeAppearanceState,
  ): ChromeAppearanceState {
    return {
      ...state,
      dockIconStatus: this.dockIconStatus,
      dockIconSource: this.dockIconSource,
      dockIconLastError: this.dockIconError,
      lastError: this.composeChromeAppearanceError(state.lastError, this.dockIconError),
    };
  }

  private syncLauncherDockVisibility(): void {
    if (this.role !== 'launcher' || process.platform !== 'darwin' || !app.dock) {
      return;
    }

    const hasLiveProjectSessions = this.sessionState.sessions.some(
      (session) => !session.isHome && session.status !== 'closed' && session.status !== 'error',
    );
    const nextVisibility = hasLiveProjectSessions ? 'hidden' : 'shown';
    if (nextVisibility === this.launcherDockVisibility) {
      return;
    }

    if (nextVisibility === 'hidden') {
      app.dock.hide();
    } else {
      app.dock.show();
    }
    this.launcherDockVisibility = nextVisibility;
  }

  private async syncDockIcon(): Promise<void> {
    if (process.platform !== 'darwin' || !app.dock) {
      return;
    }

    const iconPath = this.chromeAppearanceState.resolvedProjectIconPath;
    const defaultDockIconKey = `default:${resolveDefaultDockIconColor(
      this.chromeAppearanceState.chromeColor,
    )}`;
    if (!iconPath) {
      this.dockIconSource = 'chromeColor';
      if (this.appliedDockIconKey !== defaultDockIconKey) {
        try {
          const icon = await composeDefaultDockIcon({
            chromeColor: this.chromeAppearanceState.chromeColor,
            templatePath: this.projectDockTemplatePath,
          });
          if (icon.isEmpty()) {
            throw new Error('Electron created an empty Dock icon from the chrome color icon.');
          }
          app.dock.setIcon(icon);
          this.appliedDockIconKey = defaultDockIconKey;
          this.dockIconStatus = 'applied';
          this.dockIconError = null;
        } catch (error) {
          this.dockIconError =
            error instanceof Error
              ? `Could not compose Loop Browser dock icon: ${error.message}`
              : 'Could not compose Loop Browser dock icon.';
          this.dockIconStatus = 'failed';
          this.appliedDockIconKey = null;
        }
      } else {
        this.dockIconStatus = 'applied';
        this.dockIconError = null;
      }

      this.chromeAppearanceState = this.mergeChromeAppearanceDiagnostics(this.chromeAppearanceState);
      this.sendChromeAppearanceState();
      return;
    }

    this.dockIconSource = 'projectIcon';
    const dockIconKey = `${iconPath}:${this.chromeAppearanceState.chromeColor}`;
    if (dockIconKey === this.appliedDockIconKey) {
      this.dockIconStatus = 'applied';
      this.dockIconError = null;
      this.chromeAppearanceState = this.mergeChromeAppearanceDiagnostics(this.chromeAppearanceState);
      this.sendChromeAppearanceState();
      return;
    }

    try {
      const icon = await composeProjectDockIcon({
        chromeColor: this.chromeAppearanceState.chromeColor,
        projectIconPath: iconPath,
        templatePath: this.projectDockTemplatePath,
      });
      if (icon.isEmpty()) {
        throw new Error('Electron created an empty Dock icon from the composed project icon.');
      }
      app.dock.setIcon(icon);
      this.appliedDockIconKey = dockIconKey;
      this.dockIconStatus = 'applied';
      this.dockIconError = null;
    } catch (error) {
      this.dockIconError =
        error instanceof Error
          ? `Could not compose project dock icon: ${error.message}`
          : 'Could not compose project dock icon.';
      this.dockIconStatus = 'failed';
      try {
        const fallbackIcon = await composeDefaultDockIcon({
          chromeColor: this.chromeAppearanceState.chromeColor,
          templatePath: this.projectDockTemplatePath,
        });
        if (fallbackIcon.isEmpty()) {
          throw new Error('Electron created an empty fallback Dock icon from the chrome color icon.');
        }
        app.dock.setIcon(fallbackIcon);
        this.appliedDockIconKey = defaultDockIconKey;
      } catch {
        this.appliedDockIconKey = null;
      }
    }

    this.chromeAppearanceState = this.mergeChromeAppearanceDiagnostics(this.chromeAppearanceState);
    this.sendChromeAppearanceState();
  }

  private async refreshMarkdownView(forceRefresh: boolean): Promise<MarkdownViewState> {
    if (!this.pageView) {
      throw new Error('Page view is not ready.');
    }

    const navigationState = this.createNavigationState();
    if (!navigationState.url) {
      this.setMarkdownError('No page is loaded yet.', '', '');
      return this.getMarkdownViewState();
    }

    if (
      !forceRefresh &&
      this.markdownViewState.status === 'ready' &&
      this.markdownViewState.sourceUrl === navigationState.url &&
      this.markdownViewState.markdown.trim().length > 0
    ) {
      return this.getMarkdownViewState();
    }

    if (navigationState.isLoading) {
      this.markdownViewState = {
        ...createEmptyMarkdownViewState(),
        isOpen: this.markdownViewState.isOpen,
        status: 'loading',
        sourceUrl: navigationState.url,
        title: navigationState.title,
      };
      this.sendMarkdownViewState();
      return this.getMarkdownViewState();
    }

    const requestId = ++this.markdownRequestId;

    this.markdownViewState = {
      ...createEmptyMarkdownViewState(),
      isOpen: this.markdownViewState.isOpen,
      status: 'loading',
      sourceUrl: navigationState.url,
      title: navigationState.title,
    };
    this.sendMarkdownViewState();

    try {
      const snapshot = await this.snapshotPageMarkup();
      const markdownDocument = await extractMarkdownFromHtml({
        html: snapshot.html,
        url: snapshot.url || navigationState.url,
        fallbackTitle: snapshot.title || navigationState.title,
      });

      if (requestId !== this.markdownRequestId) {
        return this.getMarkdownViewState();
      }

      this.markdownViewState = {
        isOpen: this.markdownViewState.isOpen,
        status: 'ready',
        sourceUrl: markdownDocument.url,
        title: markdownDocument.title,
        markdown: markdownDocument.markdown,
        author: markdownDocument.author,
        site: markdownDocument.site,
        wordCount: markdownDocument.wordCount,
        lastError: null,
      };
    } catch (error) {
      if (requestId !== this.markdownRequestId) {
        return this.getMarkdownViewState();
      }

      this.setMarkdownError(
        error instanceof Error ? error.message : 'Markdown generation failed.',
        navigationState.url,
        navigationState.title,
      );
      return this.getMarkdownViewState();
    }

    this.sendMarkdownViewState();
    return this.getMarkdownViewState();
  }

  private async snapshotPageMarkup(): Promise<PageMarkupSnapshot> {
    if (!this.pageView) {
      throw new Error('Page view is not ready.');
    }

    const snapshot = (await this.pageView.webContents.executeJavaScript(
      `(() => ({
        html: document.documentElement ? document.documentElement.outerHTML : '',
        title: document.title || '',
        url: location.href || ''
      }))()`,
    )) as PageMarkupSnapshot;

    if (!snapshot || typeof snapshot.html !== 'string') {
      throw new Error('Could not read page markup from the current tab.');
    }

    return snapshot;
  }

  private getConfiguredAgentLoginOrigin(): string | null {
    const defaultUrl = this.chromeAppearanceState.defaultUrl.trim();
    if (!defaultUrl) {
      return null;
    }

    try {
      return new URL(defaultUrl).origin;
    } catch {
      return null;
    }
  }

  private createProjectAgentLoginState(
    state: ProjectAgentLoginState = this.projectAgentLogin.getState(),
  ): ProjectAgentLoginState {
    const hasLocalFileState = state.hasPassword || state.lastError !== null;
    const hasLegacyConfig =
      this.chromeAppearanceState.agentLoginUsernameEnv.trim().length > 0 ||
      this.chromeAppearanceState.agentLoginPasswordEnv.trim().length > 0;

    return {
      ...state,
      source: hasLocalFileState ? 'local-file' : hasLegacyConfig ? 'legacy-env' : 'none',
    };
  }

  private async syncProjectAgentLoginProjectRoot(projectRoot: string): Promise<void> {
    const nextState = await this.projectAgentLogin.selectProject(projectRoot.trim() || null);
    this.projectAgentLoginState = this.createProjectAgentLoginState(nextState);
    this.sendProjectAgentLoginState();
    this.sendNavigationState();
  }

  private getLegacyAgentLoginMissingEnvNames(): string[] {
    const usernameEnvName = this.chromeAppearanceState.agentLoginUsernameEnv.trim();
    const passwordEnvName = this.chromeAppearanceState.agentLoginPasswordEnv.trim();

    return [usernameEnvName, passwordEnvName].filter(
      (envName) => envName.length > 0 && !(process.env[envName]?.trim()),
    );
  }

  private getResolvedLegacyAgentLoginCredentials(): { username: string; password: string } | null {
    const usernameEnvName = this.chromeAppearanceState.agentLoginUsernameEnv.trim();
    const passwordEnvName = this.chromeAppearanceState.agentLoginPasswordEnv.trim();
    if (!usernameEnvName || !passwordEnvName) {
      return null;
    }

    const username = process.env[usernameEnvName]?.trim() ?? '';
    const password = process.env[passwordEnvName]?.trim() ?? '';
    if (!username || !password) {
      return null;
    }

    return {
      username,
      password,
    };
  }

  private getResolvedAgentLoginCredentials(): { username: string; password: string } | null {
    const localCredentials = this.projectAgentLogin.resolveLocalCredentials();
    if (localCredentials) {
      return localCredentials;
    }

    return this.getResolvedLegacyAgentLoginCredentials();
  }

  private getAgentLoginCtaState(): AgentLoginCtaState {
    const defaultState: AgentLoginCtaState = {
      visible: false,
      enabled: false,
      reason: null,
    };
    if (!this.pageView) {
      return defaultState;
    }

    const configuredOrigin = this.getConfiguredAgentLoginOrigin();
    if (!configuredOrigin) {
      return {
        ...defaultState,
        reason: 'Set Default URL in Project Settings to scope Use Agent Login to your app.',
      };
    }

    const currentUrl = this.pageView.webContents.getURL();
    if (!currentUrl) {
      return {
        ...defaultState,
        reason: `Use Agent Login is available on ${configuredOrigin} login pages only.`,
      };
    }

    let currentOrigin: string;
    try {
      currentOrigin = new URL(currentUrl).origin;
    } catch {
      return {
        ...defaultState,
        reason: 'Use Agent Login is only available on pages with a valid URL.',
      };
    }

    if (currentOrigin !== configuredOrigin) {
      return {
        ...defaultState,
        reason: `Use Agent Login is available on ${configuredOrigin} login pages only.`,
      };
    }

    if (!this.hasVisibleLoginForm) {
      return {
        ...defaultState,
        reason: 'No login form was detected on this page.',
      };
    }

    const localCredentials = this.projectAgentLogin.resolveLocalCredentials();
    if (localCredentials) {
      return {
        visible: true,
        enabled: true,
        reason: null,
      };
    }

    if (this.projectAgentLoginState.lastError) {
      return {
        visible: true,
        enabled: false,
        reason: this.projectAgentLoginState.lastError,
      };
    }

    const usernameEnvName = this.chromeAppearanceState.agentLoginUsernameEnv.trim();
    const passwordEnvName = this.chromeAppearanceState.agentLoginPasswordEnv.trim();
    if (!usernameEnvName || !passwordEnvName) {
      return {
        visible: true,
        enabled: false,
        reason: 'Save an agent login in Project settings to enable this fill action.',
      };
    }

    const missingEnvNames = this.getLegacyAgentLoginMissingEnvNames();
    if (missingEnvNames.length > 0) {
      return {
        visible: true,
        enabled: false,
        reason: `Legacy env login is configured, but set ${missingEnvNames.join(' and ')} before relaunching Loop Browser.`,
      };
    }

    return {
      visible: true,
      enabled: true,
      reason: null,
    };
  }

  private async saveProjectAgentLogin(payload: {
    username: string;
    password: string;
  }): Promise<ProjectAgentLoginState> {
    const nextState = await this.projectAgentLogin.saveLogin(payload);
    this.projectAgentLoginState = this.createProjectAgentLoginState(nextState);
    this.sendProjectAgentLoginState();
    this.sendNavigationState();
    return this.getProjectAgentLoginState();
  }

  private async clearProjectAgentLogin(): Promise<ProjectAgentLoginState> {
    const nextState = await this.projectAgentLogin.clearLogin();
    this.projectAgentLoginState = this.createProjectAgentLoginState(nextState);
    this.sendProjectAgentLoginState();
    this.sendNavigationState();
    return this.getProjectAgentLoginState();
  }

  private fillAgentLoginIntoPage(): void {
    if (!this.pageView || this.pageView.webContents.isDestroyed()) {
      this.lastError = 'Page view is not ready.';
      this.sendNavigationState();
      return;
    }

    const ctaState = this.getAgentLoginCtaState();
    if (!ctaState.visible || !ctaState.enabled) {
      this.lastError = ctaState.reason ?? 'Use Agent Login is not available on this page.';
      this.sendNavigationState();
      return;
    }

    const credentials = this.getResolvedAgentLoginCredentials();
    if (!credentials) {
      this.lastError = 'Agent login credentials are not available in the current environment.';
      this.sendNavigationState();
      return;
    }

    this.lastError = null;
    this.pageView.webContents.send(PAGE_LOGIN_CONTROL_CHANNEL, {
      action: 'fill',
      username: credentials.username,
      password: credentials.password,
    });
    this.sendNavigationState();
  }

  private createNavigationState(): NavigationState {
    if (!this.pageView) {
      return createEmptyNavigationState();
    }

    const { webContents } = this.pageView;
    const { navigationHistory } = webContents;

    return {
      url: webContents.getURL(),
      title: webContents.getTitle() || 'Loop Browser',
      isLoading: webContents.isLoading(),
      canGoBack: navigationHistory.canGoBack(),
      canGoForward: navigationHistory.canGoForward(),
      agentLoginCta: this.getAgentLoginCtaState(),
      lastError: this.lastError,
    };
  }

  private resetPickerOnNavigation(): void {
    if (this.pickerState.enabled && this.pageView && !this.pageView.webContents.isDestroyed()) {
      this.pageView.webContents.send(PAGE_PICKER_CONTROL_CHANNEL, { action: 'disable' });
    }

    if (!this.pickerState.enabled && this.pickerState.lastSelection === null) {
      return;
    }

    this.pickerState = createEmptyPickerState();
    this.sendPickerState();

    if (this.feedbackState.draft.selection) {
      this.feedbackState = {
        ...this.feedbackState,
        draft: createEmptyFeedbackDraft(),
        activeAnnotationId: null,
        lastUpdatedAt: new Date().toISOString(),
      };
      this.sendFeedbackState();
    }

    this.rejectPendingStyleRequests('Style inspection reset after navigation.');
    this.styleViewState = {
      ...createEmptyStyleViewState(),
      isOpen: this.styleViewState.isOpen,
      linkedAnnotationId: this.styleViewState.linkedAnnotationId,
    };
    this.sendStyleViewState();
  }

  private invalidateMarkdownCache(): void {
    this.markdownRequestId += 1;

    if (
      !this.markdownViewState.isOpen &&
      this.markdownViewState.status === 'idle' &&
      this.markdownViewState.markdown.length === 0
    ) {
      return;
    }

    this.markdownViewState = {
      ...createEmptyMarkdownViewState(),
      isOpen: this.markdownViewState.isOpen,
      status: this.markdownViewState.isOpen ? 'loading' : 'idle',
    };
    this.sendMarkdownViewState();
  }

  private setMarkdownError(message: string, sourceUrl: string, title: string): void {
    this.markdownViewState = {
      ...createEmptyMarkdownViewState(),
      isOpen: this.markdownViewState.isOpen,
      status: 'error',
      sourceUrl,
      title,
      lastError: message,
    };
    this.sendMarkdownViewState();
  }

  private syncMcpViewState(notify = true): void {
    if (!this.mcpDiagnosticsSource) {
      return;
    }

    this.mcpViewState = mapDiagnosticsToMcpViewState(
      this.mcpDiagnosticsSource.getDiagnostics(),
      this.mcpViewState.isOpen,
    );
    if (notify) {
      this.sendMcpViewState();
    }
  }

  private sendNavigationState(): void {
    this.sendToTrustedViews(NAVIGATION_STATE_CHANNEL, this.createNavigationState());
    this.sendPageAgentOverlay();
  }

  private sendPickerState(): void {
    this.sendToTrustedViews(PICKER_STATE_CHANNEL, this.getPickerState());
  }

  private sendSessionState(): void {
    this.sendToTrustedViews(SESSION_STATE_CHANNEL, this.getSessionState());
  }

  private sendFeedbackState(): void {
    this.sendToTrustedViews(FEEDBACK_STATE_CHANNEL, this.getFeedbackState());
    this.sendPageAgentOverlay();
  }

  private sendMarkdownViewState(): void {
    this.sendToTrustedViews(MARKDOWN_VIEW_STATE_CHANNEL, this.getMarkdownViewState());
  }

  private sendMcpViewState(): void {
    this.sendToTrustedViews(MCP_VIEW_STATE_CHANNEL, this.getMcpViewState());
    this.sendPageAgentOverlay();
  }

  private sendStyleViewState(): void {
    this.sendToTrustedViews(STYLE_VIEW_STATE_CHANNEL, this.getStyleViewState());
  }

  private sendChromeAppearanceState(): void {
    this.sendToTrustedViews(CHROME_APPEARANCE_STATE_CHANNEL, this.getChromeAppearanceState());
  }

  private sendProjectAgentLoginState(): void {
    this.sendToTrustedViews(PROJECT_AGENT_LOGIN_STATE_CHANNEL, this.getProjectAgentLoginState());
  }

  private sendPageAgentOverlay(): void {
    if (!this.pageView || this.pageView.webContents.isDestroyed()) {
      return;
    }

    this.pageView.webContents.send(PAGE_AGENT_OVERLAY_CHANNEL, this.getPageAgentOverlayState());
  }

  private sendToTrustedViews(channel: string, payload: unknown): void {
    for (const view of [
      this.uiView,
      this.feedbackPanelView,
      this.markdownPanelView,
      this.mcpPanelView,
      this.projectPanelView,
      this.stylePanelView,
    ]) {
      if (!view || view.webContents.isDestroyed()) {
        continue;
      }

      view.webContents.send(channel, payload);
    }
  }

  private destroyWindow(): void {
    this.rejectPendingStyleRequests('Loop Browser closed the current window.');
    if (this.popoutWindow) {
      if (this.popoutSurface) {
        this.suppressNextPopoutCloseForSurface = this.popoutSurface;
      }
      const popoutWindow = this.popoutWindow;
      this.popoutWindow = null;
      this.popoutSurface = null;
      popoutWindow.close();
    }
    this.closeManagedView(this.feedbackPanelView);
    this.closeManagedView(this.mcpPanelView);
    this.closeManagedView(this.projectPanelView);
    this.closeManagedView(this.markdownPanelView);
    this.closeManagedView(this.stylePanelView);
    this.closeManagedView(this.pageView);
    this.closeManagedView(this.uiView);
    this.feedbackPanelView = null;
    this.mcpPanelView = null;
    this.projectPanelView = null;
    this.markdownPanelView = null;
    this.stylePanelView = null;
    this.pageView = null;
    this.uiView = null;
    this.feedbackPanelMounted = false;
    this.mcpPanelMounted = false;
    this.projectPanelMounted = false;
    this.markdownPanelMounted = false;
    this.stylePanelMounted = false;
    this.suppressNextPopoutCloseForSurface = null;
    this.window = null;
  }

  private closeManagedView(view: WebContentsView | null): void {
    if (!view || view.webContents.isDestroyed()) {
      return;
    }

    view.webContents.close();
  }

  private toggleDevToolsFor(webContents: WebContents | undefined): void {
    if (!webContents || webContents.isDestroyed()) {
      return;
    }

    if (webContents.isDevToolsOpened()) {
      webContents.closeDevTools();
      return;
    }

    webContents.openDevTools({ mode: 'detach', activate: true });
  }

  private getPageAgentOverlayState(): PageAgentOverlayState | null {
    const agentActivity = this.mcpViewState.agentActivity;
    if (!agentActivity) {
      return null;
    }

    if (
      agentActivity.phase === 'done' &&
      Date.now() - new Date(agentActivity.updatedAt).getTime() > AGENT_DONE_PULSE_MS
    ) {
      return null;
    }

    const annotation = this.feedbackState.annotations.find(
      (entry) => entry.id === agentActivity.annotationId,
    );
    const navigationState = this.createNavigationState();
    if (!annotation || annotation.url !== navigationState.url) {
      return null;
    }

    return {
      annotationId: annotation.id,
      selection: { ...annotation.selection },
      phase: agentActivity.phase,
      message: agentActivity.message,
      updatedAt: agentActivity.updatedAt,
      sourceUrl: annotation.url,
    };
  }
}
