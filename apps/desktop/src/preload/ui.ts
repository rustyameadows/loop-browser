import { contextBridge, ipcRenderer } from 'electron';
import {
  NAVIGATION_COMMAND_CHANNEL,
  NAVIGATION_GET_STATE_CHANNEL,
  NAVIGATION_STATE_CHANNEL,
  type NavigationBridge,
  type NavigationCommand,
  type NavigationState,
} from '@agent-browser/protocol';

const navigationBridge: NavigationBridge = {
  execute(command: NavigationCommand): Promise<NavigationState> {
    return ipcRenderer.invoke(NAVIGATION_COMMAND_CHANNEL, command) as Promise<NavigationState>;
  },
  getState(): Promise<NavigationState> {
    return ipcRenderer.invoke(NAVIGATION_GET_STATE_CHANNEL) as Promise<NavigationState>;
  },
  subscribe(listener: (state: NavigationState) => void): () => void {
    const wrapped = (_event: Electron.IpcRendererEvent, state: NavigationState): void => {
      listener(state);
    };

    ipcRenderer.on(NAVIGATION_STATE_CHANNEL, wrapped);
    return () => {
      ipcRenderer.removeListener(NAVIGATION_STATE_CHANNEL, wrapped);
    };
  },
};

contextBridge.exposeInMainWorld('agentBrowser', navigationBridge);

