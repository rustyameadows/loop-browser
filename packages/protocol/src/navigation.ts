import type { McpAgentActivityPhase, McpViewCommand, McpViewState } from './mcp';
import type { MarkdownViewCommand, MarkdownViewState } from './markdown';
import type { FeedbackCommand, FeedbackState } from './feedback';
import type { ChromeAppearanceCommand, ChromeAppearanceState } from './appearance';
import type { StyleViewCommand, StyleViewState } from './style';
import type {
  ProjectAgentLoginSaveRequest,
  ProjectAgentLoginState,
} from './agent-login';
import type { SessionCommand, SessionViewState } from './session';

export const NAVIGATION_COMMAND_CHANNEL = 'navigation:command';
export const NAVIGATION_GET_STATE_CHANNEL = 'navigation:get-state';
export const NAVIGATION_STATE_CHANNEL = 'navigation:state';
export const PICKER_COMMAND_CHANNEL = 'picker:command';
export const PICKER_GET_STATE_CHANNEL = 'picker:get-state';
export const PICKER_STATE_CHANNEL = 'picker:state';
export const PAGE_PICKER_CONTROL_CHANNEL = 'page-picker:control';
export const PAGE_PICKER_EVENT_CHANNEL = 'page-picker:event';
export const PAGE_AGENT_OVERLAY_CHANNEL = 'page-agent:overlay';
export const PAGE_LOGIN_CONTROL_CHANNEL = 'page-login:control';
export const PAGE_LOGIN_EVENT_CHANNEL = 'page-login:event';

export const navigationActions = [
  'navigate',
  'reload',
  'stop',
  'back',
  'forward',
  'useAgentLogin',
] as const;
export const pickerActions = ['enable', 'disable', 'toggle', 'clearSelection'] as const;
export const pickerIntents = ['feedback', 'style'] as const;

export type NavigationAction = (typeof navigationActions)[number];
export type PickerAction = (typeof pickerActions)[number];
export type PickerIntent = (typeof pickerIntents)[number];

export type NavigationCommand =
  | {
      action: 'navigate';
      target: string;
    }
  | {
      action: Exclude<NavigationAction, 'navigate'>;
    };

export interface BoundingBox {
  x: number;
  y: number;
  width: number;
  height: number;
  devicePixelRatio: number;
}

export interface FrameMetadata {
  url: string;
  isMainFrame: boolean;
}

export interface ElementDescriptor {
  selector: string;
  xpath: string | null;
  tag: string;
  id: string | null;
  classList: string[];
  role: string | null;
  accessibleName: string | null;
  playwrightLocator: string | null;
  textSnippet: string;
  bbox: BoundingBox;
  attributes: Record<string, string>;
  outerHTMLExcerpt: string;
  frame: FrameMetadata;
}

export interface PickerState {
  enabled: boolean;
  intent: PickerIntent;
  lastSelection: ElementDescriptor | null;
}

export type PickerCommand = {
  action: PickerAction;
  intent?: PickerIntent;
};

export type PagePickerControl =
  | {
      action: 'enable';
      intent: PickerIntent;
    }
  | {
      action: 'disable';
    };

export type PagePickerEvent =
  | {
      type: 'selection';
      intent: PickerIntent;
      descriptor: ElementDescriptor;
    }
  | {
      type: 'cancelled';
    };

export type PageLoginControl = {
  action: 'fill';
  username: string;
  password: string;
};

export type PageLoginEvent = {
  type: 'availability';
  hasVisibleLoginForm: boolean;
};

export interface PageAgentOverlayState {
  annotationId: string;
  selection: ElementDescriptor;
  phase: McpAgentActivityPhase;
  message: string;
  updatedAt: string;
  sourceUrl: string;
}

export interface AgentLoginCtaState {
  visible: boolean;
  enabled: boolean;
  reason: string | null;
}

export interface NavigationState {
  url: string;
  title: string;
  isLoading: boolean;
  canGoBack: boolean;
  canGoForward: boolean;
  agentLoginCta: AgentLoginCtaState;
  lastError: string | null;
}

export interface NavigationBridge {
  execute(command: NavigationCommand): Promise<NavigationState>;
  getState(): Promise<NavigationState>;
  subscribe(listener: (state: NavigationState) => void): () => void;
  executeSession(command: SessionCommand): Promise<SessionViewState>;
  getSessionState(): Promise<SessionViewState>;
  subscribeSessions(listener: (state: SessionViewState) => void): () => void;
  executePicker(command: PickerCommand): Promise<PickerState>;
  getPickerState(): Promise<PickerState>;
  subscribePicker(listener: (state: PickerState) => void): () => void;
  executeMarkdownView(command: MarkdownViewCommand): Promise<MarkdownViewState>;
  getMarkdownViewState(): Promise<MarkdownViewState>;
  subscribeMarkdownView(listener: (state: MarkdownViewState) => void): () => void;
  executeMcpView(command: McpViewCommand): Promise<McpViewState>;
  getMcpViewState(): Promise<McpViewState>;
  subscribeMcpView(listener: (state: McpViewState) => void): () => void;
  executeStyleView(command: StyleViewCommand): Promise<StyleViewState>;
  getStyleViewState(): Promise<StyleViewState>;
  subscribeStyleView(listener: (state: StyleViewState) => void): () => void;
  executeChromeAppearance(command: ChromeAppearanceCommand): Promise<ChromeAppearanceState>;
  getChromeAppearanceState(): Promise<ChromeAppearanceState>;
  subscribeChromeAppearance(listener: (state: ChromeAppearanceState) => void): () => void;
  browseProjectIcon(): Promise<string | null>;
  getProjectAgentLoginState(): Promise<ProjectAgentLoginState>;
  subscribeProjectAgentLogin(listener: (state: ProjectAgentLoginState) => void): () => void;
  saveProjectAgentLogin(
    request: ProjectAgentLoginSaveRequest,
  ): Promise<ProjectAgentLoginState>;
  clearProjectAgentLogin(): Promise<ProjectAgentLoginState>;
  executeFeedback(command: FeedbackCommand): Promise<FeedbackState>;
  getFeedbackState(): Promise<FeedbackState>;
  subscribeFeedback(listener: (state: FeedbackState) => void): () => void;
  copyText(value: string): void;
}

export const createEmptyNavigationState = (): NavigationState => ({
  url: '',
  title: 'Loop Browser',
  isLoading: false,
  canGoBack: false,
  canGoForward: false,
  agentLoginCta: {
    visible: false,
    enabled: false,
    reason: null,
  },
  lastError: null,
});

export const createEmptyPickerState = (): PickerState => ({
  enabled: false,
  intent: 'feedback',
  lastSelection: null,
});

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const isPlainStringRecord = (value: unknown): value is Record<string, string> => {
  if (!isRecord(value)) {
    return false;
  }

  return Object.values(value).every((entry) => typeof entry === 'string');
};

const isBoundingBox = (value: unknown): value is BoundingBox => {
  if (!isRecord(value)) {
    return false;
  }

  return (
    typeof value.x === 'number' &&
    typeof value.y === 'number' &&
    typeof value.width === 'number' &&
    typeof value.height === 'number' &&
    typeof value.devicePixelRatio === 'number'
  );
};

const isFrameMetadata = (value: unknown): value is FrameMetadata => {
  if (!isRecord(value)) {
    return false;
  }

  return typeof value.url === 'string' && typeof value.isMainFrame === 'boolean';
};

export const isNavigationCommand = (value: unknown): value is NavigationCommand => {
  if (!isRecord(value) || typeof value.action !== 'string') {
    return false;
  }

  if (!navigationActions.includes(value.action as NavigationAction)) {
    return false;
  }

  if (value.action === 'navigate') {
    return typeof value.target === 'string' && value.target.trim().length > 0;
  }

  return !('target' in value) || value.target === undefined;
};

export const isElementDescriptor = (value: unknown): value is ElementDescriptor => {
  if (!isRecord(value)) {
    return false;
  }

  return (
    typeof value.selector === 'string' &&
    (typeof value.xpath === 'string' || value.xpath === null) &&
    typeof value.tag === 'string' &&
    (typeof value.id === 'string' || value.id === null) &&
    Array.isArray(value.classList) &&
    value.classList.every((entry) => typeof entry === 'string') &&
    (typeof value.role === 'string' || value.role === null) &&
    (typeof value.accessibleName === 'string' || value.accessibleName === null) &&
    (typeof value.playwrightLocator === 'string' || value.playwrightLocator === null) &&
    typeof value.textSnippet === 'string' &&
    isBoundingBox(value.bbox) &&
    isPlainStringRecord(value.attributes) &&
    typeof value.outerHTMLExcerpt === 'string' &&
    isFrameMetadata(value.frame)
  );
};

export const isPickerCommand = (value: unknown): value is PickerCommand => {
  if (!isRecord(value) || typeof value.action !== 'string') {
    return false;
  }

  if (!pickerActions.includes(value.action as PickerAction)) {
    return false;
  }

  return !('intent' in value) || value.intent === undefined || pickerIntents.includes(value.intent as PickerIntent);
};

export const isPickerState = (value: unknown): value is PickerState => {
  if (!isRecord(value)) {
    return false;
  }

  return (
    typeof value.enabled === 'boolean' &&
    typeof value.intent === 'string' &&
    pickerIntents.includes(value.intent as PickerIntent) &&
    (value.lastSelection === null || isElementDescriptor(value.lastSelection))
  );
};

export const isPagePickerControl = (value: unknown): value is PagePickerControl => {
  if (!isRecord(value) || typeof value.action !== 'string') {
    return false;
  }

  if (value.action === 'disable') {
    return true;
  }

  return value.action === 'enable' && pickerIntents.includes(value.intent as PickerIntent);
};

export const isPagePickerEvent = (value: unknown): value is PagePickerEvent => {
  if (!isRecord(value) || typeof value.type !== 'string') {
    return false;
  }

  if (value.type === 'cancelled') {
    return true;
  }

  return (
    value.type === 'selection' &&
    typeof value.intent === 'string' &&
    pickerIntents.includes(value.intent as PickerIntent) &&
    isElementDescriptor(value.descriptor)
  );
};

export const isPageLoginControl = (value: unknown): value is PageLoginControl => {
  if (!isRecord(value) || typeof value.action !== 'string') {
    return false;
  }

  return (
    value.action === 'fill' &&
    typeof value.username === 'string' &&
    typeof value.password === 'string'
  );
};

export const isPageLoginEvent = (value: unknown): value is PageLoginEvent => {
  if (!isRecord(value) || typeof value.type !== 'string') {
    return false;
  }

  return value.type === 'availability' && typeof value.hasVisibleLoginForm === 'boolean';
};

export const isPageAgentOverlayState = (value: unknown): value is PageAgentOverlayState => {
  if (!isRecord(value)) {
    return false;
  }

  return (
    typeof value.annotationId === 'string' &&
    isElementDescriptor(value.selection) &&
    (value.phase === 'acknowledged' ||
      value.phase === 'in_progress' ||
      value.phase === 'done') &&
    typeof value.message === 'string' &&
    typeof value.updatedAt === 'string' &&
    typeof value.sourceUrl === 'string'
  );
};

export const isNavigationState = (value: unknown): value is NavigationState => {
  if (!isRecord(value)) {
    return false;
  }

  return (
    typeof value.url === 'string' &&
    typeof value.title === 'string' &&
    typeof value.isLoading === 'boolean' &&
    typeof value.canGoBack === 'boolean' &&
    typeof value.canGoForward === 'boolean' &&
    isRecord(value.agentLoginCta) &&
    typeof value.agentLoginCta.visible === 'boolean' &&
    typeof value.agentLoginCta.enabled === 'boolean' &&
    (typeof value.agentLoginCta.reason === 'string' || value.agentLoginCta.reason === null) &&
    (typeof value.lastError === 'string' || value.lastError === null)
  );
};
