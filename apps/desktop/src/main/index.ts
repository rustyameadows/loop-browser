import path from 'node:path';
import { app } from 'electron';
import { BrowserShell } from './browser-shell';
import { installAppMenu } from './menu';
import {
  PROJECT_SELECTION_FILE_NAME,
  ProjectAppearanceController,
} from './project-appearance';
import { resolveRuntimeConfig } from './runtime-config';
import { ToolServer } from './tool-server';

app.setName('Loop Browser');

const runtimeConfig = resolveRuntimeConfig(process.env);
if (runtimeConfig.userDataDir) {
  app.setPath('userData', runtimeConfig.userDataDir);
}

const projectAppearanceStore = new ProjectAppearanceController(
  path.join(app.getPath('userData'), PROJECT_SELECTION_FILE_NAME),
  runtimeConfig.projectRoot,
);

const browserShell = new BrowserShell({
  initialUrl: runtimeConfig.startUrl ?? undefined,
  projectAppearance: projectAppearanceStore,
});
const toolServer = new ToolServer({
  runtime: browserShell,
  storageDir: app.getPath('userData'),
  port: runtimeConfig.toolServerPort,
});
browserShell.attachMcpDiagnostics({
  getDiagnostics: () => toolServer.getDiagnostics(),
  subscribe: (listener) => toolServer.subscribe(listener),
  runSelfTest: () => toolServer.runSelfTest(),
});
installAppMenu(browserShell);

app.whenReady().then(() => {
  browserShell.ensureWindow();
  void toolServer
    .start()
    .then(() => toolServer.runSelfTest())
    .catch((error) => {
      const message =
        error instanceof Error ? error.message : 'Failed to start Loop Browser tool server.';
      toolServer.reportLifecycleError(message);
      console.error('Failed to start Loop Browser tool server.', error);
    });

  app.on('activate', () => {
    browserShell.ensureWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', () => {
  void toolServer.stop().catch((error) => {
    const message =
      error instanceof Error ? error.message : 'Failed to stop Loop Browser tool server cleanly.';
    toolServer.reportLifecycleError(message);
    console.error('Failed to stop Loop Browser tool server cleanly.', error);
  });
  projectAppearanceStore.dispose();
  browserShell.dispose();
});
