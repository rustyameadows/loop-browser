import type { ChromeAppearanceState } from '@agent-browser/protocol';

type Rgb = {
  r: number;
  g: number;
  b: number;
};

const parseHexColor = (hex: string): Rgb => ({
  r: Number.parseInt(hex.slice(1, 3), 16),
  g: Number.parseInt(hex.slice(3, 5), 16),
  b: Number.parseInt(hex.slice(5, 7), 16),
});

const toHexColor = ({ r, g, b }: Rgb): string =>
  `#${[r, g, b]
    .map((value) => Math.max(0, Math.min(255, Math.round(value))).toString(16).padStart(2, '0'))
    .join('')
    .toUpperCase()}`;

const mixColors = (left: string, right: string, ratio: number): string => {
  const leftRgb = parseHexColor(left);
  const rightRgb = parseHexColor(right);
  const clampedRatio = Math.max(0, Math.min(1, ratio));

  return toHexColor({
    r: leftRgb.r + (rightRgb.r - leftRgb.r) * clampedRatio,
    g: leftRgb.g + (rightRgb.g - leftRgb.g) * clampedRatio,
    b: leftRgb.b + (rightRgb.b - leftRgb.b) * clampedRatio,
  });
};

const toRgbList = (hex: string): string => {
  const rgb = parseHexColor(hex);
  return `${rgb.r}, ${rgb.g}, ${rgb.b}`;
};

export const getChromeAppearanceCssVariables = (
  state: Pick<ChromeAppearanceState, 'chromeColor' | 'accentColor'>,
): Record<string, string> => ({
  '--chrome-bg-top': mixColors(state.chromeColor, '#FFFFFF', 0.18),
  '--chrome-bg-bottom': mixColors(state.chromeColor, '#D7DFEA', 0.26),
  '--surface-muted': mixColors(state.chromeColor, '#FFFFFF', 0.72),
  '--surface-muted-strong': mixColors(state.chromeColor, '#FFFFFF', 0.58),
  '--border': mixColors(state.chromeColor, '#CAD3DE', 0.56),
  '--border-soft': mixColors(state.chromeColor, '#E7EDF4', 0.52),
  '--blue': state.accentColor,
  '--blue-soft': mixColors(state.accentColor, '#FFFFFF', 0.84),
  '--accent-rgb': toRgbList(state.accentColor),
});

export const projectIconSrc = (resolvedProjectIconPath: string | null): string | null =>
  resolvedProjectIconPath ? encodeURI(`file://${resolvedProjectIconPath}`) : null;
