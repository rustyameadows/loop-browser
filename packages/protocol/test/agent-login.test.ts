import { describe, expect, it } from 'vitest';
import {
  createEmptyProjectAgentLoginState,
  isProjectAgentLoginSaveRequest,
  isProjectAgentLoginState,
} from '../src';

describe('isProjectAgentLoginState', () => {
  it('accepts a valid non-secret project agent login state shape', () => {
    expect(
      isProjectAgentLoginState({
        ...createEmptyProjectAgentLoginState(),
        projectRoot: '/tmp/project',
        filePath: '/tmp/project/.loop-browser.local.json',
        username: 'dev@example.com',
        hasPassword: true,
        isGitIgnored: true,
        source: 'local-file',
      }),
    ).toBe(true);
  });

  it('rejects malformed project agent login state values', () => {
    expect(
      isProjectAgentLoginState({
        ...createEmptyProjectAgentLoginState(),
        hasPassword: 'yes',
      }),
    ).toBe(false);
  });
});

describe('isProjectAgentLoginSaveRequest', () => {
  it('accepts username/password save requests', () => {
    expect(
      isProjectAgentLoginSaveRequest({
        username: 'dev@example.com',
        password: 'password123',
      }),
    ).toBe(true);
  });

  it('rejects malformed save requests', () => {
    expect(
      isProjectAgentLoginSaveRequest({
        username: 'dev@example.com',
      }),
    ).toBe(false);
  });
});
