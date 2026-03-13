import { describe, expect, it } from 'vitest';
import {
  createEmptyNavigationState,
  isNavigationCommand,
  isNavigationState,
} from '../src/index';

describe('isNavigationCommand', () => {
  it('accepts a navigate command with a target', () => {
    expect(isNavigationCommand({ action: 'navigate', target: 'https://example.com' })).toBe(true);
  });

  it('accepts non-targeted navigation commands', () => {
    expect(isNavigationCommand({ action: 'reload' })).toBe(true);
    expect(isNavigationCommand({ action: 'back' })).toBe(true);
    expect(isNavigationCommand({ action: 'forward' })).toBe(true);
    expect(isNavigationCommand({ action: 'stop' })).toBe(true);
  });

  it('rejects malformed commands', () => {
    expect(isNavigationCommand({ action: 'navigate' })).toBe(false);
    expect(isNavigationCommand({ action: 'reload', target: 'https://example.com' })).toBe(false);
    expect(isNavigationCommand({ action: 'teleport' })).toBe(false);
  });
});

describe('isNavigationState', () => {
  it('accepts a full navigation state shape', () => {
    expect(
      isNavigationState({
        url: 'https://example.com',
        title: 'Example Domain',
        isLoading: false,
        canGoBack: false,
        canGoForward: false,
        lastError: null,
      }),
    ).toBe(true);
  });

  it('rejects invalid state values', () => {
    expect(
      isNavigationState({
        ...createEmptyNavigationState(),
        isLoading: 'nope',
      }),
    ).toBe(false);
  });
});
