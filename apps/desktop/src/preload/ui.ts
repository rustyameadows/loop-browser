import { clipboard, contextBridge, ipcRenderer } from 'electron';
import {
  CHROME_APPEARANCE_BROWSE_ICON_CHANNEL,
  CHROME_APPEARANCE_COMMAND_CHANNEL,
  CHROME_APPEARANCE_GET_STATE_CHANNEL,
  CHROME_APPEARANCE_STATE_CHANNEL,
  FEEDBACK_COMMAND_CHANNEL,
  FEEDBACK_GET_STATE_CHANNEL,
  FEEDBACK_STATE_CHANNEL,
  MCP_VIEW_COMMAND_CHANNEL,
  MCP_VIEW_GET_STATE_CHANNEL,
  MCP_VIEW_STATE_CHANNEL,
  MARKDOWN_VIEW_COMMAND_CHANNEL,
  MARKDOWN_VIEW_GET_STATE_CHANNEL,
  MARKDOWN_VIEW_STATE_CHANNEL,
  NAVIGATION_COMMAND_CHANNEL,
  NAVIGATION_GET_STATE_CHANNEL,
  NAVIGATION_STATE_CHANNEL,
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
  type ChromeAppearanceCommand,
  type ChromeAppearanceState,
  type FeedbackCommand,
  type FeedbackState,
  type McpViewCommand,
  type McpViewState,
  type MarkdownViewCommand,
  type MarkdownViewState,
  type NavigationBridge,
  type NavigationCommand,
  type SessionCommand,
  type SessionViewState,
  type PickerCommand,
  type PickerState,
  type NavigationState,
  type ProjectAgentLoginSaveRequest,
  type ProjectAgentLoginState,
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
  executeSession(command: SessionCommand): Promise<SessionViewState> {
    return ipcRenderer.invoke(SESSION_COMMAND_CHANNEL, command) as Promise<SessionViewState>;
  },
  getSessionState(): Promise<SessionViewState> {
    return ipcRenderer.invoke(SESSION_GET_STATE_CHANNEL) as Promise<SessionViewState>;
  },
  subscribeSessions(listener: (state: SessionViewState) => void): () => void {
    const wrapped = (_event: Electron.IpcRendererEvent, state: SessionViewState): void => {
      listener(state);
    };

    ipcRenderer.on(SESSION_STATE_CHANNEL, wrapped);
    return () => {
      ipcRenderer.removeListener(SESSION_STATE_CHANNEL, wrapped);
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
  executeMarkdownView(command: MarkdownViewCommand): Promise<MarkdownViewState> {
    return ipcRenderer.invoke(
      MARKDOWN_VIEW_COMMAND_CHANNEL,
      command,
    ) as Promise<MarkdownViewState>;
  },
  getMarkdownViewState(): Promise<MarkdownViewState> {
    return ipcRenderer.invoke(MARKDOWN_VIEW_GET_STATE_CHANNEL) as Promise<MarkdownViewState>;
  },
  subscribeMarkdownView(listener: (state: MarkdownViewState) => void): () => void {
    const wrapped = (_event: Electron.IpcRendererEvent, state: MarkdownViewState): void => {
      listener(state);
    };

    ipcRenderer.on(MARKDOWN_VIEW_STATE_CHANNEL, wrapped);
    return () => {
      ipcRenderer.removeListener(MARKDOWN_VIEW_STATE_CHANNEL, wrapped);
    };
  },
  executeMcpView(command: McpViewCommand): Promise<McpViewState> {
    return ipcRenderer.invoke(MCP_VIEW_COMMAND_CHANNEL, command) as Promise<McpViewState>;
  },
  getMcpViewState(): Promise<McpViewState> {
    return ipcRenderer.invoke(MCP_VIEW_GET_STATE_CHANNEL) as Promise<McpViewState>;
  },
  subscribeMcpView(listener: (state: McpViewState) => void): () => void {
    const wrapped = (_event: Electron.IpcRendererEvent, state: McpViewState): void => {
      listener(state);
    };

    ipcRenderer.on(MCP_VIEW_STATE_CHANNEL, wrapped);
    return () => {
      ipcRenderer.removeListener(MCP_VIEW_STATE_CHANNEL, wrapped);
    };
  },
  executeChromeAppearance(command: ChromeAppearanceCommand): Promise<ChromeAppearanceState> {
    return ipcRenderer.invoke(
      CHROME_APPEARANCE_COMMAND_CHANNEL,
      command,
    ) as Promise<ChromeAppearanceState>;
  },
  getChromeAppearanceState(): Promise<ChromeAppearanceState> {
    return ipcRenderer.invoke(CHROME_APPEARANCE_GET_STATE_CHANNEL) as Promise<ChromeAppearanceState>;
  },
  subscribeChromeAppearance(listener: (state: ChromeAppearanceState) => void): () => void {
    const wrapped = (_event: Electron.IpcRendererEvent, state: ChromeAppearanceState): void => {
      listener(state);
    };

    ipcRenderer.on(CHROME_APPEARANCE_STATE_CHANNEL, wrapped);
    return () => {
      ipcRenderer.removeListener(CHROME_APPEARANCE_STATE_CHANNEL, wrapped);
    };
  },
  browseProjectIcon(): Promise<string | null> {
    return ipcRenderer.invoke(CHROME_APPEARANCE_BROWSE_ICON_CHANNEL) as Promise<string | null>;
  },
  getProjectAgentLoginState(): Promise<ProjectAgentLoginState> {
    return ipcRenderer.invoke(
      PROJECT_AGENT_LOGIN_GET_STATE_CHANNEL,
    ) as Promise<ProjectAgentLoginState>;
  },
  subscribeProjectAgentLogin(listener: (state: ProjectAgentLoginState) => void): () => void {
    const wrapped = (_event: Electron.IpcRendererEvent, state: ProjectAgentLoginState): void => {
      listener(state);
    };

    ipcRenderer.on(PROJECT_AGENT_LOGIN_STATE_CHANNEL, wrapped);
    return () => {
      ipcRenderer.removeListener(PROJECT_AGENT_LOGIN_STATE_CHANNEL, wrapped);
    };
  },
  saveProjectAgentLogin(request: ProjectAgentLoginSaveRequest): Promise<ProjectAgentLoginState> {
    return ipcRenderer.invoke(
      PROJECT_AGENT_LOGIN_SAVE_CHANNEL,
      request,
    ) as Promise<ProjectAgentLoginState>;
  },
  clearProjectAgentLogin(): Promise<ProjectAgentLoginState> {
    return ipcRenderer.invoke(
      PROJECT_AGENT_LOGIN_CLEAR_CHANNEL,
    ) as Promise<ProjectAgentLoginState>;
  },
  executeFeedback(command: FeedbackCommand): Promise<FeedbackState> {
    return ipcRenderer.invoke(FEEDBACK_COMMAND_CHANNEL, command) as Promise<FeedbackState>;
  },
  getFeedbackState(): Promise<FeedbackState> {
    return ipcRenderer.invoke(FEEDBACK_GET_STATE_CHANNEL) as Promise<FeedbackState>;
  },
  subscribeFeedback(listener: (state: FeedbackState) => void): () => void {
    const wrapped = (_event: Electron.IpcRendererEvent, state: FeedbackState): void => {
      listener(state);
    };

    ipcRenderer.on(FEEDBACK_STATE_CHANNEL, wrapped);
    return () => {
      ipcRenderer.removeListener(FEEDBACK_STATE_CHANNEL, wrapped);
    };
  },
  copyText(value: string): void {
    clipboard.writeText(value);
  },
};

contextBridge.exposeInMainWorld('agentBrowser', navigationBridge);
