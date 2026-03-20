import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { parseHTML } from 'linkedom';
import type { ElementDescriptor, PageStyleEvent } from '@agent-browser/protocol';
import {
  PageStyleController,
  STYLE_OVERRIDE_ATTRIBUTE,
  STYLE_OVERRIDE_STYLE_ID,
  applyPreviewDeclarations,
  collectMatchedStyleRules,
  parseRawStyleDeclarations,
} from '../src/preload/page-style';

type GlobalSnapshot = {
  window: typeof globalThis.window | undefined;
  document: typeof globalThis.document | undefined;
  Element: typeof globalThis.Element | undefined;
  HTMLElement: typeof globalThis.HTMLElement | undefined;
  HTMLStyleElement: typeof globalThis.HTMLStyleElement | undefined;
  MutationObserver: typeof globalThis.MutationObserver | undefined;
  CSSStyleDeclaration: typeof globalThis.CSSStyleDeclaration | undefined;
};

let globals: GlobalSnapshot;

const createSelection = (selector = '.cta'): ElementDescriptor => ({
  selector,
  xpath: null,
  tag: 'button',
  id: 'cta',
  classList: ['cta'],
  role: 'button',
  accessibleName: 'Launch',
  playwrightLocator: "getByRole('button', { name: 'Launch' })",
  textSnippet: 'Launch',
  bbox: {
    x: 16,
    y: 24,
    width: 140,
    height: 40,
    devicePixelRatio: 2,
  },
  attributes: {
    id: 'cta',
    class: 'cta',
  },
  outerHTMLExcerpt: '<button id="cta" class="cta">Launch</button>',
  frame: {
    url: 'about:blank',
    isMainFrame: true,
  },
});

const createCssStyle = (declarations: Record<string, string>): CSSStyleDeclaration => {
  const style = document.createElement('div').style as CSSStyleDeclaration & {
    item?: (index: number) => string;
  };
  const properties = Object.keys(declarations);
  for (const [property, value] of Object.entries(declarations)) {
    style.setProperty(property, value);
  }
  style.item = (index: number) => properties[index] ?? '';
  return style as CSSStyleDeclaration;
};

beforeEach(() => {
  globals = {
    window: globalThis.window,
    document: globalThis.document,
    Element: globalThis.Element,
    HTMLElement: globalThis.HTMLElement,
    HTMLStyleElement: globalThis.HTMLStyleElement,
    MutationObserver: globalThis.MutationObserver,
    CSSStyleDeclaration: globalThis.CSSStyleDeclaration,
  };

  const { window, document } = parseHTML('<html><head></head><body></body></html>');
  Object.assign(window, {
    location: {
      href: 'about:blank',
    },
  });
  window.getComputedStyle = ((element: Element) => ({
    getPropertyValue: (property: string) =>
      (element as HTMLElement).style?.getPropertyValue(property) ?? '',
  })) as typeof window.getComputedStyle;

  Object.assign(globalThis, {
    window,
    document,
    Element: window.Element,
    HTMLElement: window.HTMLElement,
    HTMLStyleElement: window.HTMLStyleElement,
    MutationObserver: window.MutationObserver,
    CSSStyleDeclaration: document.createElement('div').style.constructor,
  });
  Object.defineProperty(document, 'styleSheets', {
    configurable: true,
    get() {
      return [];
    },
  });
});

afterEach(() => {
  Object.assign(globalThis, {
    window: globals.window,
    document: globals.document,
    Element: globals.Element,
    HTMLElement: globals.HTMLElement,
    HTMLStyleElement: globals.HTMLStyleElement,
    MutationObserver: globals.MutationObserver,
    CSSStyleDeclaration: globals.CSSStyleDeclaration,
  });
});

describe('page style helpers', () => {
  it('parses normalized declaration blocks and rejects selector wrappers', () => {
    expect(parseRawStyleDeclarations(' Color: rgb(255, 0, 0); padding-top: 12px; --brand: var(--accent); '))
      .toEqual({
        ok: true,
        declarations: {
          color: 'rgb(255, 0, 0)',
          'padding-top': '12px',
          '--brand': 'var(--accent)',
        },
      });

    expect(parseRawStyleDeclarations('button { color: red; }')).toEqual({
      ok: false,
      error: 'Enter CSS declarations only, without selector braces.',
    });
  });

  it('collects inline and readable author rules while warning about unreadable stylesheets', () => {
    document.body.innerHTML = '<button id="cta" class="cta" style="color: red;">Launch</button>';
    const target = document.getElementById('cta');
    expect(target).toBeTruthy();
    (target as Element & { matches: (selector: string) => boolean }).matches = (selector: string) =>
      selector === '.cta' || selector === 'button.cta';

    const readableSheet = {
      href: 'https://example.com/assets/site.css',
      cssRules: [
        {
          selectorText: '.cta',
          style: createCssStyle({ 'background-color': 'blue' }),
        },
        {
          cssText: '@media screen and (min-width: 600px) {',
          cssRules: [
            {
              selectorText: 'button.cta',
              style: createCssStyle({ 'padding-top': '12px' }),
            },
          ],
        },
      ],
    };
    const unreadableSheet = {};
    Object.defineProperty(unreadableSheet, 'cssRules', {
      configurable: true,
      get() {
        throw new Error('Cross-origin stylesheet');
      },
    });
    Object.defineProperty(document, 'styleSheets', {
      configurable: true,
      get() {
        return [readableSheet, unreadableSheet];
      },
    });

    const result = collectMatchedStyleRules(target as Element);

    expect(result.matchedRules).toEqual([
      {
        origin: 'inline',
        selectorText: 'element.style',
        declarations: 'color: red;',
        sourceLabel: 'Inline style',
        atRuleContext: [],
      },
      {
        origin: 'author',
        selectorText: '.cta',
        declarations: 'background-color: blue;',
        sourceLabel: 'example.com/assets/site.css',
        atRuleContext: [],
      },
      {
        origin: 'author',
        selectorText: 'button.cta',
        declarations: 'padding-top: 12px;',
        sourceLabel: 'example.com/assets/site.css',
        atRuleContext: ['@media screen and (min-width: 600px)'],
      },
    ]);
    expect(result.unreadableStylesheetCount).toBe(1);
    expect(result.unreadableStylesheetWarning).toContain('1 stylesheet');
  });

  it('swaps the live override marker between elements and clears the shared stylesheet', () => {
    document.body.innerHTML = `
      <button id="first" class="cta">First</button>
      <button id="second" class="cta-alt">Second</button>
    `;
    const first = document.getElementById('first') as Element;
    const second = document.getElementById('second') as Element;

    applyPreviewDeclarations(first, { color: 'rgb(255, 0, 0)' }, null, document);
    expect(first.getAttribute(STYLE_OVERRIDE_ATTRIBUTE)).toBe('active');
    expect((document.getElementById(STYLE_OVERRIDE_STYLE_ID) as HTMLStyleElement).textContent).toContain(
      'color: rgb(255, 0, 0) !important;',
    );

    applyPreviewDeclarations(second, { 'font-size': '18px' }, first, document);
    expect(first.hasAttribute(STYLE_OVERRIDE_ATTRIBUTE)).toBe(false);
    expect(second.getAttribute(STYLE_OVERRIDE_ATTRIBUTE)).toBe('active');
    expect((document.getElementById(STYLE_OVERRIDE_STYLE_ID) as HTMLStyleElement).textContent).toContain(
      'font-size: 18px !important;',
    );

    applyPreviewDeclarations(second, {}, second, document);
    expect(second.hasAttribute(STYLE_OVERRIDE_ATTRIBUTE)).toBe(false);
    expect((document.getElementById(STYLE_OVERRIDE_STYLE_ID) as HTMLStyleElement).textContent).toBe(
      '',
    );
  });
});

describe('PageStyleController', () => {
  it('emits inspection results, applies preview CSS, and reports when the target disappears', async () => {
    document.body.innerHTML = '<button id="cta" class="cta" style="color: rgb(0, 0, 0);">Launch</button>';
    const events: PageStyleEvent[] = [];
    const controller = new PageStyleController((payload) => {
      events.push(payload);
    });

    controller.handleCommand({
      action: 'inspect',
      requestId: 'inspect-1',
      selection: createSelection(),
      declarations: {
        'background-color': 'rgb(0, 0, 255)',
      },
    });

    expect(events[0]).toMatchObject({
      type: 'result',
      requestId: 'inspect-1',
      inspection: {
        overrideDeclarations: {
          'background-color': 'rgb(0, 0, 255)',
        },
        previewStatus: 'applied',
      },
    });
    expect(document.getElementById('cta')?.getAttribute(STYLE_OVERRIDE_ATTRIBUTE)).toBe('active');

    document.getElementById('cta')?.remove();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(events.at(-1)).toEqual({
      type: 'selectionLost',
      message:
        'The selected element is no longer available. Pick it again to keep previewing changes.',
    });
    expect((document.getElementById(STYLE_OVERRIDE_STYLE_ID) as HTMLStyleElement).textContent).toBe(
      '',
    );

    controller.dispose();
  });

  it('rejects invalid raw CSS without mutating preview state', () => {
    document.body.innerHTML = '<button id="cta" class="cta">Launch</button>';
    const events: PageStyleEvent[] = [];
    const controller = new PageStyleController((payload) => {
      events.push(payload);
    });

    controller.handleCommand({
      action: 'replaceOverridesFromRawCss',
      requestId: 'raw-1',
      selection: createSelection(),
      rawCss: 'color',
    });

    expect(events).toEqual([
      {
        type: 'error',
        requestId: 'raw-1',
        message: 'Invalid CSS declaration: color',
      },
    ]);
    expect(document.getElementById('cta')?.hasAttribute(STYLE_OVERRIDE_ATTRIBUTE)).toBe(false);
    expect((document.getElementById(STYLE_OVERRIDE_STYLE_ID) as HTMLStyleElement | null)?.textContent ?? '')
      .toBe('');
  });
});
