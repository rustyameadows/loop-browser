import { describe, expect, it } from 'vitest';
import {
  createEmptyMarkdownViewState,
  isMarkdownViewCommand,
  isMarkdownViewState,
} from '../src/index';

describe('markdown view protocol guards', () => {
  it('accepts valid commands', () => {
    expect(isMarkdownViewCommand({ action: 'open' })).toBe(true);
    expect(isMarkdownViewCommand({ action: 'toggle' })).toBe(true);
    expect(isMarkdownViewCommand({ action: 'refresh', force: true })).toBe(true);
    expect(
      isMarkdownViewCommand({ action: 'setPresentation', mode: 'sidebar', side: 'left' }),
    ).toBe(true);
    expect(
      isMarkdownViewCommand({ action: 'moveFloatingPill', deltaX: 8, deltaY: 4 }),
    ).toBe(true);
  });

  it('accepts a valid markdown state', () => {
    expect(
      isMarkdownViewState({
        ...createEmptyMarkdownViewState(),
        isOpen: true,
        status: 'ready',
        sourceUrl: 'https://example.com',
        title: 'Example Domain',
        markdown: '# Example',
        author: null,
        site: 'example.com',
        wordCount: 42,
      }),
    ).toBe(true);
  });

  it('rejects malformed markdown payloads', () => {
    expect(isMarkdownViewCommand({ action: 'refresh', force: 'yes' })).toBe(false);
    expect(
      isMarkdownViewCommand({ action: 'setPresentation', mode: 'sidebar', side: 'bottom' }),
    ).toBe(false);
    expect(
      isMarkdownViewCommand({ action: 'moveFloatingPill', deltaX: '8', deltaY: 4 }),
    ).toBe(false);
    expect(
      isMarkdownViewState({
        ...createEmptyMarkdownViewState(),
        status: 'done',
      }),
    ).toBe(false);
  });
});
