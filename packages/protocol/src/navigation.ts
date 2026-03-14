import type { McpViewCommand, McpViewState } from './mcp';
import type { MarkdownViewCommand, MarkdownViewState } from './markdown';
import type { FeedbackCommand, FeedbackState } from './feedback';

export const NAVIGATION_COMMAND_CHANNEL = 'navigation:command';
export const NAVIGATION_GET_STATE_CHANNEL = 'navigation:get-state';
export const NAVIGATION_STATE_CHANNEL = 'navigation:state';
export const PICKER_COMMAND_CHANNEL = 'picker:command';
export const PICKER_GET_STATE_CHANNEL = 'picker:get-state';
export const PICKER_STATE_CHANNEL = 'picker:state';
export const PAGE_PICKER_CONTROL_CHANNEL = 'page-picker:control';
export const PAGE_PICKER_EVENT_CHANNEL = 'page-picker:event';

export const navigationActions = ['navigate', 'reload', 'stop', 'back', 'forward'] as const;
export const pickerActions = ['enable', 'disable', 'toggle', 'clearSelection'] as const;

export type NavigationAction = (typeof navigationActions)[number];
export type PickerAction = (typeof pickerActions)[number];

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
  lastSelection: ElementDescriptor | null;
}

export type PickerCommand = {
  action: PickerAction;
};

export type PagePickerControl =
  | {
      action: 'enable';
    }
  | {
      action: 'disable';
    };

export type PagePickerEvent =
  | {
      type: 'selection';
      descriptor: ElementDescriptor;
    }
  | {
      type: 'cancelled';
    };

export interface NavigationState {
  url: string;
  title: string;
  isLoading: boolean;
  canGoBack: boolean;
  canGoForward: boolean;
  lastError: string | null;
}

export interface NavigationBridge {
  execute(command: NavigationCommand): Promise<NavigationState>;
  getState(): Promise<NavigationState>;
  subscribe(listener: (state: NavigationState) => void): () => void;
  executePicker(command: PickerCommand): Promise<PickerState>;
  getPickerState(): Promise<PickerState>;
  subscribePicker(listener: (state: PickerState) => void): () => void;
  executeMarkdownView(command: MarkdownViewCommand): Promise<MarkdownViewState>;
  getMarkdownViewState(): Promise<MarkdownViewState>;
  subscribeMarkdownView(listener: (state: MarkdownViewState) => void): () => void;
  executeMcpView(command: McpViewCommand): Promise<McpViewState>;
  getMcpViewState(): Promise<McpViewState>;
  subscribeMcpView(listener: (state: McpViewState) => void): () => void;
  executeFeedback(command: FeedbackCommand): Promise<FeedbackState>;
  getFeedbackState(): Promise<FeedbackState>;
  subscribeFeedback(listener: (state: FeedbackState) => void): () => void;
  copyText(value: string): void;
}

export const createEmptyNavigationState = (): NavigationState => ({
  url: '',
  title: 'Agent Browser',
  isLoading: false,
  canGoBack: false,
  canGoForward: false,
  lastError: null,
});

export const createEmptyPickerState = (): PickerState => ({
  enabled: false,
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

  return pickerActions.includes(value.action as PickerAction);
};

export const isPickerState = (value: unknown): value is PickerState => {
  if (!isRecord(value)) {
    return false;
  }

  return (
    typeof value.enabled === 'boolean' &&
    (value.lastSelection === null || isElementDescriptor(value.lastSelection))
  );
};

export const isPagePickerControl = (value: unknown): value is PagePickerControl => {
  if (!isRecord(value) || typeof value.action !== 'string') {
    return false;
  }

  return value.action === 'enable' || value.action === 'disable';
};

export const isPagePickerEvent = (value: unknown): value is PagePickerEvent => {
  if (!isRecord(value) || typeof value.type !== 'string') {
    return false;
  }

  if (value.type === 'cancelled') {
    return true;
  }

  return value.type === 'selection' && isElementDescriptor(value.descriptor);
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
    (typeof value.lastError === 'string' || value.lastError === null)
  );
};
