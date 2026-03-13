import path from 'node:path';
import {
  BaseWindow,
  WebContentsView,
  type WebContents,
  app,
  ipcMain,
  shell,
  type IpcMainInvokeEvent,
} from 'electron';
import {
  NAVIGATION_COMMAND_CHANNEL,
  NAVIGATION_GET_STATE_CHANNEL,
  NAVIGATION_STATE_CHANNEL,
  createEmptyNavigationState,
  isNavigationCommand,
  type NavigationCommand,
  type NavigationState,
} from '@agent-browser/protocol';
import { fixtureFileUrl, isSafeExternalUrl, normalizeAddress } from './url';

const CHROME_HEIGHT = 176;

export class BrowserShell {
  private window: BaseWindow | null = null;
  private uiView: WebContentsView | null = null;
  private pageView: WebContentsView | null = null;
  private lastError: string | null = null;

  constructor() {
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
      backgroundColor: '#081321',
      titleBarStyle: 'hiddenInset',
    });

    this.uiView = new WebContentsView({
      webPreferences: {
        preload: path.join(__dirname, 'ui.js'),
        contextIsolation: true,
        nodeIntegration: false,
      },
    });

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
    this.loadUi();
    this.layoutViews();
    void this.loadInitialPage();
  }

  dispose(): void {
    ipcMain.removeHandler(NAVIGATION_COMMAND_CHANNEL);
    ipcMain.removeHandler(NAVIGATION_GET_STATE_CHANNEL);
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

  private registerIpcHandlers(): void {
    ipcMain.removeHandler(NAVIGATION_COMMAND_CHANNEL);
    ipcMain.removeHandler(NAVIGATION_GET_STATE_CHANNEL);

    ipcMain.handle(
      NAVIGATION_COMMAND_CHANNEL,
      async (event: IpcMainInvokeEvent, payload: unknown): Promise<NavigationState> => {
        this.assertUiSender(event);

        if (!isNavigationCommand(payload)) {
          throw new Error('Invalid navigation command payload.');
        }

        return this.executeNavigation(payload);
      },
    );

    ipcMain.handle(
      NAVIGATION_GET_STATE_CHANNEL,
      async (event: IpcMainInvokeEvent): Promise<NavigationState> => {
        this.assertUiSender(event);
        return this.createNavigationState();
      },
    );
  }

  private assertUiSender(event: IpcMainInvokeEvent): void {
    if (!this.uiView || event.sender.id !== this.uiView.webContents.id) {
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
      this.sendNavigationState();
    });

    webContents.on('did-stop-loading', () => {
      this.sendNavigationState();
    });

    webContents.on('did-finish-load', () => {
      this.sendNavigationState();
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
      if (errorCode !== -3) {
        this.lastError = `${errorDescription} (${validatedUrl})`;
        this.sendNavigationState();
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

  private loadUi(): void {
    if (!this.uiView) {
      return;
    }

    this.uiView.webContents.once('did-finish-load', () => {
      this.sendNavigationState();
    });

    if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
      void this.uiView.webContents.loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL);
      return;
    }

    void this.uiView.webContents.loadFile(
      path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`),
    );
  }

  private async loadInitialPage(): Promise<void> {
    await this.navigateTo(
      fixtureFileUrl({
        appPath: app.getAppPath(),
        isPackaged: app.isPackaged,
        resourcesPath: process.resourcesPath,
      }),
    );
  }

  private layoutViews(): void {
    if (!this.window || !this.uiView || !this.pageView) {
      return;
    }

    const [width, height] = this.window.getContentSize();
    this.uiView.setBounds({
      x: 0,
      y: 0,
      width,
      height: CHROME_HEIGHT,
    });
    this.pageView.setBounds({
      x: 0,
      y: CHROME_HEIGHT,
      width,
      height: Math.max(height - CHROME_HEIGHT, 0),
    });
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

  private sendNavigationState(): void {
    if (!this.uiView || this.uiView.webContents.isDestroyed()) {
      return;
    }

    this.uiView.webContents.send(NAVIGATION_STATE_CHANNEL, this.createNavigationState());
  }

  private destroyWindow(): void {
    this.closeManagedView(this.pageView);
    this.closeManagedView(this.uiView);
    this.pageView = null;
    this.uiView = null;
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
