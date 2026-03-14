import { describe, expect, it } from 'vitest';
import {
  ATTRIBUTE_VALUE_MAX,
  OUTER_HTML_EXCERPT_MAX,
  TEXT_SNIPPET_MAX,
  capString,
  normalizeWhitespace,
} from '../src/index';

describe('normalizeWhitespace', () => {
  it('collapses mixed whitespace and trims the result', () => {
    expect(normalizeWhitespace('  hello \n\t world   ')).toBe('hello world');
  });
});

describe('capString', () => {
  it('leaves short values unchanged', () => {
    expect(capString('agent-browser', 40)).toBe('agent-browser');
  });

  it('adds an ellipsis when the value exceeds the limit', () => {
    expect(capString('abcdef', 5)).toBe('ab...');
  });
});

describe('selector caps', () => {
  it('keeps the exported cap constants stable', () => {
    expect(TEXT_SNIPPET_MAX).toBe(120);
    expect(ATTRIBUTE_VALUE_MAX).toBe(200);
    expect(OUTER_HTML_EXCERPT_MAX).toBe(1200);
  });
});
