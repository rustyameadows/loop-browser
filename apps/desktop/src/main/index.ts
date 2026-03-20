import path from 'node:path';
import { readFileSync } from 'node:fs';
import { app } from 'electron';
import { createEmptyChromeAppearanceState, type SessionSummary } from '@agent-browser/protocol';
import { BrowserShell } from './browser-shell';
import { installAppMenu } from './menu';
import {
  PROJECT_SELECTION_FILE_NAME,
  ProjectAppearanceController,
  createProjectAppearanceState,
  deriveProjectSessionSlug,
  type ProjectAppearanceRuntime,
} from './project-appearance';
import { ProjectAgentLoginController } from './project-agent-login';
import { resolveRuntimeConfig } from './runtime-config';
import {
  deriveClusterDir,
  LOOP_BROWSER_CLUSTER_DIR_ENV,
  ProjectSessionAdvertiser,
  SessionDirectoryController,
} from './session-manager';
import { SessionBrokerRuntime } from './session-broker-runtime';
import {
  ToolServer,
  type ToolServerConnectionInfo,
  type ToolServerRuntime,
} from './tool-server';

app.setName('Loop Browser');

if (process.env.LOOP_BROWSER_USE_MOCK_KEYCHAIN === '1') {
  app.commandLine.appendSwitch('use-mock-keychain');
}

const runtimeConfig = resolveRuntimeConfig(process.env);
const clusterDir =
  process.env[LOOP_BROWSER_CLUSTER_DIR_ENV] || deriveClusterDir(app.getPath('appData'));

const loadRegistrationConnectionInfo = (
  registrationFile: string,
): ToolServerConnectionInfo | null => {
  try {
    const payload = JSON.parse(readFileSync(registrationFile, 'utf8')) as {
      transport?: {
        url?: unknown;
        headers?: {
          Authorization?: unknown;
        };
      };
    };
    const url = payload.transport?.url;
    const authorization = payload.transport?.headers?.Authorization;
    if (typeof url !== 'string' || typeof authorization !== 'string') {
      return null;
    }

    const match = authorization.match(/^Bearer\s+(.+)$/);
    if (!match || match[1].trim().length === 0) {
      return null;
    }

    return {
      url,
      token: match[1].trim(),
      registrationFile,
    };
  } catch {
    return null;
  }
};

if (runtimeConfig.role === 'project-session' && runtimeConfig.userDataDir) {
  app.setPath('userData', runtimeConfig.userDataDir);
}

const createLauncherAppearanceRuntime = (): ProjectAppearanceRuntime => {
  let state = createProjectAppearanceState(null);
  const listeners = new Set<(nextState: typeof state) => void>();

  const emit = (): void => {
    const snapshot = { ...state };
    for (const listener of listeners) {
      listener(snapshot);
    }
  };

  return {
    getState: () => ({ ...state }),
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    selectProject: async () => ({ ...state }),
    setAppearance: async () => {
      state = {
        ...createEmptyChromeAppearanceState(),
        lastError: 'Project appearance is only available inside a project session window.',
      };
      emit();
      return { ...state };
    },
    resetAppearance: async () => ({ ...state }),
    dispose: () => {
      listeners.clear();
    },
  };
};

const createProjectSessionBootstrap = (): {
  browserShell: BrowserShell;
  toolServer: ToolServer;
  sessionController: SessionDirectoryController;
  projectAppearanceStore: ProjectAppearanceController;
  start(): Promise<void>;
  stop(): Promise<void>;
} => {
  if (!runtimeConfig.projectRoot) {
    throw new Error('Project session role requires AGENT_BROWSER_PROJECT_ROOT.');
  }

  const sessionId = deriveProjectSessionSlug(runtimeConfig.projectRoot);
  const projectAppearanceStore = new ProjectAppearanceController(
    path.join(app.getPath('userData'), PROJECT_SELECTION_FILE_NAME),
    runtimeConfig.projectRoot,
  );
  const projectAgentLoginStore = new ProjectAgentLoginController(runtimeConfig.projectRoot);
  const launcherRegistrationFile = path.join(clusterDir, 'mcp-registration.json');
  const launcherConnectionInfo = loadRegistrationConnectionInfo(launcherRegistrationFile);
  const sessionController = new SessionDirectoryController({
    role: 'project-session',
    clusterDir,
    currentSessionId: sessionId,
  });
  const browserShell = new BrowserShell({
    initialUrl: runtimeConfig.startUrl ?? undefined,
    projectAppearance: projectAppearanceStore,
    projectAgentLogin: projectAgentLoginStore,
    sessionRuntime: sessionController,
    role: 'project-session',
  });
  const buildLocalSessionSummary = (): SessionSummary => {
    const advertisedSummary = sessionController.getSessionRecord(sessionId)?.summary;
    if (advertisedSummary) {
      return advertisedSummary;
    }

    const appearance = browserShell.getChromeAppearanceState();
    return {
      sessionId,
      projectRoot: runtimeConfig.projectRoot!,
      projectName: path.basename(runtimeConfig.projectRoot!) || 'Project',
      chromeColor: appearance.chromeColor,
      projectIconPath: appearance.projectIconPath,
      isFocused: browserShell.isWindowFocused(),
      isHome: false,
      dockIconStatus: appearance.dockIconStatus,
      status: 'ready',
    };
  };
  const projectSessionRuntime: ToolServerRuntime = {
    listTabs: () => browserShell.listTabs(),
    executeNavigationCommand: (command) => browserShell.executeNavigationCommand(command),
    executePickerCommand: (command) => browserShell.executePickerCommand(command),
    getPickerState: () => browserShell.getPickerState(),
    executeChromeAppearanceCommand: (command) => browserShell.executeChromeAppearanceCommand(command),
    getChromeAppearanceState: () => browserShell.getChromeAppearanceState(),
    executeFeedbackCommand: (command) => browserShell.executeFeedbackCommand(command),
    getFeedbackState: () => browserShell.getFeedbackState(),
    getMarkdownForCurrentPage: (forceRefresh) => browserShell.getMarkdownForCurrentPage(forceRefresh),
    getWindowState: () => browserShell.getWindowState(),
    resizeWindow: (request) => browserShell.resizeWindow(request),
    captureScreenshot: (request) => browserShell.captureScreenshot(request),
    listSessions: async () => [buildLocalSessionSummary()],
    getCurrentSession: async () => buildLocalSessionSummary(),
  };
  const toolServer = new ToolServer({
    runtime: projectSessionRuntime,
    storageDir: app.getPath('userData'),
    port: runtimeConfig.toolServerPort,
    internalControl: {
      focusWindow: () => browserShell.focusWindow(),
      closeWindow: () => browserShell.closeWindow(),
    },
    setupConnectionInfo: launcherConnectionInfo,
    setupConnectionLabel: launcherConnectionInfo ? 'Launcher broker' : 'This window',
  });
  let advertiser: ProjectSessionAdvertiser | null = null;

  browserShell.attachMcpDiagnostics({
    getDiagnostics: () => toolServer.getDiagnostics(),
    subscribe: (listener) => toolServer.subscribe(listener),
    runSelfTest: () => toolServer.runSelfTest(),
  });

  return {
    browserShell,
    toolServer,
    sessionController,
    projectAppearanceStore,
    async start(): Promise<void> {
      await sessionController.start();
      browserShell.ensureWindow();
      const connection = await toolServer.start();
      advertiser = new ProjectSessionAdvertiser({
        clusterDir,
        sessionId,
        browserShell,
        connectionInfo: connection,
        projectRoot: runtimeConfig.projectRoot!,
      });
      await advertiser.start();
      void toolServer.runSelfTest();
    },
    async stop(): Promise<void> {
      await advertiser?.stop();
      await toolServer.stop().catch((error) => {
        console.error('Failed to stop Loop Browser project session tool server cleanly.', error);
      });
      await sessionController.dispose();
      projectAgentLoginStore.dispose();
      projectAppearanceStore.dispose();
      browserShell.dispose();
    },
  };
};

const createLauncherBootstrap = (): {
  browserShell: BrowserShell;
  toolServer: ToolServer;
  sessionController: SessionDirectoryController;
  start(): Promise<void>;
  stop(): Promise<void>;
} => {
  const sessionController = new SessionDirectoryController({
    role: 'launcher',
    clusterDir,
    currentSessionId: null,
  });
  const browserShell = new BrowserShell({
    initialUrl: runtimeConfig.startUrl ?? undefined,
    projectAppearance: createLauncherAppearanceRuntime(),
    sessionRuntime: sessionController,
    role: 'launcher',
  });
  const toolServer = new ToolServer({
    runtime: new SessionBrokerRuntime(sessionController),
    storageDir: clusterDir,
    port: runtimeConfig.toolServerPort,
    requireSessionId: true,
    includeSessionTools: true,
  });

  browserShell.attachMcpDiagnostics({
    getDiagnostics: () => toolServer.getDiagnostics(),
    subscribe: (listener) => toolServer.subscribe(listener),
    runSelfTest: () => toolServer.runSelfTest(),
  });

  return {
    browserShell,
    toolServer,
    sessionController,
    async start(): Promise<void> {
      await sessionController.start();
      await toolServer.start();
      void toolServer.runSelfTest();
      if (runtimeConfig.projectRoot) {
        await sessionController.executeCommand({
          action: 'openProject',
          projectRoot: runtimeConfig.projectRoot,
        });
        return;
      }

      browserShell.ensureWindow();
    },
    async stop(): Promise<void> {
      await toolServer.stop().catch((error) => {
        console.error('Failed to stop Loop Browser launcher tool server cleanly.', error);
      });
      await sessionController.dispose();
      browserShell.dispose();
    },
  };
};

const bootstrap =
  runtimeConfig.role === 'project-session'
    ? createProjectSessionBootstrap()
    : createLauncherBootstrap();

installAppMenu(bootstrap.browserShell);

app.whenReady().then(() => {
  void bootstrap.start().catch((error) => {
    console.error('Failed to start Loop Browser.', error);
  });

  app.on('activate', () => {
    bootstrap.browserShell.ensureWindow();
  });
});

app.on('window-all-closed', () => {
  if (runtimeConfig.role === 'launcher' && process.platform === 'darwin') {
    return;
  }

  app.quit();
});

app.on('before-quit', () => {
  void bootstrap.stop();
});
