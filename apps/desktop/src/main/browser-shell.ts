import path from 'node:path';
import {
  BaseWindow,
  WebContentsView,
  type IpcMainEvent,
  type IpcMainInvokeEvent,
  type WebContents,
  app,
  ipcMain,
  shell,
} from 'electron';
import {
  MCP_VIEW_COMMAND_CHANNEL,
  MCP_VIEW_GET_STATE_CHANNEL,
  MCP_VIEW_STATE_CHANNEL,
  MARKDOWN_VIEW_COMMAND_CHANNEL,
  MARKDOWN_VIEW_GET_STATE_CHANNEL,
  MARKDOWN_VIEW_STATE_CHANNEL,
  NAVIGATION_COMMAND_CHANNEL,
  NAVIGATION_GET_STATE_CHANNEL,
  NAVIGATION_STATE_CHANNEL,
  PAGE_PICKER_CONTROL_CHANNEL,
  PAGE_PICKER_EVENT_CHANNEL,
  PICKER_COMMAND_CHANNEL,
  PICKER_GET_STATE_CHANNEL,
  PICKER_STATE_CHANNEL,
  createEmptyMcpViewState,
  createEmptyMarkdownViewState,
  createEmptyNavigationState,
  createEmptyPickerState,
  isMcpViewCommand,
  isMarkdownViewCommand,
  isNavigationCommand,
  isPagePickerEvent,
  isPickerCommand,
  type McpViewCommand,
  type McpViewState,
  type MarkdownViewCommand,
  type MarkdownViewState,
  type NavigationCommand,
  type NavigationState,
  type PickerCommand,
  type PickerState,
} from '@agent-browser/protocol';
import { extractMarkdownFromHtml } from './markdown';
import { mapDiagnosticsToMcpViewState, type McpDiagnosticsSource } from './mcp-view';
import { fixtureFileUrl, isSafeExternalUrl, normalizeAddress } from './url';

const CHROME_HEIGHT = 152;
const MARKDOWN_PANEL_WIDTH = 460;
const MARKDOWN_BREAKPOINT = 1100;

export const PRIMARY_TAB_ID = 'tab-1';

type TrustedSurface = 'chrome' | 'markdown' | 'mcp';

type SidePanelKind = 'markdown' | 'mcp';

type PageMarkupSnapshot = {
  html: string;
  title: string;
  url: string;
};

export interface BrowserTabSnapshot {
  tabId: string;
  url: string;
  title: string;
  isLoading: boolean;
}

interface BrowserShellOptions {
  initialUrl?: string;
}

export class BrowserShell {
  private window: BaseWindow | null = null;
  private uiView: WebContentsView | null = null;
  private pageView: WebContentsView | null = null;
  private markdownPanelView: WebContentsView | null = null;
  private mcpPanelView: WebContentsView | null = null;
  private markdownPanelMounted = false;
  private mcpPanelMounted = false;
  private lastError: string | null = null;
  private pickerState: PickerState = createEmptyPickerState();
  private markdownViewState: MarkdownViewState = createEmptyMarkdownViewState();
  private mcpViewState: McpViewState = createEmptyMcpViewState();
  private markdownRequestId = 0;
  private mcpDiagnosticsSource: McpDiagnosticsSource | null = null;
  private mcpDiagnosticsUnsubscribe: (() => void) | null = null;

  constructor(private readonly options: BrowserShellOptions = {}) {
    this.registerIpcHandlers();
  }

  ensureWindow(): void {
    if (this.window) {
      this.window.focus();
      return;
    }

    this.window = new BaseWindow({
      width: 1480,
      height: 960,
      minWidth: 980,
      minHeight: 720,
      title: 'Agent Browser',
      backgroundColor: '#edf0f4',
      titleBarStyle: 'hiddenInset',
    });

    this.uiView = this.createTrustedView('chrome');
    this.pageView = new WebContentsView({
      webPreferences: {
        preload: path.join(__dirname, 'page.js'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    });

    this.window.contentView.addChildView(this.uiView);
    this.window.contentView.addChildView(this.pageView);

    this.attachWindowLifecycle();
    this.attachPageEvents();
    this.attachPopupPolicy();
    this.layoutViews();
    void this.loadInitialPage();
  }

  dispose(): void {
    ipcMain.removeHandler(NAVIGATION_COMMAND_CHANNEL);
    ipcMain.removeHandler(NAVIGATION_GET_STATE_CHANNEL);
    ipcMain.removeHandler(PICKER_COMMAND_CHANNEL);
    ipcMain.removeHandler(PICKER_GET_STATE_CHANNEL);
    ipcMain.removeHandler(MARKDOWN_VIEW_COMMAND_CHANNEL);
    ipcMain.removeHandler(MARKDOWN_VIEW_GET_STATE_CHANNEL);
    ipcMain.removeHandler(MCP_VIEW_COMMAND_CHANNEL);
    ipcMain.removeHandler(MCP_VIEW_GET_STATE_CHANNEL);
    ipcMain.removeAllListeners(PAGE_PICKER_EVENT_CHANNEL);
    this.mcpDiagnosticsUnsubscribe?.();
    this.mcpDiagnosticsUnsubscribe = null;
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
    void this.executePickerCommand({ action: 'toggle' });
  }

  toggleMarkdownView(): void {
    void this.executeMarkdownViewCommand({ action: 'toggle' });
  }

  toggleMcpView(): void {
    void this.executeMcpViewCommand({ action: 'toggle' });
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
      lastSelfTest: { ...this.mcpViewState.lastSelfTest },
    };
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

  async executePickerCommand(command: PickerCommand): Promise<PickerState> {
    if (!this.pageView) {
      throw new Error('Page view is not ready.');
    }

    switch (command.action) {
      case 'enable':
        this.pickerState = {
          enabled: true,
          lastSelection: null,
        };
        this.pageView.webContents.send(PAGE_PICKER_CONTROL_CHANNEL, { action: 'enable' });
        break;
      case 'disable':
        this.pickerState = {
          enabled: false,
          lastSelection: this.pickerState.lastSelection,
        };
        this.pageView.webContents.send(PAGE_PICKER_CONTROL_CHANNEL, { action: 'disable' });
        break;
      case 'toggle':
        return this.executePickerCommand({
          action: this.pickerState.enabled ? 'disable' : 'enable',
        });
      case 'clearSelection':
        this.pickerState = {
          enabled: this.pickerState.enabled,
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

  private registerIpcHandlers(): void {
    ipcMain.removeHandler(NAVIGATION_COMMAND_CHANNEL);
    ipcMain.removeHandler(NAVIGATION_GET_STATE_CHANNEL);
    ipcMain.removeHandler(PICKER_COMMAND_CHANNEL);
    ipcMain.removeHandler(PICKER_GET_STATE_CHANNEL);
    ipcMain.removeHandler(MARKDOWN_VIEW_COMMAND_CHANNEL);
    ipcMain.removeHandler(MARKDOWN_VIEW_GET_STATE_CHANNEL);
    ipcMain.removeHandler(MCP_VIEW_COMMAND_CHANNEL);
    ipcMain.removeHandler(MCP_VIEW_GET_STATE_CHANNEL);
    ipcMain.removeAllListeners(PAGE_PICKER_EVENT_CHANNEL);

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
          lastSelection: this.pickerState.lastSelection,
        };
      } else {
        this.pickerState = {
          enabled: false,
          lastSelection: payload.descriptor,
        };
      }

      this.sendPickerState();
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
    ].filter((value): value is number => typeof value === 'number');

    if (!trustedIds.includes(event.sender.id)) {
      throw new Error('Unauthorized renderer sender.');
    }
  }

  private attachWindowLifecycle(): void {
    if (!this.window) {
      return;
    }

    this.window.on('resize', () => {
      this.layoutViews();
    });

    this.window.on('closed', () => {
      this.destroyWindow();
    });
  }

  private attachPageEvents(): void {
    if (!this.pageView) {
      return;
    }

    const { webContents } = this.pageView;

    webContents.on('did-start-loading', () => {
      this.lastError = null;
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
      this.sendPickerState();
      this.sendMarkdownViewState();
      this.sendMcpViewState();
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
    const initialUrl =
      this.options.initialUrl ??
      fixtureFileUrl({
        appPath: app.getAppPath(),
        isPackaged: app.isPackaged,
        resourcesPath: process.resourcesPath,
      });

    await this.navigateTo(normalizeAddress(initialUrl));
  }

  private layoutViews(): void {
    if (!this.window || !this.uiView || !this.pageView) {
      return;
    }

    const [width, height] = this.window.getContentSize();
    const contentHeight = Math.max(height - CHROME_HEIGHT, 0);
    const activeSidePanel = this.getActiveSidePanel();
    const activeSidePanelView =
      activeSidePanel === 'markdown'
        ? this.markdownPanelView
        : activeSidePanel === 'mcp'
          ? this.mcpPanelView
          : null;

    this.uiView.setBounds({
      x: 0,
      y: 0,
      width,
      height: CHROME_HEIGHT,
    });

    if (activeSidePanelView) {
      if (width < MARKDOWN_BREAKPOINT) {
        this.pageView.setBounds({
          x: 0,
          y: CHROME_HEIGHT,
          width: 0,
          height: 0,
        });
        activeSidePanelView.setBounds({
          x: 0,
          y: CHROME_HEIGHT,
          width,
          height: contentHeight,
        });
        return;
      }

      const panelWidth = Math.min(MARKDOWN_PANEL_WIDTH, width);
      const pageWidth = Math.max(width - panelWidth, 0);
      this.pageView.setBounds({
        x: 0,
        y: CHROME_HEIGHT,
        width: pageWidth,
        height: contentHeight,
      });
      activeSidePanelView.setBounds({
        x: pageWidth,
        y: CHROME_HEIGHT,
        width: panelWidth,
        height: contentHeight,
      });
      return;
    }

    this.pageView.setBounds({
      x: 0,
      y: CHROME_HEIGHT,
      width,
      height: contentHeight,
    });

    for (const panelView of [this.markdownPanelView, this.mcpPanelView]) {
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

  private async openMarkdownPanel(): Promise<MarkdownViewState> {
    this.closeMcpPanel();
    this.ensureMarkdownPanelMounted();

    this.markdownViewState = {
      ...this.markdownViewState,
      isOpen: true,
      status: this.createNavigationState().isLoading ? 'loading' : this.markdownViewState.status,
      lastError: this.createNavigationState().isLoading ? null : this.markdownViewState.lastError,
    };
    this.layoutViews();
    this.sendMarkdownViewState();

    return this.refreshMarkdownView(false);
  }

  private closeMarkdownPanel(notify = true): MarkdownViewState {
    if (this.window && this.markdownPanelView && this.markdownPanelMounted) {
      this.window.contentView.removeChildView(this.markdownPanelView);
      this.markdownPanelMounted = false;
    }

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
    if (!this.window) {
      throw new Error('Window is not ready.');
    }

    if (!this.markdownPanelView) {
      this.markdownPanelView = this.createTrustedView('markdown');
    }

    if (!this.markdownPanelMounted) {
      this.window.contentView.addChildView(this.markdownPanelView);
      this.markdownPanelMounted = true;
    }
  }

  private openMcpPanel(): McpViewState {
    this.closeMarkdownPanel();
    this.ensureMcpPanelMounted();
    this.syncMcpViewState(false);
    this.mcpViewState = {
      ...this.mcpViewState,
      isOpen: true,
    };
    this.layoutViews();
    this.sendMcpViewState();
    return this.getMcpViewState();
  }

  private closeMcpPanel(notify = true): McpViewState {
    if (this.window && this.mcpPanelView && this.mcpPanelMounted) {
      this.window.contentView.removeChildView(this.mcpPanelView);
      this.mcpPanelMounted = false;
    }

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
    if (!this.window) {
      throw new Error('Window is not ready.');
    }

    if (!this.mcpPanelView) {
      this.mcpPanelView = this.createTrustedView('mcp');
    }

    if (!this.mcpPanelMounted) {
      this.window.contentView.addChildView(this.mcpPanelView);
      this.mcpPanelMounted = true;
    }
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

  private getActiveSidePanel(): SidePanelKind | null {
    if (this.mcpViewState.isOpen && this.mcpPanelView && this.mcpPanelMounted) {
      return 'mcp';
    }

    if (this.markdownViewState.isOpen && this.markdownPanelView && this.markdownPanelMounted) {
      return 'markdown';
    }

    return null;
  }

  private createNavigationState(): NavigationState {
    if (!this.pageView) {
      return createEmptyNavigationState();
    }

    const { webContents } = this.pageView;
    const { navigationHistory } = webContents;

    return {
      url: webContents.getURL(),
      title: webContents.getTitle() || 'Agent Browser',
      isLoading: webContents.isLoading(),
      canGoBack: navigationHistory.canGoBack(),
      canGoForward: navigationHistory.canGoForward(),
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
  }

  private sendPickerState(): void {
    this.sendToTrustedViews(PICKER_STATE_CHANNEL, this.getPickerState());
  }

  private sendMarkdownViewState(): void {
    this.sendToTrustedViews(MARKDOWN_VIEW_STATE_CHANNEL, this.getMarkdownViewState());
  }

  private sendMcpViewState(): void {
    this.sendToTrustedViews(MCP_VIEW_STATE_CHANNEL, this.getMcpViewState());
  }

  private sendToTrustedViews(channel: string, payload: unknown): void {
    for (const view of [this.uiView, this.markdownPanelView, this.mcpPanelView]) {
      if (!view || view.webContents.isDestroyed()) {
        continue;
      }

      view.webContents.send(channel, payload);
    }
  }

  private destroyWindow(): void {
    this.closeManagedView(this.mcpPanelView);
    this.closeManagedView(this.markdownPanelView);
    this.closeManagedView(this.pageView);
    this.closeManagedView(this.uiView);
    this.mcpPanelView = null;
    this.markdownPanelView = null;
    this.pageView = null;
    this.uiView = null;
    this.mcpPanelMounted = false;
    this.markdownPanelMounted = false;
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
}
