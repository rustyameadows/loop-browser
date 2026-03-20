import {
  createDefaultPanelPresentationPreferences,
  isPanelPresentationMode,
  isPanelPresentationPreferences,
  isPanelSidebarSide,
  type PanelPresentationMode,
  type PanelPresentationPreferences,
  type PanelSidebarSide,
} from './panel-presentation';

export const CHROME_APPEARANCE_COMMAND_CHANNEL = 'chrome-appearance:command';
export const CHROME_APPEARANCE_GET_STATE_CHANNEL = 'chrome-appearance:get-state';
export const CHROME_APPEARANCE_STATE_CHANNEL = 'chrome-appearance:state';
export const CHROME_APPEARANCE_BROWSE_ICON_CHANNEL = 'chrome-appearance:browse-icon';

export const DEFAULT_CHROME_COLOR = '#FAFBFD';
export const DEFAULT_ACCENT_COLOR = '#0A84FF';
export const chromeDockIconStatuses = ['idle', 'applied', 'failed'] as const;
export const chromeDockIconSources = ['chromeColor', 'projectIcon'] as const;

export const chromeAppearanceActions = [
  'open',
  'close',
  'set',
  'reset',
  'selectProject',
  'setPresentation',
  'moveFloatingPill',
] as const;

export type ChromeAppearanceAction = (typeof chromeAppearanceActions)[number];
export type ChromeDockIconStatus = (typeof chromeDockIconStatuses)[number];
export type ChromeDockIconSource = (typeof chromeDockIconSources)[number];

export interface ChromeAppearanceState {
  isOpen: boolean;
  projectRoot: string;
  configPath: string;
  panelPreferences: PanelPresentationPreferences;
  chromeColor: string;
  accentColor: string;
  projectIconPath: string;
  resolvedProjectIconPath: string | null;
  defaultUrl: string;
  agentLoginUsernameEnv: string;
  agentLoginPasswordEnv: string;
  agentLoginUsernameResolved: boolean;
  agentLoginPasswordResolved: boolean;
  agentLoginReady: boolean;
  dockIconStatus: ChromeDockIconStatus;
  dockIconSource: ChromeDockIconSource;
  dockIconLastError: string | null;
  lastError: string | null;
}

export type ChromeAppearanceCommand =
  | {
      action: 'open' | 'close' | 'reset' | 'selectProject';
    }
  | {
      action: 'moveFloatingPill';
      deltaX: number;
      deltaY: number;
    }
  | {
      action: 'setPresentation';
      mode: PanelPresentationMode;
      side?: PanelSidebarSide;
    }
  | {
      action: 'set';
      chromeColor?: string;
      accentColor?: string;
      projectIconPath?: string;
      defaultUrl?: string;
      agentLoginUsernameEnv?: string;
      agentLoginPasswordEnv?: string;
    };

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const isHexColor = (value: unknown): value is string =>
  typeof value === 'string' && /^#[0-9a-fA-F]{6}$/.test(value);

export const createEmptyChromeAppearanceState = (): ChromeAppearanceState => ({
  isOpen: false,
  projectRoot: '',
  configPath: '',
  panelPreferences: createDefaultPanelPresentationPreferences(),
  chromeColor: DEFAULT_CHROME_COLOR,
  accentColor: DEFAULT_ACCENT_COLOR,
  projectIconPath: '',
  resolvedProjectIconPath: null,
  defaultUrl: '',
  agentLoginUsernameEnv: '',
  agentLoginPasswordEnv: '',
  agentLoginUsernameResolved: false,
  agentLoginPasswordResolved: false,
  agentLoginReady: false,
  dockIconStatus: 'idle',
  dockIconSource: 'chromeColor',
  dockIconLastError: null,
  lastError: null,
});

export const isChromeAppearanceState = (value: unknown): value is ChromeAppearanceState => {
  if (!isRecord(value)) {
    return false;
  }

  return (
    typeof value.isOpen === 'boolean' &&
    typeof value.projectRoot === 'string' &&
    typeof value.configPath === 'string' &&
    isPanelPresentationPreferences(value.panelPreferences) &&
    isHexColor(value.chromeColor) &&
    isHexColor(value.accentColor) &&
    typeof value.projectIconPath === 'string' &&
    (typeof value.resolvedProjectIconPath === 'string' ||
      value.resolvedProjectIconPath === null) &&
    typeof value.defaultUrl === 'string' &&
    typeof value.agentLoginUsernameEnv === 'string' &&
    typeof value.agentLoginPasswordEnv === 'string' &&
    typeof value.agentLoginUsernameResolved === 'boolean' &&
    typeof value.agentLoginPasswordResolved === 'boolean' &&
    typeof value.agentLoginReady === 'boolean' &&
    typeof value.dockIconStatus === 'string' &&
    chromeDockIconStatuses.includes(value.dockIconStatus as ChromeDockIconStatus) &&
    typeof value.dockIconSource === 'string' &&
    chromeDockIconSources.includes(value.dockIconSource as ChromeDockIconSource) &&
    (typeof value.dockIconLastError === 'string' || value.dockIconLastError === null) &&
    (typeof value.lastError === 'string' || value.lastError === null)
  );
};

export const isChromeAppearanceCommand = (value: unknown): value is ChromeAppearanceCommand => {
  if (!isRecord(value) || typeof value.action !== 'string') {
    return false;
  }

  if (!chromeAppearanceActions.includes(value.action as ChromeAppearanceAction)) {
    return false;
  }

  switch (value.action) {
    case 'open':
    case 'close':
    case 'reset':
    case 'selectProject':
      return (
        !('chromeColor' in value) &&
        !('accentColor' in value) &&
        !('projectIconPath' in value) &&
        !('defaultUrl' in value) &&
        !('agentLoginUsernameEnv' in value) &&
        !('agentLoginPasswordEnv' in value) &&
        !('deltaX' in value) &&
        !('deltaY' in value) &&
        !('mode' in value) &&
        !('side' in value)
      );
    case 'moveFloatingPill':
      return typeof value.deltaX === 'number' && typeof value.deltaY === 'number';
    case 'setPresentation':
      return (
        isPanelPresentationMode(value.mode) &&
        (!('side' in value) || value.side === undefined || isPanelSidebarSide(value.side))
      );
    case 'set':
      return (
        (!('chromeColor' in value) || typeof value.chromeColor === 'string') &&
        (!('accentColor' in value) || typeof value.accentColor === 'string') &&
        (!('projectIconPath' in value) || typeof value.projectIconPath === 'string') &&
        (!('defaultUrl' in value) || typeof value.defaultUrl === 'string') &&
        (!('agentLoginUsernameEnv' in value) ||
          typeof value.agentLoginUsernameEnv === 'string') &&
        (!('agentLoginPasswordEnv' in value) ||
          typeof value.agentLoginPasswordEnv === 'string') &&
        !('deltaX' in value) &&
        !('deltaY' in value) &&
        !('mode' in value) &&
        !('side' in value) &&
        ('chromeColor' in value ||
          'accentColor' in value ||
          'projectIconPath' in value ||
          'defaultUrl' in value ||
          'agentLoginUsernameEnv' in value ||
          'agentLoginPasswordEnv' in value)
      );
    default:
      return false;
  }
};
