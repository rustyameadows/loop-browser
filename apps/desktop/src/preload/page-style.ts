import {
  curatedStyleProperties,
  type ElementDescriptor,
  type PageStyleControl,
  type PageStyleEvent,
  type StyleInspectionPayload,
  type StyleRuleMatch,
} from '@agent-browser/protocol';

export const STYLE_OVERRIDE_STYLE_ID = '__agent_browser_style_override__';
export const STYLE_OVERRIDE_ATTRIBUTE = 'data-agent-browser-style-target';
const STYLE_OVERRIDE_ATTRIBUTE_VALUE = 'active';

type ParseDeclarationsResult =
  | {
      ok: true;
      declarations: Record<string, string>;
    }
  | {
      ok: false;
      error: string;
    };

const normalizeDeclarationEntries = (
  declarations: Record<string, string>,
): Record<string, string> =>
  Object.fromEntries(
    Object.entries(declarations)
      .map(([property, value]) => [property.trim().toLowerCase(), value.trim()])
      .filter(([property, value]) => property.length > 0 && value.length > 0),
  );

const escapeAttributeValue = (value: string): string =>
  value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');

const ensureStyleElement = (root: Document = document): HTMLStyleElement => {
  const existing = root.getElementById(STYLE_OVERRIDE_STYLE_ID);
  if (existing instanceof HTMLStyleElement) {
    return existing;
  }

  const element = root.createElement('style');
  element.id = STYLE_OVERRIDE_STYLE_ID;
  (root.head ?? root.documentElement).append(element);
  return element;
};

const clearElementMarker = (element: Element | null): void => {
  if (!(element instanceof Element)) {
    return;
  }

  element.removeAttribute(STYLE_OVERRIDE_ATTRIBUTE);
};

const formatSourceLabel = (styleSheet: CSSStyleSheet): string => {
  if (styleSheet.href) {
    try {
      const url = new URL(styleSheet.href);
      return `${url.host}${url.pathname}`;
    } catch {
      return styleSheet.href;
    }
  }

  return '<style>';
};

const describeAtRule = (rule: CSSRule): string => {
  const rawPrefix = rule.cssText.split('{', 1)[0]?.trim() ?? '';
  return rawPrefix || '@group';
};

const serializeCssProperties = (
  style: CSSStyleDeclaration,
): string =>
  Array.from({ length: style.length })
    .map((_, index) => style.item(index))
    .filter((property) => property.length > 0)
    .map((property) => `${property}: ${style.getPropertyValue(property).trim()};`)
    .join(' ');

const matchesSelector = (element: Element, selectorText: string): boolean => {
  try {
    return element.matches(selectorText);
  } catch {
    return false;
  }
};

const resolveXPathElement = (xpath: string | null): Element | null => {
  if (!xpath) {
    return null;
  }

  try {
    const result = document.evaluate(
      xpath,
      document,
      null,
      XPathResult.FIRST_ORDERED_NODE_TYPE,
      null,
    );
    return result.singleNodeValue instanceof Element ? result.singleNodeValue : null;
  } catch {
    return null;
  }
};

export const resolveStyleSelectionElement = (selection: ElementDescriptor): Element | null => {
  if (selection.frame.url && selection.frame.url !== window.location.href) {
    return null;
  }

  try {
    const selectorMatch = document.querySelector(selection.selector);
    if (selectorMatch instanceof Element) {
      return selectorMatch;
    }
  } catch {
    // Ignore invalid selectors and continue to XPath fallback.
  }

  return resolveXPathElement(selection.xpath);
};

export const collectComputedStyleValues = (
  element: Element,
  properties = curatedStyleProperties,
): Record<string, string> => {
  const computedStyle = window.getComputedStyle(element);
  return Object.fromEntries(
    properties.map((property) => [property, computedStyle.getPropertyValue(property).trim()]),
  );
};

export const collectMatchedStyleRules = (
  element: Element,
): {
  matchedRules: StyleRuleMatch[];
  unreadableStylesheetCount: number;
  unreadableStylesheetWarning: string | null;
} => {
  const matchedRules: StyleRuleMatch[] = [];
  const inlineStyle = element.getAttribute('style')?.trim() ?? '';
  if (inlineStyle) {
    matchedRules.push({
      origin: 'inline',
      selectorText: 'element.style',
      declarations: inlineStyle,
      sourceLabel: 'Inline style',
      atRuleContext: [],
    });
  }

  let unreadableStylesheetCount = 0;

  const visitRules = (
    rules: CSSRuleList,
    sourceLabel: string,
    atRuleContext: string[],
  ): void => {
    for (const rule of Array.from(rules)) {
      if ('selectorText' in rule && typeof rule.selectorText === 'string') {
        if (matchesSelector(element, rule.selectorText)) {
          matchedRules.push({
            origin: 'author',
            selectorText: rule.selectorText,
            declarations:
              'style' in rule && rule.style instanceof CSSStyleDeclaration
                ? serializeCssProperties(rule.style)
                : '',
            sourceLabel,
            atRuleContext,
          });
        }
        continue;
      }

      if ('cssRules' in rule && rule.cssRules) {
        visitRules(rule.cssRules as CSSRuleList, sourceLabel, [...atRuleContext, describeAtRule(rule)]);
      }
    }
  };

  for (const styleSheet of Array.from(document.styleSheets)) {
    try {
      visitRules(styleSheet.cssRules, formatSourceLabel(styleSheet), []);
    } catch {
      unreadableStylesheetCount += 1;
    }
  }

  return {
    matchedRules,
    unreadableStylesheetCount,
    unreadableStylesheetWarning:
      unreadableStylesheetCount > 0
        ? `Could not inspect ${unreadableStylesheetCount} stylesheet${
            unreadableStylesheetCount === 1 ? '' : 's'
          } directly. Computed values still include them.`
        : null,
  };
};

export const parseRawStyleDeclarations = (
  rawCss: string,
  root: Document = document,
): ParseDeclarationsResult => {
  const trimmed = rawCss.trim();
  if (!trimmed) {
    return {
      ok: true,
      declarations: {},
    };
  }

  if (trimmed.includes('{') || trimmed.includes('}')) {
    return {
      ok: false,
      error: 'Enter CSS declarations only, without selector braces.',
    };
  }

  const withoutComments = trimmed.replace(/\/\*[\s\S]*?\*\//g, '').trim();
  const tempStyle = root.createElement('div').style;
  const declarations: Record<string, string> = {};

  for (const rawDeclaration of withoutComments.split(';')) {
    const declaration = rawDeclaration.trim();
    if (!declaration) {
      continue;
    }

    const separatorIndex = declaration.indexOf(':');
    if (separatorIndex <= 0 || separatorIndex === declaration.length - 1) {
      return {
        ok: false,
        error: `Invalid CSS declaration: ${declaration}`,
      };
    }

    const property = declaration.slice(0, separatorIndex).trim().toLowerCase();
    const value = declaration.slice(separatorIndex + 1).trim();
    if (!property || !value) {
      return {
        ok: false,
        error: `Invalid CSS declaration: ${declaration}`,
      };
    }

    tempStyle.removeProperty(property);
    tempStyle.setProperty(property, value);
    const parsedValue = tempStyle.getPropertyValue(property).trim();
    if (!property.startsWith('--') && parsedValue.length === 0) {
      return {
        ok: false,
        error: `Loop Browser could not parse "${property}: ${value}".`,
      };
    }

    declarations[property] = property.startsWith('--') ? value : parsedValue || value;
  }

  return {
    ok: true,
    declarations: normalizeDeclarationEntries(declarations),
  };
};

const renderOverrideCss = (declarations: Record<string, string>): string => {
  const lines = Object.entries(normalizeDeclarationEntries(declarations)).map(
    ([property, value]) => `  ${property}: ${value} !important;`,
  );

  if (lines.length === 0) {
    return '';
  }

  return `[${STYLE_OVERRIDE_ATTRIBUTE}="${escapeAttributeValue(STYLE_OVERRIDE_ATTRIBUTE_VALUE)}"] {\n${lines.join(
    '\n',
  )}\n}`;
};

export const applyPreviewDeclarations = (
  target: Element,
  declarations: Record<string, string>,
  previousTarget: Element | null,
  root: Document = document,
): void => {
  clearElementMarker(previousTarget);

  const styleElement = ensureStyleElement(root);
  const nextCss = renderOverrideCss(declarations);
  styleElement.textContent = nextCss;

  if (!nextCss) {
    target.removeAttribute(STYLE_OVERRIDE_ATTRIBUTE);
    return;
  }

  target.setAttribute(STYLE_OVERRIDE_ATTRIBUTE, STYLE_OVERRIDE_ATTRIBUTE_VALUE);
};

const clearPreviewDeclarations = (
  currentTarget: Element | null,
  root: Document = document,
): void => {
  clearElementMarker(currentTarget);
  ensureStyleElement(root).textContent = '';
};

export class PageStyleController {
  private currentTarget: Element | null = null;
  private currentSelection: ElementDescriptor | null = null;
  private observer: MutationObserver | null = null;

  constructor(private readonly emit: (payload: PageStyleEvent) => void) {}

  handleCommand(payload: PageStyleControl): void {
    switch (payload.action) {
      case 'inspect':
        this.handleInspect(payload.requestId, payload.selection, payload.declarations);
        break;
      case 'replaceOverridesFromRawCss': {
        const parsed = parseRawStyleDeclarations(payload.rawCss);
        if (!parsed.ok) {
          this.emit({
            type: 'error',
            requestId: payload.requestId,
            message: parsed.error,
          });
          return;
        }

        this.handleInspect(payload.requestId, payload.selection, parsed.declarations);
        break;
      }
      case 'clearPreview':
        this.handleClearPreview(payload.requestId, payload.selection);
        break;
      default:
        break;
    }
  }

  dispose(): void {
    this.observer?.disconnect();
    this.observer = null;
    clearPreviewDeclarations(this.currentTarget);
    this.currentTarget = null;
    this.currentSelection = null;
  }

  private handleInspect(
    requestId: string,
    selection: ElementDescriptor,
    declarations: Record<string, string>,
  ): void {
    const target = resolveStyleSelectionElement(selection);
    if (!(target instanceof Element)) {
      clearPreviewDeclarations(this.currentTarget);
      this.currentTarget = null;
      this.currentSelection = null;
      this.emit({
        type: 'error',
        requestId,
        message: 'The selected element is no longer available on this page.',
      });
      return;
    }

    const normalizedDeclarations = normalizeDeclarationEntries(declarations);
    applyPreviewDeclarations(target, normalizedDeclarations, this.currentTarget);
    this.currentTarget = target;
    this.currentSelection = selection;
    this.observeCurrentTarget();

    this.emit({
      type: 'result',
      requestId,
      inspection: this.buildInspectionPayload(selection, target, normalizedDeclarations),
    });
  }

  private handleClearPreview(
    requestId: string,
    selection: ElementDescriptor | null,
  ): void {
    clearPreviewDeclarations(this.currentTarget);

    if (!selection) {
      this.currentTarget = null;
      this.currentSelection = null;
      this.emit({
        type: 'error',
        requestId,
        message: 'Pick an element before clearing preview.',
      });
      return;
    }

    const target = resolveStyleSelectionElement(selection);
    if (!(target instanceof Element)) {
      this.currentTarget = null;
      this.currentSelection = null;
      this.emit({
        type: 'error',
        requestId,
        message: 'The selected element is no longer available on this page.',
      });
      return;
    }

    this.currentTarget = target;
    this.currentSelection = selection;
    this.observeCurrentTarget();
    this.emit({
      type: 'result',
      requestId,
      inspection: this.buildInspectionPayload(selection, target, {}),
    });
  }

  private buildInspectionPayload(
    selection: ElementDescriptor,
    target: Element,
    declarations: Record<string, string>,
  ): StyleInspectionPayload {
    const { matchedRules, unreadableStylesheetCount, unreadableStylesheetWarning } =
      collectMatchedStyleRules(target);

    return {
      selection,
      matchedRules,
      computedValues: collectComputedStyleValues(target),
      unreadableStylesheetCount,
      unreadableStylesheetWarning,
      overrideDeclarations: normalizeDeclarationEntries(declarations),
      previewStatus: Object.keys(declarations).length > 0 ? 'applied' : 'idle',
      lastError: null,
    };
  }

  private observeCurrentTarget(): void {
    this.observer?.disconnect();
    this.observer = null;

    if (!document.documentElement) {
      return;
    }

    this.observer = new MutationObserver(() => {
      if (this.currentTarget && this.currentTarget.isConnected) {
        return;
      }

      clearPreviewDeclarations(this.currentTarget);
      this.currentTarget = null;
      this.currentSelection = null;
      this.observer?.disconnect();
      this.observer = null;
      this.emit({
        type: 'selectionLost',
        message: 'The selected element is no longer available. Pick it again to keep previewing changes.',
      });
    });

    this.observer.observe(document.documentElement, {
      subtree: true,
      childList: true,
    });
  }
}
