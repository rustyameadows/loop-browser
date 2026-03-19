import type { ChromeAppearanceState } from '@agent-browser/protocol';

type Rgb = {
  r: number;
  g: number;
  b: number;
};

export type ChromeAppearanceThemeTokens = {
  chromeBgTop: string;
  chromeBgBottom: string;
  surface: string;
  surfaceStrong: string;
  surfaceMuted: string;
  surfaceMutedStrong: string;
  border: string;
  borderSoft: string;
  blue: string;
  blueSoft: string;
  accentRgb: string;
  chromeText: string;
  chromeMuted: string;
  chromeMutedStrong: string;
  controlBg: string;
  controlHoverBg: string;
  controlBorder: string;
  controlFg: string;
  controlMutedFg: string;
  controlDisabledBg: string;
  controlDisabledFg: string;
  accentSoftBg: string;
  accentSoftBorder: string;
  accentSoftFg: string;
  accentStrongBg: string;
  accentStrongBorder: string;
  accentStrongFg: string;
  previewBarBg: string;
  previewBarFg: string;
  previewBarMuted: string;
  previewPillBg: string;
  previewIconWrapBg: string;
  previewIconFallbackBg: string;
  previewIconFallbackFg: string;
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

const relativeLuminance = (hex: string): number =>
  [hex.slice(1, 3), hex.slice(3, 5), hex.slice(5, 7)]
    .map((part) => Number.parseInt(part, 16) / 255)
    .map((channel) =>
      channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4,
    )
    .reduce(
      (accumulator, channel, index) =>
        accumulator + channel * [0.2126, 0.7152, 0.0722][index],
      0,
    );

const contrastRatio = (left: string, right: string): number => {
  const [lighter, darker] = [relativeLuminance(left), relativeLuminance(right)].sort(
    (a, b) => b - a,
  );
  return (lighter + 0.05) / (darker + 0.05);
};

const pickReadableForeground = (
  background: string,
  dark = '#0F172A',
  light = '#FFFFFF',
): string => (contrastRatio(dark, background) >= contrastRatio(light, background) ? dark : light);

const createMutedTone = (foreground: string, background: string, ratio: number): string =>
  mixColors(foreground, background, ratio);

export const getChromeAppearanceThemeTokens = (
  state: Pick<ChromeAppearanceState, 'chromeColor' | 'accentColor'>,
): ChromeAppearanceThemeTokens => {
  const chromeBgTop = mixColors(state.chromeColor, '#FFFFFF', 0.18);
  const chromeBgBottom = mixColors(state.chromeColor, '#D7DFEA', 0.26);
  const controlBg = mixColors(state.chromeColor, '#FFFFFF', 0.86);
  const controlFg = pickReadableForeground(controlBg);
  const accentSoftBg = mixColors(state.accentColor, '#FFFFFF', 0.78);
  const accentSoftFg = pickReadableForeground(accentSoftBg);
  const accentStrongFg = pickReadableForeground(state.accentColor);
  const previewBarBg = mixColors(state.chromeColor, '#FFFFFF', 0.76);
  const previewBarFg = pickReadableForeground(previewBarBg);

  return {
    chromeBgTop,
    chromeBgBottom,
    surface: mixColors(state.chromeColor, '#FFFFFF', 0.88),
    surfaceStrong: mixColors(state.chromeColor, '#FFFFFF', 0.94),
    surfaceMuted: mixColors(state.chromeColor, '#FFFFFF', 0.72),
    surfaceMutedStrong: mixColors(state.chromeColor, '#FFFFFF', 0.58),
    border: mixColors(state.chromeColor, '#CAD3DE', 0.56),
    borderSoft: mixColors(state.chromeColor, '#E7EDF4', 0.52),
    blue: state.accentColor,
    blueSoft: mixColors(state.accentColor, '#FFFFFF', 0.84),
    accentRgb: toRgbList(state.accentColor),
    chromeText: pickReadableForeground(chromeBgTop),
    chromeMuted: createMutedTone(pickReadableForeground(chromeBgTop), chromeBgTop, 0.5),
    chromeMutedStrong: createMutedTone(pickReadableForeground(chromeBgTop), chromeBgTop, 0.32),
    controlBg,
    controlHoverBg: mixColors(controlBg, state.accentColor, 0.12),
    controlBorder: mixColors(controlBg, controlFg, 0.78),
    controlFg,
    controlMutedFg: createMutedTone(controlFg, controlBg, 0.44),
    controlDisabledBg: mixColors(controlBg, chromeBgTop, 0.24),
    controlDisabledFg: createMutedTone(controlFg, controlBg, 0.58),
    accentSoftBg,
    accentSoftBorder: mixColors(accentSoftBg, state.accentColor, 0.62),
    accentSoftFg,
    accentStrongBg: state.accentColor,
    accentStrongBorder: mixColors(state.accentColor, accentStrongFg, 0.76),
    accentStrongFg,
    previewBarBg,
    previewBarFg,
    previewBarMuted: createMutedTone(previewBarFg, previewBarBg, 0.42),
    previewPillBg: createMutedTone(previewBarFg, previewBarBg, 0.84),
    previewIconWrapBg: mixColors(state.chromeColor, '#FFFFFF', 0.72),
    previewIconFallbackBg: state.accentColor,
    previewIconFallbackFg: accentStrongFg,
  };
};

export const getChromeAppearanceCssVariables = (
  state: Pick<ChromeAppearanceState, 'chromeColor' | 'accentColor'>,
): Record<string, string> => {
  const tokens = getChromeAppearanceThemeTokens(state);

  return {
    '--chrome-bg-top': tokens.chromeBgTop,
    '--chrome-bg-bottom': tokens.chromeBgBottom,
    '--surface': tokens.surface,
    '--surface-strong': tokens.surfaceStrong,
    '--surface-muted': tokens.surfaceMuted,
    '--surface-muted-strong': tokens.surfaceMutedStrong,
    '--border': tokens.border,
    '--border-soft': tokens.borderSoft,
    '--blue': tokens.blue,
    '--blue-soft': tokens.blueSoft,
    '--accent-rgb': tokens.accentRgb,
    '--chrome-text': tokens.chromeText,
    '--chrome-muted': tokens.chromeMuted,
    '--chrome-muted-strong': tokens.chromeMutedStrong,
    '--chrome-control-bg': tokens.controlBg,
    '--chrome-control-hover-bg': tokens.controlHoverBg,
    '--chrome-control-border': tokens.controlBorder,
    '--chrome-control-fg': tokens.controlFg,
    '--chrome-control-muted-fg': tokens.controlMutedFg,
    '--chrome-control-disabled-bg': tokens.controlDisabledBg,
    '--chrome-control-disabled-fg': tokens.controlDisabledFg,
    '--chrome-accent-soft-bg': tokens.accentSoftBg,
    '--chrome-accent-soft-border': tokens.accentSoftBorder,
    '--chrome-accent-soft-fg': tokens.accentSoftFg,
    '--chrome-accent-strong-bg': tokens.accentStrongBg,
    '--chrome-accent-strong-border': tokens.accentStrongBorder,
    '--chrome-accent-strong-fg': tokens.accentStrongFg,
    '--preview-bar-bg': tokens.previewBarBg,
    '--preview-bar-fg': tokens.previewBarFg,
    '--preview-bar-muted': tokens.previewBarMuted,
    '--preview-pill-bg': tokens.previewPillBg,
    '--preview-icon-wrap-bg': tokens.previewIconWrapBg,
    '--preview-icon-fallback-bg': tokens.previewIconFallbackBg,
    '--preview-icon-fallback-fg': tokens.previewIconFallbackFg,
  };
};

export const projectIconSrc = (resolvedProjectIconPath: string | null): string | null =>
  resolvedProjectIconPath ? encodeURI(`file://${resolvedProjectIconPath}`) : null;
