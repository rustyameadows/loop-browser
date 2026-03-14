import { app } from 'electron';
import { BrowserShell } from './browser-shell';
import { installAppMenu } from './menu';
import { resolveRuntimeConfig } from './runtime-config';
import { ToolServer } from './tool-server';

app.setName('Agent Browser');

const runtimeConfig = resolveRuntimeConfig(process.env);

if (runtimeConfig.userDataDir) {
  app.setPath('userData', runtimeConfig.userDataDir);
}

const browserShell = new BrowserShell({
  initialUrl: runtimeConfig.startUrl ?? undefined,
});
const toolServer = new ToolServer({
  runtime: browserShell,
  storageDir: app.getPath('userData'),
  port: runtimeConfig.toolServerPort,
});
installAppMenu(browserShell);

app.whenReady().then(() => {
  browserShell.ensureWindow();
  void toolServer.start().catch((error) => {
    console.error('Failed to start Agent Browser tool server.', error);
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
    console.error('Failed to stop Agent Browser tool server cleanly.', error);
  });
  browserShell.dispose();
});
