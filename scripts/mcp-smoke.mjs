import { spawn } from 'node:child_process'
import { access, mkdir, mkdtemp, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const EXPECTED_TOOLS = [
  'browser.listTabs',
  'browser.getWindowState',
  'browser.resizeWindow',
  'chrome.getAppearance',
  'chrome.setAppearance',
  'chrome.resetAppearance',
  'page.navigate',
  'picker.enable',
  'picker.disable',
  'picker.lastSelection',
  'page.viewAsMarkdown',
  'page.screenshot',
  'artifacts.get',
  'artifacts.list',
  'artifacts.delete',
]

const LOG_LIMIT = 20_000
const REGISTRATION_TIMEOUT_MS = 60_000
const REQUEST_TIMEOUT_MS = 15_000
const SHUTDOWN_TIMEOUT_MS = 10_000
const SMOKE_CHROME_COLOR = '#EAF3FF'
const SMOKE_ACCENT_COLOR = '#FF6B35'
const UPDATED_ACCENT_COLOR = '#0A84FF'
const SMOKE_PROJECT_ICON_FILE = 'project-icon.svg'

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

const assertFileExists = async (filePath, message) => {
  try {
    await access(filePath)
  } catch {
    throw new Error(message)
  }
}

const assertSamePath = async (actualPath, expectedPath, message) => {
  const [resolvedActualPath, resolvedExpectedPath] = await Promise.all([
    realpath(actualPath),
    realpath(expectedPath),
  ])

  assert(resolvedActualPath === resolvedExpectedPath, message)
}

const writeSmokeProjectFixture = async (smokeDir) => {
  const projectRoot = path.join(smokeDir, 'project')

  await mkdir(projectRoot, { recursive: true })

  const resolvedProjectRoot = await realpath(projectRoot)
  const configPath = path.join(resolvedProjectRoot, '.loop-browser.json')
  const projectIconPath = path.join(resolvedProjectRoot, SMOKE_PROJECT_ICON_FILE)

  await writeFile(
    projectIconPath,
    [
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256">',
      '  <rect width="256" height="256" rx="48" fill="#18304F" />',
      '  <circle cx="128" cy="112" r="54" fill="#FF6B35" />',
      '  <path d="M74 176h108v22H74z" fill="#F6F9FF" />',
      '</svg>',
      '',
    ].join('\n'),
    'utf8',
  )

  await writeFile(
    configPath,
    `${JSON.stringify(
      {
        version: 1,
        chrome: {
          chromeColor: SMOKE_CHROME_COLOR,
          accentColor: SMOKE_ACCENT_COLOR,
          projectIconPath: `./${SMOKE_PROJECT_ICON_FILE}`,
        },
      },
      null,
      2,
    )}\n`,
    'utf8',
  )

  return {
    projectRoot: resolvedProjectRoot,
    configPath,
    projectIconPath,
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
    `Loop Browser-darwin-${process.arch}`,
    'Loop Browser.app',
    'Contents',
    'MacOS',
    'Loop Browser',
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
    if (!entry.isDirectory() || !entry.name.startsWith('Loop Browser-darwin-')) {
      continue
    }

    const candidate = path.join(
      outDir,
      entry.name,
      'Loop Browser.app',
      'Contents',
      'MacOS',
      'Loop Browser',
    )

    try {
      await access(candidate)
      return candidate
    } catch {
      // Keep scanning for another packaged app candidate.
    }
  }

  throw new Error(
    'Could not find a packaged Loop Browser binary. Run `npm run build` first.',
  )
}

const spawnApp = async (mode, env, cwd, state) => {
  const spawnOptions = {
    cwd,
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
  const projectFixture = await writeSmokeProjectFixture(smokeDir)
  const fixtureUrl = pathToFileURL(
    path.join(repoRoot, 'apps', 'desktop', 'static', 'local-fixture.html'),
  ).toString()
  const port = await findFreePort()

  await mkdir(userDataDir, { recursive: true })

  const env = {
    ...process.env,
    AGENT_BROWSER_PROJECT_ROOT: projectFixture.projectRoot,
    AGENT_BROWSER_USER_DATA_DIR: userDataDir,
    AGENT_BROWSER_TOOL_SERVER_PORT: String(port),
    AGENT_BROWSER_START_URL: 'about:blank',
  }

  const registrationPath = path.join(userDataDir, 'mcp-registration.json')
  const { child, exitPromise } = await spawnApp(runtime, env, repoRoot, state)

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

    const initialAppearance = await makeRpcRequest(
      registration,
      'tools/call',
      {
        name: 'chrome.getAppearance',
        arguments: {},
      },
      3,
    )
    state.requests.push({
      name: 'tools/call:chrome.getAppearance',
      status: initialAppearance.status,
      body: initialAppearance.body,
    })
    assert(initialAppearance.status === 200, 'chrome.getAppearance should return 200.')
    const initialAppearanceState = initialAppearance.body?.result?.structuredContent?.appearance
    await assertSamePath(
      initialAppearanceState?.projectRoot,
      projectFixture.projectRoot,
      'chrome.getAppearance did not report the smoke project root.',
    )
    await assertSamePath(
      initialAppearanceState?.configPath,
      projectFixture.configPath,
      'chrome.getAppearance did not report the smoke config path.',
    )
    assert(
      initialAppearanceState?.chromeColor === SMOKE_CHROME_COLOR,
      'chrome.getAppearance did not load the configured chrome color.',
    )
    assert(
      initialAppearanceState?.accentColor === SMOKE_ACCENT_COLOR,
      'chrome.getAppearance did not load the configured accent color.',
    )
    assert(
      initialAppearanceState?.projectIconPath === `./${SMOKE_PROJECT_ICON_FILE}`,
      'chrome.getAppearance did not load the configured project icon path.',
    )
    await assertSamePath(
      initialAppearanceState?.resolvedProjectIconPath,
      projectFixture.projectIconPath,
      'chrome.getAppearance did not resolve the project icon path relative to the smoke project.',
    )

    const updatedAppearance = await makeRpcRequest(
      registration,
      'tools/call',
      {
        name: 'chrome.setAppearance',
        arguments: {
          accentColor: UPDATED_ACCENT_COLOR,
        },
      },
      4,
    )
    state.requests.push({
      name: 'tools/call:chrome.setAppearance',
      status: updatedAppearance.status,
      body: updatedAppearance.body,
    })
    assert(updatedAppearance.status === 200, 'chrome.setAppearance should return 200.')
    const updatedAppearanceState = updatedAppearance.body?.result?.structuredContent?.appearance
    assert(
      updatedAppearanceState?.accentColor === UPDATED_ACCENT_COLOR,
      'chrome.setAppearance did not apply the requested accent color.',
    )
    const persistedAppearance = JSON.parse(await readFile(projectFixture.configPath, 'utf8'))
    assert(
      persistedAppearance?.chrome?.accentColor === UPDATED_ACCENT_COLOR,
      'chrome.setAppearance did not persist the updated accent color to .loop-browser.json.',
    )

    const navigate = await makeRpcRequest(
      registration,
      'tools/call',
      {
        name: 'page.navigate',
        arguments: {
          target: fixtureUrl,
        },
      },
      5,
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
      6,
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
      7,
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
      markdown.body?.result?.structuredContent?.title === 'Loop Fixture',
      'page.viewAsMarkdown did not return the expected fixture title.',
    )
    assert(
      markdown.body?.result?.structuredContent?.markdown?.includes(
        'Your local launchpad is ready.',
      ),
      'page.viewAsMarkdown did not contain the expected fixture Markdown.',
    )

    const windowState = await makeRpcRequest(
      registration,
      'tools/call',
      {
        name: 'browser.getWindowState',
        arguments: {},
      },
      8,
    )
    state.requests.push({
      name: 'tools/call:browser.getWindowState',
      status: windowState.status,
      body: windowState.body,
    })
    assert(windowState.status === 200, 'browser.getWindowState should return 200.')
    assert(
      typeof windowState.body?.result?.structuredContent?.window?.chromeHeight === 'number',
      'browser.getWindowState did not return a valid window payload.',
    )

    const resized = await makeRpcRequest(
      registration,
      'tools/call',
      {
        name: 'browser.resizeWindow',
        arguments: {
          width: 1280,
          height: 720,
          target: 'pageViewport',
        },
      },
      9,
    )
    state.requests.push({
      name: 'tools/call:browser.resizeWindow',
      status: resized.status,
      body: resized.body,
    })
    assert(resized.status === 200, 'browser.resizeWindow should return 200.')
    assert(
      resized.body?.result?.structuredContent?.window?.pageViewportBounds?.width === 1280,
      'browser.resizeWindow did not apply the requested viewport width.',
    )
    assert(
      resized.body?.result?.structuredContent?.window?.pageViewportBounds?.height === 720,
      'browser.resizeWindow did not apply the requested viewport height.',
    )

    const pageScreenshot = await makeRpcRequest(
      registration,
      'tools/call',
      {
        name: 'page.screenshot',
        arguments: {
          target: 'page',
          fileNameHint: 'fixture-page',
        },
      },
      10,
    )
    state.requests.push({
      name: 'tools/call:page.screenshot:page',
      status: pageScreenshot.status,
      body: pageScreenshot.body,
    })
    assert(pageScreenshot.status === 200, 'page.screenshot(page) should return 200.')
    const pageArtifact = pageScreenshot.body?.result?.structuredContent
    assert(typeof pageArtifact?.artifactId === 'string', 'page.screenshot(page) did not return an artifact id.')
    assert(pageArtifact.target === 'page', 'page.screenshot(page) returned the wrong target.')
    assert(pageArtifact.pixelWidth >= 1280, 'page.screenshot(page) did not honor the resized viewport width.')
    assert(pageArtifact.pixelHeight >= 720, 'page.screenshot(page) did not honor the resized viewport height.')

    const elementScreenshot = await makeRpcRequest(
      registration,
      'tools/call',
      {
        name: 'page.screenshot',
        arguments: {
          target: 'element',
          selector: '.card',
          fileNameHint: 'fixture-card',
        },
      },
      11,
    )
    state.requests.push({
      name: 'tools/call:page.screenshot:element',
      status: elementScreenshot.status,
      body: elementScreenshot.body,
    })
    assert(elementScreenshot.status === 200, 'page.screenshot(element) should return 200.')
    const elementArtifact = elementScreenshot.body?.result?.structuredContent
    assert(typeof elementArtifact?.artifactId === 'string', 'page.screenshot(element) did not return an artifact id.')
    assert(elementArtifact.target === 'element', 'page.screenshot(element) returned the wrong target.')
    assert(elementArtifact.pixelWidth > 0, 'page.screenshot(element) returned an invalid width.')
    assert(elementArtifact.pixelHeight > 0, 'page.screenshot(element) returned an invalid height.')

    const windowScreenshot = await makeRpcRequest(
      registration,
      'tools/call',
      {
        name: 'page.screenshot',
        arguments: {
          target: 'window',
          fileNameHint: 'fixture-window',
        },
      },
      12,
    )
    state.requests.push({
      name: 'tools/call:page.screenshot:window',
      status: windowScreenshot.status,
      body: windowScreenshot.body,
    })
    assert(windowScreenshot.status === 200, 'page.screenshot(window) should return 200.')
    const windowArtifact = windowScreenshot.body?.result?.structuredContent
    assert(typeof windowArtifact?.artifactId === 'string', 'page.screenshot(window) did not return an artifact id.')
    assert(windowArtifact.target === 'window', 'page.screenshot(window) returned the wrong target.')

    const pageArtifactRecord = await makeRpcRequest(
      registration,
      'tools/call',
      {
        name: 'artifacts.get',
        arguments: {
          artifactId: pageArtifact.artifactId,
        },
      },
      13,
    )
    state.requests.push({
      name: 'tools/call:artifacts.get:page',
      status: pageArtifactRecord.status,
      body: pageArtifactRecord.body,
    })
    assert(pageArtifactRecord.status === 200, 'artifacts.get(page) should return 200.')
    const pageArtifactFile = pageArtifactRecord.body?.result?.structuredContent?.artifact?.filePath
    assert(typeof pageArtifactFile === 'string', 'artifacts.get(page) did not return a file path.')
    await assertFileExists(pageArtifactFile, 'artifacts.get(page) returned a missing file path.')

    const windowArtifactRecord = await makeRpcRequest(
      registration,
      'tools/call',
      {
        name: 'artifacts.get',
        arguments: {
          artifactId: windowArtifact.artifactId,
        },
      },
      14,
    )
    state.requests.push({
      name: 'tools/call:artifacts.get:window',
      status: windowArtifactRecord.status,
      body: windowArtifactRecord.body,
    })
    assert(windowArtifactRecord.status === 200, 'artifacts.get(window) should return 200.')
    const windowArtifactFile = windowArtifactRecord.body?.result?.structuredContent?.artifact?.filePath
    assert(typeof windowArtifactFile === 'string', 'artifacts.get(window) did not return a file path.')
    await assertFileExists(windowArtifactFile, 'artifacts.get(window) returned a missing file path.')

    const listedArtifacts = await makeRpcRequest(
      registration,
      'tools/call',
      {
        name: 'artifacts.list',
        arguments: {},
      },
      15,
    )
    state.requests.push({
      name: 'tools/call:artifacts.list',
      status: listedArtifacts.status,
      body: listedArtifacts.body,
    })
    assert(listedArtifacts.status === 200, 'artifacts.list should return 200.')
    const artifactIds =
      listedArtifacts.body?.result?.structuredContent?.artifacts?.map((artifact) => artifact.artifactId) ?? []
    assert(artifactIds.includes(pageArtifact.artifactId), 'artifacts.list did not include the page screenshot artifact.')
    assert(
      artifactIds.includes(elementArtifact.artifactId),
      'artifacts.list did not include the element screenshot artifact.',
    )
    assert(
      artifactIds.includes(windowArtifact.artifactId),
      'artifacts.list did not include the window screenshot artifact.',
    )

    const deleteArtifact = await makeRpcRequest(
      registration,
      'tools/call',
      {
        name: 'artifacts.delete',
        arguments: {
          artifactId: elementArtifact.artifactId,
        },
      },
      16,
    )
    state.requests.push({
      name: 'tools/call:artifacts.delete',
      status: deleteArtifact.status,
      body: deleteArtifact.body,
    })
    assert(deleteArtifact.status === 200, 'artifacts.delete should return 200.')
    assert(
      deleteArtifact.body?.result?.structuredContent?.artifact?.deleted === true,
      'artifacts.delete did not confirm deletion.',
    )

    console.log(
      JSON.stringify(
        {
          runtime,
          registration,
          verifiedTools: toolNames,
          appearance: {
            projectRoot: initialAppearanceState.projectRoot,
            chromeColor: initialAppearanceState.chromeColor,
            accentColor: updatedAppearanceState.accentColor,
            projectIconPath: initialAppearanceState.projectIconPath,
          },
          navigatedUrl: fixtureUrl,
          markdownTitle: markdown.body.result.structuredContent.title,
          artifactIds: {
            page: pageArtifact.artifactId,
            element: elementArtifact.artifactId,
            window: windowArtifact.artifactId,
          },
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
