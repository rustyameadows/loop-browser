import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { extractMarkdownFromHtml } from '../src/main/markdown';

describe('extractMarkdownFromHtml', () => {
  it('converts the local fixture into raw markdown', async () => {
    const html = await readFile('apps/desktop/static/local-fixture.html', 'utf8');
    const result = await extractMarkdownFromHtml({
      html,
      url: 'file:///tmp/local-fixture.html',
      fallbackTitle: 'Agent Browser Fixture',
    });

    expect(result.title).toBe('Agent Browser Fixture');
    expect(result.markdown).toContain('## Your local launchpad is up and humming.');
    expect(result.markdown).toContain('**Remote navigation**');
    expect(result.wordCount).toBeGreaterThan(10);
  });
});
