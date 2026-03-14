import { spawn } from 'node:child_process'
import { access, mkdir, mkdtemp, readFile, rm, readdir } from 'node:fs/promises'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const EXPECTED_TOOLS = [
  'browser.listTabs',
  'page.navigate',
  'picker.enable',
  'picker.disable',
  'picker.lastSelection',
  'page.viewAsMarkdown',
]

const LOG_LIMIT = 20_000
const REGISTRATION_TIMEOUT_MS = 60_000
const REQUEST_TIMEOUT_MS = 15_000
const SHUTDOWN_TIMEOUT_MS = 10_000

const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(scriptDir, '..')
const runtime = process.argv[2]

if (runtime !== 'dev' && runtime !== 'packaged') {
  console.error('Usage: node scripts/mcp-smoke.mjs <dev|packaged>')
  process.exit(1)
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

const appendLog = (current, chunk) => {
  const next = `${current}${chunk}`
  return next.length > LOG_LIMIT ? next.slice(-LOG_LIMIT) : next
}

const assert = (condition, message) => {
  if (!condition) {
    throw new Error(message)
  }
}

const findFreePort = async () =>
  new Promise((resolve, reject) => {
    const server = net.createServer()

    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      if (!address || typeof address === 'string') {
        server.close(() => reject(new Error('Could not allocate a free port.')))
        return
      }

      const { port } = address
      server.close((error) => {
        if (error) {
          reject(error)
          return
        }

        resolve(port)
      })
    })
  })

const waitForFile = async (filePath, timeoutMs, childState) => {
  const startedAt = Date.now()

  while (Date.now() - startedAt < timeoutMs) {
    try {
      return JSON.parse(await readFile(filePath, 'utf8'))
    } catch {
      if (childState.exitCode !== null) {
        throw new Error(
          `App exited before writing registration file (exit ${childState.exitCode}, signal ${childState.signal ?? 'none'}).`,
        )
      }

      await sleep(250)
    }
  }

  throw new Error(`Timed out waiting for MCP registration file at ${filePath}.`)
}

const requestJson = async (url, init) => {
  const response = await fetch(url, {
    ...init,
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  })

  const text = await response.text()
  let json = null

  if (text.length > 0) {
    try {
      json = JSON.parse(text)
    } catch {
      json = text
    }
  }

  return {
    status: response.status,
    body: json,
    text,
  }
}

const makeRpcRequest = async (registration, method, params, id) => {
  const token = String(registration.transport.headers.Authorization).replace(/^Bearer\s+/, '')

  return requestJson(registration.transport.url, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id,
      method,
      params,
    }),
  })
}

const makeNotification = async (registration, method, params) => {
  const token = String(registration.transport.headers.Authorization).replace(/^Bearer\s+/, '')

  return requestJson(registration.transport.url, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      method,
      params,
    }),
  })
}

const findWorkspaceBinary = async () => {
  const electronBinary = path.join(
    repoRoot,
    'node_modules',
    'electron',
    'dist',
    'Electron.app',
    'Contents',
    'MacOS',
    'Electron',
  )
  const workspaceEntry = path.join(repoRoot, 'apps', 'desktop')
  const workspaceBundle = path.join(workspaceEntry, '.vite', 'build', 'index.js')

  await access(electronBinary)

  try {
    await access(workspaceBundle)
  } catch {
    throw new Error(
      'Could not find the built workspace app entrypoint. Run `npm run build` first.',
    )
  }

  return {
    command: electronBinary,
    args: [workspaceEntry],
  }
}

const findPackagedBinary = async () => {
  const preferredPath = path.join(
    repoRoot,
    'apps',
    'desktop',
    'out',
    `Agent Browser-darwin-${process.arch}`,
    'Agent Browser.app',
    'Contents',
    'MacOS',
    'Agent Browser',
  )

  try {
    await access(preferredPath)
    return preferredPath
  } catch {
    // Fall through to scanning the output directory.
  }

  const outDir = path.join(repoRoot, 'apps', 'desktop', 'out')
  const entries = await readdir(outDir, { withFileTypes: true })

  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    if (!entry.isDirectory() || !entry.name.startsWith('Agent Browser-darwin-')) {
      continue
    }

    const candidate = path.join(
      outDir,
      entry.name,
      'Agent Browser.app',
      'Contents',
      'MacOS',
      'Agent Browser',
    )

    try {
      await access(candidate)
      return candidate
    } catch {
      // Keep scanning for another packaged app candidate.
    }
  }

  throw new Error(
    'Could not find a packaged Agent Browser binary. Run `npm run build` first.',
  )
}

const spawnApp = async (mode, env, state) => {
  const spawnOptions = {
    cwd: repoRoot,
    env,
    detached: process.platform !== 'win32',
    stdio: ['ignore', 'pipe', 'pipe'],
  }

  const launch =
    mode === 'dev'
      ? await findWorkspaceBinary()
      : {
          command: await findPackagedBinary(),
          args: [],
        }

  const child = spawn(launch.command, launch.args, spawnOptions)

  child.stdout.on('data', (chunk) => {
    state.stdout = appendLog(state.stdout, String(chunk))
  })

  child.stderr.on('data', (chunk) => {
    state.stderr = appendLog(state.stderr, String(chunk))
  })

  const exitPromise = new Promise((resolve) => {
    child.once('exit', (code, signal) => {
      state.exitCode = code
      state.signal = signal
      resolve({ code, signal })
    })
  })

  return { child, exitPromise }
}

const terminateChild = async (child, exitPromise) => {
  if (child.exitCode !== null || child.signalCode !== null) {
    await exitPromise
    return
  }

  try {
    if (process.platform === 'win32') {
      child.kill('SIGTERM')
    } else if (child.pid) {
      process.kill(-child.pid, 'SIGTERM')
    }
  } catch {
    // Ignore shutdown errors and fall through to the wait/kill path.
  }

  const exited = await Promise.race([
    exitPromise.then(() => true),
    sleep(SHUTDOWN_TIMEOUT_MS).then(() => false),
  ])

  if (exited) {
    return
  }

  try {
    if (process.platform === 'win32') {
      child.kill('SIGKILL')
    } else if (child.pid) {
      process.kill(-child.pid, 'SIGKILL')
    }
  } catch {
    // Best effort cleanup.
  }

  await Promise.race([exitPromise, sleep(2_000)])
}

const state = {
  runtime,
  stdout: '',
  stderr: '',
  exitCode: null,
  signal: null,
  registration: null,
  requests: [],
}

const run = async () => {
  const smokeDir = await mkdtemp(path.join(os.tmpdir(), 'agent-browser-mcp-smoke-'))
  const userDataDir = path.join(smokeDir, 'user-data')
  const fixtureUrl = pathToFileURL(
    path.join(repoRoot, 'apps', 'desktop', 'static', 'local-fixture.html'),
  ).toString()
  const port = await findFreePort()

  await mkdir(userDataDir, { recursive: true })

  const env = {
    ...process.env,
    AGENT_BROWSER_USER_DATA_DIR: userDataDir,
    AGENT_BROWSER_TOOL_SERVER_PORT: String(port),
    AGENT_BROWSER_START_URL: 'about:blank',
  }

  const registrationPath = path.join(userDataDir, 'mcp-registration.json')
  const { child, exitPromise } = await spawnApp(runtime, env, state)

  try {
    const registration = await waitForFile(registrationPath, REGISTRATION_TIMEOUT_MS, state)
    state.registration = registration

    const registrationUrl = new URL(registration.transport.url)
    assert(registrationUrl.port === String(port), 'Registration file did not use the overridden MCP port.')
    assert(
      String(registration.transport.headers.Authorization).startsWith('Bearer '),
      'Registration file did not include a bearer token.',
    )

    const unauthorized = await requestJson(registration.transport.url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 0,
        method: 'initialize',
        params: {},
      }),
    })
    state.requests.push({ name: 'unauthorized.initialize', status: unauthorized.status, body: unauthorized.body })
    assert(unauthorized.status === 401, 'Unauthorized initialize request should return 401.')

    const initialize = await makeRpcRequest(registration, 'initialize', {}, 1)
    state.requests.push({ name: 'initialize', status: initialize.status, body: initialize.body })
    assert(initialize.status === 200, 'initialize should return 200.')
    assert(
      initialize.body?.result?.serverInfo?.name === 'agent-browser',
      'initialize did not return the expected server info.',
    )

    const initialized = await makeNotification(registration, 'notifications/initialized', {})
    state.requests.push({
      name: 'notifications/initialized',
      status: initialized.status,
      body: initialized.body,
    })
    assert(initialized.status === 202, 'notifications/initialized should return 202.')

    const tools = await makeRpcRequest(registration, 'tools/list', {}, 2)
    state.requests.push({ name: 'tools/list', status: tools.status, body: tools.body })
    assert(tools.status === 200, 'tools/list should return 200.')

    const toolNames = tools.body?.result?.tools?.map((tool) => tool.name) ?? []
    for (const toolName of EXPECTED_TOOLS) {
      assert(toolNames.includes(toolName), `tools/list did not include ${toolName}.`)
    }

    const navigate = await makeRpcRequest(
      registration,
      'tools/call',
      {
        name: 'page.navigate',
        arguments: {
          target: fixtureUrl,
        },
      },
      3,
    )
    state.requests.push({ name: 'tools/call:page.navigate', status: navigate.status, body: navigate.body })
    assert(navigate.status === 200, 'page.navigate should return 200.')
    assert(
      navigate.body?.result?.structuredContent?.navigation?.url === fixtureUrl,
      'page.navigate did not navigate to the expected fixture URL.',
    )

    const listTabs = await makeRpcRequest(
      registration,
      'tools/call',
      {
        name: 'browser.listTabs',
        arguments: {},
      },
      4,
    )
    state.requests.push({ name: 'tools/call:browser.listTabs', status: listTabs.status, body: listTabs.body })
    assert(listTabs.status === 200, 'browser.listTabs should return 200.')
    assert(
      listTabs.body?.result?.structuredContent?.tabs?.[0]?.url === fixtureUrl,
      'browser.listTabs did not return the navigated fixture URL.',
    )

    const markdown = await makeRpcRequest(
      registration,
      'tools/call',
      {
        name: 'page.viewAsMarkdown',
        arguments: {
          forceRefresh: true,
        },
      },
      5,
    )
    state.requests.push({
      name: 'tools/call:page.viewAsMarkdown',
      status: markdown.status,
      body: markdown.body,
    })
    assert(markdown.status === 200, 'page.viewAsMarkdown should return 200.')
    assert(
      markdown.body?.result?.structuredContent?.url === fixtureUrl,
      'page.viewAsMarkdown did not report the fixture URL.',
    )
    assert(
      markdown.body?.result?.structuredContent?.title === 'Agent Browser Fixture',
      'page.viewAsMarkdown did not return the expected fixture title.',
    )
    assert(
      markdown.body?.result?.structuredContent?.markdown?.includes('Local Fixture Loaded'),
      'page.viewAsMarkdown did not contain the expected fixture Markdown.',
    )

    console.log(
      JSON.stringify(
        {
          runtime,
          registration,
          verifiedTools: toolNames,
          navigatedUrl: fixtureUrl,
          markdownTitle: markdown.body.result.structuredContent.title,
        },
        null,
        2,
      ),
    )
  } catch (error) {
    console.error(
      JSON.stringify(
        {
          runtime,
          error: error instanceof Error ? error.message : String(error),
          registrationPath,
          state,
        },
        null,
        2,
      ),
    )
    process.exitCode = 1
  } finally {
    await terminateChild(child, exitPromise)
    await rm(smokeDir, { recursive: true, force: true })
  }
}

await run()
