import { describe, expect, it } from 'vitest';
import {
  createEmptyFeedbackState,
  isFeedbackCommand,
  isFeedbackState,
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
    x: 12,
    y: 16,
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

describe('feedback protocol guards', () => {
  it('accepts valid commands and state payloads', () => {
    expect(
      isFeedbackCommand({
        action: 'startDraftFromSelection',
        selection: sampleSelection,
        intent: 'style',
        styleTweaks: [
          {
            property: 'color',
            value: '#112233',
            previousValue: 'rgb(12, 34, 56)',
          },
        ],
      }),
    ).toBe(true);
    expect(
      isFeedbackCommand({
        action: 'reply',
        annotationId: 'annotation-1',
        body: 'Looking at this now.',
        author: 'agent',
      }),
    ).toBe(true);
    expect(
      isFeedbackCommand({ action: 'setPresentation', mode: 'sidebar', side: 'right' }),
    ).toBe(true);
    expect(
      isFeedbackCommand({ action: 'moveFloatingPill', deltaX: 6, deltaY: 12 }),
    ).toBe(true);
    expect(
      isFeedbackState({
        ...createEmptyFeedbackState(),
        isOpen: true,
        draft: {
          ...createEmptyFeedbackState().draft,
          selection: sampleSelection,
          summary: 'Button copy is unclear',
          intent: 'style',
          styleTweaks: [
            {
              property: 'color',
              value: '#112233',
              previousValue: 'rgb(12, 34, 56)',
            },
          ],
        },
      }),
    ).toBe(true);
  });

  it('rejects malformed feedback payloads', () => {
    expect(
      isFeedbackCommand({
        action: 'setStatus',
        annotationId: 'annotation-1',
        status: 'done',
      }),
    ).toBe(false);
    expect(
      isFeedbackCommand({ action: 'setPresentation', mode: 'sidebar', side: 'bottom' }),
    ).toBe(false);
    expect(
      isFeedbackCommand({ action: 'moveFloatingPill', deltaX: '6', deltaY: 12 }),
    ).toBe(false);
    expect(
      isFeedbackState({
        ...createEmptyFeedbackState(),
        annotations: [{ id: 'missing-required-fields' }],
      }),
    ).toBe(false);
  });
});
