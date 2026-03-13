import { describe, expect, it } from 'vitest';
import { fixtureFilePath, fixtureFileUrl, normalizeAddress } from '../src/main/url';

describe('normalizeAddress', () => {
  it('defaults bare hostnames to https', () => {
    expect(normalizeAddress('example.com')).toBe('https://example.com/');
  });

  it('preserves explicit http targets', () => {
    expect(normalizeAddress('http://example.com')).toBe('http://example.com/');
  });

  it('preserves explicit file URLs', () => {
    expect(normalizeAddress('file:///tmp/example.html')).toBe('file:///tmp/example.html');
  });

  it('defaults localhost targets to http', () => {
    expect(normalizeAddress('localhost:4173')).toBe('http://localhost:4173/');
  });
});

describe('fixtureFileUrl', () => {
  it('builds a development file URL for the local fixture', () => {
    const fixturePath = fixtureFilePath({
      appPath: '/tmp/agent-browser',
      isPackaged: false,
      resourcesPath: '/tmp/agent-browser/resources',
    });
    expect(
      fixtureFileUrl({
        appPath: '/tmp/agent-browser',
        isPackaged: false,
        resourcesPath: '/tmp/agent-browser/resources',
      }),
    ).toBe(`file://${fixturePath}`);
  });

  it('resolves packaged fixtures from the resources directory', () => {
    expect(
      fixtureFilePath({
        appPath: '/tmp/agent-browser/app.asar',
        isPackaged: true,
        resourcesPath: '/tmp/agent-browser/resources',
      }),
    ).toBe('/tmp/agent-browser/resources/static/local-fixture.html');
  });
});
