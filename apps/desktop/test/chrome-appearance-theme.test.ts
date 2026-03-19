import { describe, expect, it } from 'vitest';
import { getChromeAppearanceCssVariables, projectIconSrc } from '../src/renderer/src/chrome-appearance-theme';

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
