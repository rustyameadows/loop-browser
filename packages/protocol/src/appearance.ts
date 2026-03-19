export const CHROME_APPEARANCE_COMMAND_CHANNEL = 'chrome-appearance:command';
export const CHROME_APPEARANCE_GET_STATE_CHANNEL = 'chrome-appearance:get-state';
export const CHROME_APPEARANCE_STATE_CHANNEL = 'chrome-appearance:state';
export const CHROME_APPEARANCE_BROWSE_ICON_CHANNEL = 'chrome-appearance:browse-icon';

export const DEFAULT_CHROME_COLOR = '#FAFBFD';
export const DEFAULT_ACCENT_COLOR = '#0A84FF';

export const chromeAppearanceActions = ['open', 'close', 'set', 'reset', 'selectProject'] as const;

export type ChromeAppearanceAction = (typeof chromeAppearanceActions)[number];

export interface ChromeAppearanceState {
  isOpen: boolean;
  projectRoot: string;
  configPath: string;
  chromeColor: string;
  accentColor: string;
  projectIconPath: string;
  resolvedProjectIconPath: string | null;
  lastError: string | null;
}

export type ChromeAppearanceCommand =
  | {
      action: 'open' | 'close' | 'reset' | 'selectProject';
    }
  | {
      action: 'set';
      chromeColor?: string;
      accentColor?: string;
      projectIconPath?: string;
    };

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const isHexColor = (value: unknown): value is string =>
  typeof value === 'string' && /^#[0-9a-fA-F]{6}$/.test(value);

export const createEmptyChromeAppearanceState = (): ChromeAppearanceState => ({
  isOpen: false,
  projectRoot: '',
  configPath: '',
  chromeColor: DEFAULT_CHROME_COLOR,
  accentColor: DEFAULT_ACCENT_COLOR,
  projectIconPath: '',
  resolvedProjectIconPath: null,
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
    isHexColor(value.chromeColor) &&
    isHexColor(value.accentColor) &&
    typeof value.projectIconPath === 'string' &&
    (typeof value.resolvedProjectIconPath === 'string' ||
      value.resolvedProjectIconPath === null) &&
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
        !('projectIconPath' in value)
      );
    case 'set':
      return (
        (!('chromeColor' in value) || typeof value.chromeColor === 'string') &&
        (!('accentColor' in value) || typeof value.accentColor === 'string') &&
        (!('projectIconPath' in value) || typeof value.projectIconPath === 'string') &&
        ('chromeColor' in value || 'accentColor' in value || 'projectIconPath' in value)
      );
    default:
      return false;
  }
};
