import { describe, expect, it } from 'vitest';
import {
  createEmptyChromeAppearanceState,
  isChromeAppearanceCommand,
  isChromeAppearanceState,
} from '../src';

describe('isChromeAppearanceCommand', () => {
  it('accepts open, close, reset, and selectProject commands', () => {
    expect(isChromeAppearanceCommand({ action: 'open' })).toBe(true);
    expect(isChromeAppearanceCommand({ action: 'close' })).toBe(true);
    expect(isChromeAppearanceCommand({ action: 'reset' })).toBe(true);
    expect(isChromeAppearanceCommand({ action: 'selectProject' })).toBe(true);
    expect(
      isChromeAppearanceCommand({ action: 'setPresentation', mode: 'sidebar', side: 'left' }),
    ).toBe(true);
    expect(
      isChromeAppearanceCommand({ action: 'moveFloatingPill', deltaX: 12, deltaY: -8 }),
    ).toBe(true);
  });

  it('accepts partial set commands', () => {
    expect(isChromeAppearanceCommand({ action: 'set', chromeColor: '#AABBCC' })).toBe(true);
    expect(isChromeAppearanceCommand({ action: 'set', projectIconPath: './icon.png' })).toBe(
      true,
    );
    expect(isChromeAppearanceCommand({ action: 'set', defaultUrl: 'http://127.0.0.1:3000' })).toBe(
      true,
    );
  });

  it('rejects malformed commands', () => {
    expect(isChromeAppearanceCommand({ action: 'set' })).toBe(false);
    expect(isChromeAppearanceCommand({ action: 'set', chromeColor: 123 })).toBe(false);
    expect(isChromeAppearanceCommand({ action: 'toggle' })).toBe(false);
    expect(
      isChromeAppearanceCommand({ action: 'setPresentation', mode: 'sidebar', side: 'bottom' }),
    ).toBe(false);
    expect(
      isChromeAppearanceCommand({ action: 'moveFloatingPill', deltaX: '12', deltaY: 8 }),
    ).toBe(false);
  });
});

describe('isChromeAppearanceState', () => {
  it('accepts a valid appearance state shape', () => {
    expect(
      isChromeAppearanceState({
        ...createEmptyChromeAppearanceState(),
        projectRoot: '/tmp/project',
        configPath: '/tmp/project/.loop-browser.json',
        chromeColor: '#AABBCC',
        accentColor: '#112233',
        panelPreferences: {
          ...createEmptyChromeAppearanceState().panelPreferences,
          markdown: {
            mode: 'floating-pill',
          },
        },
        dockIconStatus: 'applied',
        dockIconSource: 'projectIcon',
      }),
    ).toBe(true);
  });

  it('rejects invalid state values', () => {
    expect(
      isChromeAppearanceState({
        ...createEmptyChromeAppearanceState(),
        chromeColor: 'blue',
      }),
    ).toBe(false);
  });
});
