import { describe, expect, it } from 'vitest';
import {
  getChromeAppearanceCssVariables,
  getChromeAppearanceThemeTokens,
  projectIconSrc,
} from '../src/renderer/src/chrome-appearance-theme';

describe('getChromeAppearanceCssVariables', () => {
  it('derives css variables from the current appearance colors', () => {
    const variables = getChromeAppearanceCssVariables({
      chromeColor: '#AABBCC',
      accentColor: '#112233',
    });

    expect(variables['--blue']).toBe('#112233');
    expect(variables['--accent-rgb']).toBe('17, 34, 51');
    expect(variables['--chrome-bg-top']).toMatch(/^#/);
  });
});

describe('projectIconSrc', () => {
  it('builds a file url for a resolved icon path', () => {
    expect(projectIconSrc('/tmp/My Icon.png')).toBe('file:///tmp/My%20Icon.png');
  });

  it('returns null when no icon path is present', () => {
    expect(projectIconSrc(null)).toBeNull();
  });
});

describe('getChromeAppearanceThemeTokens', () => {
  it('chooses a light foreground for dark accent surfaces', () => {
    const tokens = getChromeAppearanceThemeTokens({
      chromeColor: '#0F172A',
      accentColor: '#102A43',
    });

    expect(tokens.accentStrongBg).toBe('#102A43');
    expect(tokens.accentStrongFg).toBe('#FFFFFF');
    expect(tokens.controlFg).toBe('#0F172A');
  });

  it('chooses a dark foreground for light accent surfaces', () => {
    const tokens = getChromeAppearanceThemeTokens({
      chromeColor: '#F8FAFC',
      accentColor: '#C7E9FF',
    });

    expect(tokens.accentStrongBg).toBe('#C7E9FF');
    expect(tokens.accentStrongFg).toBe('#0F172A');
    expect(tokens.previewBarFg).toBe('#0F172A');
  });
});
