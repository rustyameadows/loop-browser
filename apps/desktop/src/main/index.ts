import { app } from 'electron';
import { BrowserShell } from './browser-shell';

app.setName('Agent Browser');

const browserShell = new BrowserShell();

app.whenReady().then(() => {
  browserShell.ensureWindow();

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
  browserShell.dispose();
});

