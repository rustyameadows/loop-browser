import { describe, expect, it } from 'vitest';
import {
  createEmptyStyleViewState,
  isPageStyleControl,
  isPageStyleEvent,
  isStyleTweak,
  isStyleViewCommand,
  isStyleViewState,
} from '../src/index';

const sampleSelection = {
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
    x: 8,
    y: 12,
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
};

describe('style view protocol guards', () => {
  it('accepts valid style commands, state, and page bridge payloads', () => {
    expect(
      isStyleViewCommand({
        action: 'setOverrideDeclaration',
        property: 'color',
        value: '#112233',
      }),
    ).toBe(true);
    expect(
      isStyleViewState({
        ...createEmptyStyleViewState(),
        isOpen: true,
        status: 'ready',
        selection: sampleSelection,
        matchedRules: [
          {
            origin: 'author',
            selectorText: '.cta',
            declarations: 'color: rgb(12, 34, 56);',
            sourceLabel: 'example.com/app.css',
            atRuleContext: ['@media (min-width: 768px)'],
          },
        ],
        computedValues: {
          color: 'rgb(12, 34, 56)',
        },
        overrideDeclarations: {
          color: '#112233',
        },
        previewStatus: 'applied',
      }),
    ).toBe(true);
    expect(
      isPageStyleControl({
        requestId: 'request-1',
        action: 'inspect',
        selection: sampleSelection,
        declarations: {
          color: '#112233',
        },
      }),
    ).toBe(true);
    expect(
      isPageStyleEvent({
        type: 'result',
        requestId: 'request-1',
        inspection: {
          selection: sampleSelection,
          matchedRules: [],
          computedValues: {
            color: 'rgb(12, 34, 56)',
          },
          unreadableStylesheetCount: 1,
          unreadableStylesheetWarning: 'Could not inspect 1 stylesheet directly.',
          overrideDeclarations: {
            color: '#112233',
          },
          previewStatus: 'applied',
          lastError: null,
        },
      }),
    ).toBe(true);
    expect(
      isStyleTweak({
        property: 'color',
        value: '#112233',
        previousValue: 'rgb(12, 34, 56)',
      }),
    ).toBe(true);
  });

  it('rejects malformed style payloads', () => {
    expect(isStyleViewCommand({ action: 'setOverrideDeclaration', property: 'color' })).toBe(false);
    expect(
      isStyleViewState({
        ...createEmptyStyleViewState(),
        status: 'done',
      }),
    ).toBe(false);
    expect(
      isPageStyleControl({
        requestId: 'request-1',
        action: 'inspect',
        selection: sampleSelection,
      }),
    ).toBe(false);
    expect(
      isPageStyleEvent({
        type: 'result',
        requestId: 'request-1',
        inspection: {
          selection: sampleSelection,
        },
      }),
    ).toBe(false);
  });
});
