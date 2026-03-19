import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  DEFAULT_TOOL_SERVER_PORT,
  resolveRuntimeConfig,
} from '../src/main/runtime-config'
import { deriveProjectUserDataDir } from '../src/main/project-appearance'

describe('resolveRuntimeConfig', () => {
  it('returns defaults when no overrides are present', () => {
    expect(resolveRuntimeConfig({}, '/tmp/loop-project', '/Users/tester', 'darwin')).toEqual({
      projectRoot: null,
      userDataDir: null,
      toolServerPort: DEFAULT_TOOL_SERVER_PORT,
      startUrl: null,
    })
  })

  it('resolves explicit overrides', () => {
    expect(
      resolveRuntimeConfig({
        AGENT_BROWSER_PROJECT_ROOT: 'projects/client-a',
        AGENT_BROWSER_USER_DATA_DIR: 'tmp/agent-browser-smoke',
        AGENT_BROWSER_TOOL_SERVER_PORT: '49152',
        AGENT_BROWSER_START_URL: 'about:blank',
      }, '/tmp/loop-project'),
    ).toEqual({
      projectRoot: '/tmp/loop-project/projects/client-a',
      userDataDir: '/tmp/loop-project/tmp/agent-browser-smoke',
      toolServerPort: 49_152,
      startUrl: 'about:blank',
    })
  })

  it('derives a project-scoped user data directory when only a project root override is present', () => {
    expect(
      resolveRuntimeConfig({
        AGENT_BROWSER_PROJECT_ROOT: '/tmp/loop-project',
      }, '/tmp/ignored', '/Users/tester', 'darwin'),
    ).toEqual({
      projectRoot: '/tmp/loop-project',
      userDataDir: deriveProjectUserDataDir('/tmp/loop-project', 'darwin', '/Users/tester'),
      toolServerPort: DEFAULT_TOOL_SERVER_PORT,
      startUrl: null,
    })
  })

  it('rejects invalid tool-server ports', () => {
    expect(() =>
      resolveRuntimeConfig({
        AGENT_BROWSER_TOOL_SERVER_PORT: 'not-a-port',
      }, '/tmp/loop-project'),
    ).toThrow('AGENT_BROWSER_TOOL_SERVER_PORT must be an integer between 0 and 65535.')

    expect(() =>
      resolveRuntimeConfig({
        AGENT_BROWSER_TOOL_SERVER_PORT: '70000',
      }, '/tmp/loop-project'),
    ).toThrow('AGENT_BROWSER_TOOL_SERVER_PORT must be an integer between 0 and 65535.')
  })
})
