import { describe, expect, it } from 'vitest';
import {
  createEmptyNavigationState,
  isPageAgentOverlayState,
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
    expect(isNavigationCommand({ action: 'useAgentLogin' })).toBe(true);
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
        agentLoginCta: {
          visible: true,
          enabled: true,
          reason: null,
        },
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

describe('isPageAgentOverlayState', () => {
  it('accepts a valid agent overlay payload', () => {
    expect(
      isPageAgentOverlayState({
        annotationId: 'annotation-1',
        selection: {
          selector: '#cta',
          xpath: '//*[@id="cta"]',
          tag: 'button',
          id: 'cta',
          classList: ['primary'],
          role: 'button',
          accessibleName: 'Launch',
          playwrightLocator: "getByRole('button', { name: 'Launch' })",
          textSnippet: 'Launch',
          bbox: {
            x: 12,
            y: 18,
            width: 120,
            height: 32,
            devicePixelRatio: 2,
          },
          attributes: {
            role: 'button',
          },
          outerHTMLExcerpt: '<button id="cta">Launch</button>',
          frame: {
            url: 'https://example.com',
            isMainFrame: true,
          },
        },
        phase: 'in_progress',
        message: 'Agent is working on this.',
        updatedAt: '2026-03-13T21:10:00.000Z',
        sourceUrl: 'https://example.com',
      }),
    ).toBe(true);
  });

  it('rejects malformed agent overlay payloads', () => {
    expect(
      isPageAgentOverlayState({
        annotationId: 'annotation-1',
        phase: 'working',
      }),
    ).toBe(false);
  });
});
