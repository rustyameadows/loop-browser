import { clipboard, contextBridge, ipcRenderer } from 'electron';
import {
  NAVIGATION_COMMAND_CHANNEL,
  NAVIGATION_GET_STATE_CHANNEL,
  NAVIGATION_STATE_CHANNEL,
  PICKER_COMMAND_CHANNEL,
  PICKER_GET_STATE_CHANNEL,
  PICKER_STATE_CHANNEL,
  type NavigationBridge,
  type NavigationCommand,
  type PickerCommand,
  type PickerState,
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
  executePicker(command: PickerCommand): Promise<PickerState> {
    return ipcRenderer.invoke(PICKER_COMMAND_CHANNEL, command) as Promise<PickerState>;
  },
  getPickerState(): Promise<PickerState> {
    return ipcRenderer.invoke(PICKER_GET_STATE_CHANNEL) as Promise<PickerState>;
  },
  subscribePicker(listener: (state: PickerState) => void): () => void {
    const wrapped = (_event: Electron.IpcRendererEvent, state: PickerState): void => {
      listener(state);
    };

    ipcRenderer.on(PICKER_STATE_CHANNEL, wrapped);
    return () => {
      ipcRenderer.removeListener(PICKER_STATE_CHANNEL, wrapped);
    };
  },
  copyText(value: string): void {
    clipboard.writeText(value);
  },
};

contextBridge.exposeInMainWorld('agentBrowser', navigationBridge);
