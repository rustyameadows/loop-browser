import { Menu, type MenuItemConstructorOptions, app } from 'electron';
import type { BrowserShell } from './browser-shell';

export const installAppMenu = (browserShell: BrowserShell): void => {
  const template: MenuItemConstructorOptions[] = [];

  const appSubmenu: MenuItemConstructorOptions[] = [
    { role: 'about' },
    { type: 'separator' },
    { role: 'services' },
    { type: 'separator' },
    { role: 'hide' },
    { role: 'hideOthers' },
    { role: 'unhide' },
    { type: 'separator' },
    { role: 'quit' },
  ];

  const editSubmenu: MenuItemConstructorOptions[] = [
    { role: 'undo' },
    { role: 'redo' },
    { type: 'separator' },
    { role: 'cut' },
    { role: 'copy' },
    { role: 'paste' },
    { role: 'selectAll' },
  ];

  const viewSubmenu: MenuItemConstructorOptions[] = [
    {
      label: 'Reload Page',
      accelerator: 'CmdOrCtrl+R',
      click: () => browserShell.reloadPage(),
    },
    {
      label: 'Reload Page Ignoring Cache',
      accelerator: 'CmdOrCtrl+Shift+R',
      click: () => browserShell.reloadPage(true),
    },
    { type: 'separator' },
    {
      label: 'Toggle Page DevTools',
      accelerator: 'Alt+CmdOrCtrl+I',
      click: () => browserShell.togglePageDevTools(),
    },
    {
      label: 'Toggle Chrome DevTools',
      accelerator: 'Alt+CmdOrCtrl+Shift+I',
      click: () => browserShell.toggleChromeDevTools(),
    },
    {
      label: 'Toggle Pick Mode',
      accelerator: 'Alt+CmdOrCtrl+P',
      click: () => browserShell.togglePicker(),
    },
    {
      label: 'Toggle Markdown View',
      accelerator: 'Alt+CmdOrCtrl+M',
      click: () => browserShell.toggleMarkdownView(),
    },
    {
      label: 'Toggle MCP View',
      accelerator: 'Alt+CmdOrCtrl+J',
      click: () => browserShell.toggleMcpView(),
    },
    { type: 'separator' },
    { role: 'resetZoom' },
    { role: 'zoomIn' },
    { role: 'zoomOut' },
    { type: 'separator' },
    { role: 'togglefullscreen' },
  ];

  const windowSubmenu: MenuItemConstructorOptions[] = [{ role: 'minimize' }, { role: 'zoom' }];

  if (process.platform === 'darwin') {
    template.push({
      label: app.name,
      submenu: appSubmenu,
    });
    windowSubmenu.push({ role: 'front' });
  }

  windowSubmenu.push({ role: 'close' });

  template.push(
    {
      label: 'Edit',
      submenu: editSubmenu,
    },
    {
      label: 'View',
      submenu: viewSubmenu,
    },
    {
      label: 'Window',
      submenu: windowSubmenu,
    },
  );

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
};
