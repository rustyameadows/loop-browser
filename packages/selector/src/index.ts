import type { ElementDescriptor } from '@agent-browser/protocol';

export const TEXT_SNIPPET_MAX = 120;
export const ATTRIBUTE_VALUE_MAX = 200;
export const OUTER_HTML_EXCERPT_MAX = 1200;

const WHITESPACE_PATTERN = /\s+/g;
const ATTRIBUTE_NAMES = new Set([
  'name',
  'type',
  'href',
  'src',
  'role',
  'title',
  'placeholder',
  'value',
  'alt',
  'for',
]);

export const normalizeWhitespace = (value: string): string =>
  value.replace(WHITESPACE_PATTERN, ' ').trim();

export const capString = (value: string, maxLength: number): string =>
  value.length <= maxLength ? value : `${value.slice(0, Math.max(maxLength - 3, 0))}...`;

const cssEscape = (value: string): string => {
  if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') {
    return CSS.escape(value);
  }

  return value.replace(/[^a-zA-Z0-9_-]/g, (character) => `\\${character}`);
};

const makeQuotedSelector = (attribute: string, value: string): string =>
  `[${attribute}="${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"]`;

const quoteForLocator = (value: string): string => value.replace(/\\/g, '\\\\').replace(/'/g, "\\'");

const isUniqueSelector = (document: Document, selector: string): boolean => {
  try {
    return document.querySelectorAll(selector).length === 1;
  } catch {
    return false;
  }
};

const nthOfType = (element: Element): number => {
  let index = 1;
  let sibling = element.previousElementSibling;

  while (sibling) {
    if (sibling.localName === element.localName) {
      index += 1;
    }

    sibling = sibling.previousElementSibling;
  }

  return index;
};

export const createStableSelector = (element: Element): string => {
  const document = element.ownerDocument;
  const testId = element.getAttribute('data-testid');

  if (testId) {
    const selector = makeQuotedSelector('data-testid', testId);
    if (isUniqueSelector(document, selector)) {
      return selector;
    }
  }

  if (element.id) {
    const selector = `#${cssEscape(element.id)}`;
    if (isUniqueSelector(document, selector)) {
      return selector;
    }
  }

  for (const attribute of ['aria-label', 'placeholder', 'title', 'alt']) {
    const value = element.getAttribute(attribute);
    if (!value) {
      continue;
    }

    const selector = `${element.localName}${makeQuotedSelector(attribute, value)}`;
    if (isUniqueSelector(document, selector)) {
      return selector;
    }
  }

  const name = element.getAttribute('name');
  if (name) {
    const selector = `${element.localName}${makeQuotedSelector('name', name)}`;
    if (isUniqueSelector(document, selector)) {
      return selector;
    }
  }

  const segments: string[] = [];
  let current: Element | null = element;

  while (current) {
    const tagName = current.localName;
    if (!tagName) {
      break;
    }

    let segment = tagName;
    if (current.id) {
      const selector = `#${cssEscape(current.id)}`;
      segments.unshift(selector);
      return segments.join(' > ');
    }

    if (current.parentElement) {
      segment = `${segment}:nth-of-type(${nthOfType(current)})`;
    }

    segments.unshift(segment);
    const selector = segments.join(' > ');
    if (isUniqueSelector(document, selector)) {
      return selector;
    }

    current = current.parentElement;
  }

  return segments.join(' > ');
};

export const createXPath = (element: Element): string | null => {
  if (element.id) {
    return `//*[@id="${element.id.replace(/"/g, '\\"')}"]`;
  }

  const segments: string[] = [];
  let current: Element | null = element;

  while (current && current.nodeType === Node.ELEMENT_NODE) {
    const tagName = current.localName;
    if (!tagName) {
      break;
    }

    const index = nthOfType(current);
    segments.unshift(`${tagName}[${index}]`);
    current = current.parentElement;
  }

  if (segments.length === 0) {
    return null;
  }

  return `/${segments.join('/')}`;
};

export const inferRole = (element: Element): string | null => {
  const explicitRole = element.getAttribute('role');
  if (explicitRole) {
    return explicitRole;
  }

  switch (element.localName) {
    case 'button':
      return 'button';
    case 'a':
      return element.hasAttribute('href') ? 'link' : null;
    case 'textarea':
      return 'textbox';
    case 'select':
      return 'combobox';
    case 'img':
      return 'img';
    case 'input': {
      const type = (element.getAttribute('type') || 'text').toLowerCase();
      if (['button', 'submit', 'reset'].includes(type)) {
        return 'button';
      }

      if (type === 'checkbox') {
        return 'checkbox';
      }

      if (type === 'radio') {
        return 'radio';
      }

      if (type === 'range') {
        return 'slider';
      }

      return 'textbox';
    }
    default:
      return null;
  }
};

const resolveLabelledByText = (element: Element): string | null => {
  const raw = element.getAttribute('aria-labelledby');
  if (!raw) {
    return null;
  }

  const values = raw
    .split(/\s+/)
    .map((token) => token.trim())
    .filter(Boolean)
    .map((id) => element.ownerDocument.getElementById(id)?.textContent ?? '')
    .map((text) => normalizeWhitespace(text))
    .filter(Boolean);

  if (values.length === 0) {
    return null;
  }

  return values.join(' ');
};

const resolveAssociatedLabel = (element: Element): string | null => {
  const htmlElement = element as Element & {
    labels?: NodeListOf<HTMLLabelElement>;
  };

  const labels = htmlElement.labels ? Array.from(htmlElement.labels) : [];
  if (labels.length > 0) {
    const labelText = labels.map((entry) => normalizeWhitespace(entry.textContent ?? '')).join(' ');
    if (labelText) {
      return labelText;
    }
  }

  if (!element.id) {
    return null;
  }

  const explicit = element.ownerDocument.querySelector(`label[for="${cssEscape(element.id)}"]`);
  if (!(explicit instanceof HTMLLabelElement)) {
    return null;
  }

  const text = normalizeWhitespace(explicit.textContent ?? '');
  return text || null;
};

export const createAccessibleName = (element: Element): string | null => {
  const candidates = [
    element.getAttribute('aria-label'),
    resolveLabelledByText(element),
    resolveAssociatedLabel(element),
    element.getAttribute('alt'),
    element.getAttribute('title'),
    element.getAttribute('placeholder'),
    element instanceof HTMLInputElement &&
    ['button', 'submit', 'reset'].includes((element.getAttribute('type') || 'text').toLowerCase())
      ? element.value
      : null,
    normalizeWhitespace(element.textContent ?? ''),
  ];

  for (const value of candidates) {
    if (!value) {
      continue;
    }

    const normalized = normalizeWhitespace(value);
    if (normalized) {
      return capString(normalized, TEXT_SNIPPET_MAX);
    }
  }

  return null;
};

export const createPlaywrightLocator = (element: Element): string | null => {
  const testId = element.getAttribute('data-testid');
  if (testId) {
    return `getByTestId('${quoteForLocator(testId)}')`;
  }

  const role = inferRole(element);
  const accessibleName = createAccessibleName(element);
  if (role && accessibleName) {
    return `getByRole('${quoteForLocator(role)}', { name: '${quoteForLocator(accessibleName)}' })`;
  }

  if (element.id) {
    return `locator('#${quoteForLocator(cssEscape(element.id))}')`;
  }

  if (accessibleName && ['button', 'a', 'label', 'span', 'div'].includes(element.localName)) {
    return `getByText('${quoteForLocator(accessibleName)}')`;
  }

  return null;
};

export const extractAttributes = (element: Element): Record<string, string> => {
  const attributes: Record<string, string> = {};

  for (const attribute of Array.from(element.attributes)) {
    const { name, value } = attribute;
    if (!value) {
      continue;
    }

    if (
      ATTRIBUTE_NAMES.has(name) ||
      name === 'data-testid' ||
      name.startsWith('aria-')
    ) {
      attributes[name] = capString(normalizeWhitespace(value), ATTRIBUTE_VALUE_MAX);
    }
  }

  return attributes;
};

export const createElementDescriptor = (element: Element): ElementDescriptor => {
  const view = element.ownerDocument.defaultView;
  if (!view) {
    throw new Error('Cannot describe an element without an associated window.');
  }

  const textSnippet = capString(normalizeWhitespace(element.textContent ?? ''), TEXT_SNIPPET_MAX);
  const rect = element.getBoundingClientRect();

  return {
    selector: createStableSelector(element),
    xpath: createXPath(element),
    tag: element.localName,
    id: element.id || null,
    classList: Array.from(element.classList).slice(0, 12),
    role: inferRole(element),
    accessibleName: createAccessibleName(element),
    playwrightLocator: createPlaywrightLocator(element),
    textSnippet,
    bbox: {
      x: Number(rect.x.toFixed(2)),
      y: Number(rect.y.toFixed(2)),
      width: Number(rect.width.toFixed(2)),
      height: Number(rect.height.toFixed(2)),
      devicePixelRatio: view.devicePixelRatio,
    },
    attributes: extractAttributes(element),
    outerHTMLExcerpt: capString(element.outerHTML, OUTER_HTML_EXCERPT_MAX),
    frame: {
      url: view.location.href,
      isMainFrame: view.top === view,
    },
  };
};
