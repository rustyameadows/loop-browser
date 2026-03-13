export const NAVIGATION_COMMAND_CHANNEL = 'navigation:command';
export const NAVIGATION_GET_STATE_CHANNEL = 'navigation:get-state';
export const NAVIGATION_STATE_CHANNEL = 'navigation:state';

export const navigationActions = ['navigate', 'reload', 'stop', 'back', 'forward'] as const;

export type NavigationAction = (typeof navigationActions)[number];

export type NavigationCommand =
  | {
      action: 'navigate';
      target: string;
    }
  | {
      action: Exclude<NavigationAction, 'navigate'>;
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
}

export const createEmptyNavigationState = (): NavigationState => ({
  url: '',
  title: 'Agent Browser',
  isLoading: false,
  canGoBack: false,
  canGoForward: false,
  lastError: null,
});

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

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
