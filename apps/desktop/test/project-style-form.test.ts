import { describe, expect, it } from 'vitest';
import {
  getColorPickerValue,
  getDefaultUrlDraftError,
  getHexColorDraftError,
  normalizeHexColorDraft,
  resolveDraftProjectIconPath,
} from '../src/renderer/src/project-style-form';

describe('project style form helpers', () => {
  it('normalizes valid hex color drafts to uppercase', () => {
    expect(normalizeHexColorDraft('  #ab12cd  ')).toBe('#AB12CD');
  });

  it('reports field errors for invalid hex drafts', () => {
    expect(getHexColorDraftError('Chrome color', '')).toBe('Chrome color is required.');
    expect(getHexColorDraftError('Accent color', '#12AF')).toBe(
      'Accent color must be a hex color in the form #RRGGBB.',
    );
    expect(getHexColorDraftError('Accent color', '#12AF45')).toBeNull();
  });

  it('keeps the color picker bound to the last valid value', () => {
    expect(getColorPickerValue('#A1B2C3', '#FFFFFF')).toBe('#A1B2C3');
    expect(getColorPickerValue('#bad', '#112233')).toBe('#112233');
  });

  it('resolves draft icon paths from the current project folder', () => {
    expect(
      resolveDraftProjectIconPath(
        '/tmp/project',
        './assets/icon.png',
        '',
        null,
      ),
    ).toBe('/tmp/project/assets/icon.png');
  });

  it('reuses the applied resolved icon path when the draft matches the file-backed value', () => {
    expect(
      resolveDraftProjectIconPath(
        '/tmp/project',
        './assets/icon.png',
        './assets/icon.png',
        '/tmp/project/assets/icon.png',
      ),
    ).toBe('/tmp/project/assets/icon.png');
  });

  it('returns null when there is no project folder or draft icon path', () => {
    expect(resolveDraftProjectIconPath('', './assets/icon.png', '', null)).toBeNull();
    expect(resolveDraftProjectIconPath('/tmp/project', '', '', null)).toBeNull();
  });

  it('accepts empty and valid default URL drafts and rejects malformed ones', () => {
    expect(getDefaultUrlDraftError('')).toBeNull();
    expect(getDefaultUrlDraftError('http://127.0.0.1:3000')).toBeNull();
    expect(getDefaultUrlDraftError('localhost:3000')).toBeNull();
    expect(getDefaultUrlDraftError('://bad')).toBe('Default URL must be a valid URL or host.');
  });
});
