import { describe, expect, it } from 'vitest';
import {
  createEmptyPickerState,
  isElementDescriptor,
  isPagePickerEvent,
  isPickerCommand,
  isPickerState,
} from '../src/index';

const sampleDescriptor = {
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
    x: 10,
    y: 12,
    width: 120,
    height: 32,
    devicePixelRatio: 2,
  },
  attributes: {
    role: 'button',
    'data-testid': 'cta',
  },
  outerHTMLExcerpt: '<button id="cta">Launch</button>',
  frame: {
    url: 'https://example.com',
    isMainFrame: true,
  },
};

describe('picker protocol guards', () => {
  it('accepts valid picker commands and states', () => {
    expect(isPickerCommand({ action: 'toggle' })).toBe(true);
    expect(
      isPickerState({
        enabled: true,
        lastSelection: sampleDescriptor,
      }),
    ).toBe(true);
  });

  it('accepts a valid element descriptor and picker event', () => {
    expect(isElementDescriptor(sampleDescriptor)).toBe(true);
    expect(
      isPagePickerEvent({
        type: 'selection',
        descriptor: sampleDescriptor,
      }),
    ).toBe(true);
  });

  it('rejects malformed picker payloads', () => {
    expect(isPickerCommand({ action: 'arm' })).toBe(false);
    expect(
      isPickerState({
        ...createEmptyPickerState(),
        enabled: 'yes',
      }),
    ).toBe(false);
    expect(
      isPagePickerEvent({
        type: 'selection',
      }),
    ).toBe(false);
  });
});
