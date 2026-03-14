import path from 'node:path'

export const DEFAULT_TOOL_SERVER_PORT = 46255

export interface RuntimeConfig {
  userDataDir: string | null
  toolServerPort: number
  startUrl: string | null
}

const normalizeOptionalValue = (value: string | undefined): string | null => {
  const trimmed = value?.trim()
  return trimmed ? trimmed : null
}

const parsePort = (value: string | null): number => {
  if (value === null) {
    return DEFAULT_TOOL_SERVER_PORT
  }

  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed < 0 || parsed > 65_535) {
    throw new Error(
      'AGENT_BROWSER_TOOL_SERVER_PORT must be an integer between 0 and 65535.',
    )
  }

  return parsed
}

export const resolveRuntimeConfig = (env: NodeJS.ProcessEnv): RuntimeConfig => {
  const userDataDir = normalizeOptionalValue(env.AGENT_BROWSER_USER_DATA_DIR)
  const startUrl = normalizeOptionalValue(env.AGENT_BROWSER_START_URL)

  return {
    userDataDir: userDataDir ? path.resolve(userDataDir) : null,
    toolServerPort: parsePort(normalizeOptionalValue(env.AGENT_BROWSER_TOOL_SERVER_PORT)),
    startUrl,
  }
}
