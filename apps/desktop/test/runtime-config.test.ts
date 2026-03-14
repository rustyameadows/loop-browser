import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  DEFAULT_TOOL_SERVER_PORT,
  resolveRuntimeConfig,
} from '../src/main/runtime-config'

describe('resolveRuntimeConfig', () => {
  it('returns defaults when no overrides are present', () => {
    expect(resolveRuntimeConfig({})).toEqual({
      userDataDir: null,
      toolServerPort: DEFAULT_TOOL_SERVER_PORT,
      startUrl: null,
    })
  })

  it('resolves explicit overrides', () => {
    expect(
      resolveRuntimeConfig({
        AGENT_BROWSER_USER_DATA_DIR: 'tmp/agent-browser-smoke',
        AGENT_BROWSER_TOOL_SERVER_PORT: '49152',
        AGENT_BROWSER_START_URL: 'about:blank',
      }),
    ).toEqual({
      userDataDir: path.resolve('tmp/agent-browser-smoke'),
      toolServerPort: 49_152,
      startUrl: 'about:blank',
    })
  })

  it('rejects invalid tool-server ports', () => {
    expect(() =>
      resolveRuntimeConfig({
        AGENT_BROWSER_TOOL_SERVER_PORT: 'not-a-port',
      }),
    ).toThrow('AGENT_BROWSER_TOOL_SERVER_PORT must be an integer between 0 and 65535.')

    expect(() =>
      resolveRuntimeConfig({
        AGENT_BROWSER_TOOL_SERVER_PORT: '70000',
      }),
    ).toThrow('AGENT_BROWSER_TOOL_SERVER_PORT must be an integer between 0 and 65535.')
  })
})
