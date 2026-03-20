import { mkdtemp, mkdir, readFile, rm, unlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

const { spawnMock } = vi.hoisted(() => ({
  spawnMock: vi.fn(),
}));

vi.mock('node:child_process', () => ({
  spawn: spawnMock,
}));

vi.mock('electron', () => ({
  app: {
    getPath: () => '/tmp',
  },
  dialog: {
    showOpenDialog: vi.fn(async () => ({
      canceled: true,
      filePaths: [],
    })),
  },
}));

import { deriveProjectSessionSlug } from '../src/main/project-appearance';
import {
  ProjectSessionAdvertiser,
  SessionDirectoryController,
} from '../src/main/session-manager';
import type { BrowserShell } from '../src/main/browser-shell';

const originalFetch = globalThis.fetch;
const originalProcessKill = process.kill.bind(process);
const tempDirs: string[] = [];

afterEach(async () => {
  vi.restoreAllMocks();
  spawnMock.mockReset();
  globalThis.fetch = originalFetch;
  await Promise.all(
    tempDirs.splice(0).map(async (directory) => {
      await rm(directory, { recursive: true, force: true });
    }),
  );
});

const writeSessionRecord = async (
  clusterDir: string,
  options: {
    sessionId: string;
    projectRoot: string;
    projectName: string;
    isFocused?: boolean;
    chromeColor?: string;
    pid?: number;
  },
): Promise<void> => {
  const sessionsDir = path.join(clusterDir, 'sessions');
  await mkdir(sessionsDir, { recursive: true });
  await writeFile(
    path.join(sessionsDir, `${options.sessionId}.json`),
    `${JSON.stringify(
      {
        version: 1,
        sessionId: options.sessionId,
        summary: {
          sessionId: options.sessionId,
          projectRoot: options.projectRoot,
          projectName: options.projectName,
          chromeColor: options.chromeColor ?? '#F297E7',
          projectIconPath: '',
          isFocused: options.isFocused ?? false,
          isHome: false,
          dockIconStatus: 'applied',
          status: 'ready',
        },
        connection: {
          url: `http://127.0.0.1/${options.sessionId}`,
          token: `${options.sessionId}-token`,
        },
        updatedAt: '2026-03-19T19:00:00.000Z',
        pid: options.pid ?? process.pid,
      },
      null,
      2,
    )}\n`,
    'utf8',
  );
};

const readSessionRecord = async (clusterDir: string, sessionId: string): Promise<{
  summary: {
    isFocused: boolean;
  };
}> => {
  const filePath = path.join(clusterDir, 'sessions', `${sessionId}.json`);

  for (let attempt = 0; attempt < 10; attempt += 1) {
    try {
      return JSON.parse(await readFile(filePath, 'utf8')) as {
        summary: {
          isFocused: boolean;
        };
      };
    } catch (error) {
      if (
        !(error instanceof SyntaxError) &&
        !(error instanceof Error && error.message.includes('ENOENT'))
      ) {
        throw error;
      }
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  }

  throw new Error(`Could not read a complete session record for ${sessionId}.`);
};

describe('SessionDirectoryController', () => {
  it('reads, orders, and removes session records from the cluster directory', async () => {
    const clusterDir = await mkdtemp(path.join(os.tmpdir(), 'agent-browser-session-cluster-'));
    tempDirs.push(clusterDir);

    await writeSessionRecord(clusterDir, {
      sessionId: 'alpha-11111111',
      projectRoot: '/tmp/alpha',
      projectName: 'alpha',
    });
    await writeSessionRecord(clusterDir, {
      sessionId: 'beta-22222222',
      projectRoot: '/tmp/beta',
      projectName: 'beta',
      isFocused: true,
    });

    const controller = new SessionDirectoryController({
      role: 'launcher',
      clusterDir,
      currentSessionId: null,
    });

    await controller.start();
    expect(controller.listSessions().map((session) => session.sessionId)).toEqual([
      'beta-22222222',
      'alpha-11111111',
    ]);
    expect(controller.getCurrentSession()?.sessionId).toBe('beta-22222222');

    await unlink(path.join(clusterDir, 'sessions', 'beta-22222222.json'));
    await controller.executeCommand({ action: 'refresh' });
    expect(controller.listSessions().map((session) => session.sessionId)).toEqual([
      'alpha-11111111',
    ]);
    expect(controller.getCurrentSession()?.sessionId).toBe('alpha-11111111');

    await controller.dispose();
  });

  it('prunes stale crashed sessions during refresh', async () => {
    const clusterDir = await mkdtemp(path.join(os.tmpdir(), 'agent-browser-session-cluster-'));
    tempDirs.push(clusterDir);

    await writeSessionRecord(clusterDir, {
      sessionId: 'stale-11111111',
      projectRoot: '/tmp/stale',
      projectName: 'stale',
      pid: 424242,
    });

    vi.spyOn(process, 'kill').mockImplementation(((pid: number, signal?: number | NodeJS.Signals) => {
      if (pid === 424242 && signal === 0) {
        const error = new Error('No such process') as NodeJS.ErrnoException;
        error.code = 'ESRCH';
        throw error;
      }

      return originalProcessKill(pid, signal);
    }) as typeof process.kill);

    const controller = new SessionDirectoryController({
      role: 'launcher',
      clusterDir,
      currentSessionId: null,
    });

    await controller.start();
    expect(controller.listSessions()).toEqual([]);
    await expect(readFile(path.join(clusterDir, 'sessions', 'stale-11111111.json'), 'utf8')).rejects.toThrow();

    await controller.dispose();
  });

  it('focuses an existing session instead of spawning a duplicate project session', async () => {
    const clusterDir = await mkdtemp(path.join(os.tmpdir(), 'agent-browser-session-cluster-'));
    tempDirs.push(clusterDir);

    const projectRoot = '/tmp/client-a';
    const sessionId = deriveProjectSessionSlug(projectRoot);
    await writeSessionRecord(clusterDir, {
      sessionId,
      projectRoot,
      projectName: 'client-a',
      isFocused: false,
    });

    const fetchMock = vi.fn(async () => {
      await writeSessionRecord(clusterDir, {
        sessionId,
        projectRoot,
        projectName: 'client-a',
        isFocused: true,
      });

      return new Response(
        JSON.stringify({
          jsonrpc: '2.0',
          id: 'internal/sessionFocus',
          result: { ok: true },
        }),
        {
          status: 200,
          headers: {
            'content-type': 'application/json',
          },
        },
      );
    });
    (globalThis as { fetch?: typeof fetch }).fetch = fetchMock;

    const controller = new SessionDirectoryController({
      role: 'launcher',
      clusterDir,
      currentSessionId: null,
    });

    await controller.start();
    await controller.executeCommand({
      action: 'openProject',
      projectRoot,
    });

    expect(spawnMock).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const firstFetchCall = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(firstFetchCall[0]).toBe(`http://127.0.0.1/${sessionId}`);
    expect(firstFetchCall[1]).toMatchObject({
      method: 'POST',
    });
    const requestInit = firstFetchCall[1];
    expect(String(requestInit.body)).toContain('internal/sessionFocus');
    expect(controller.getState().currentSessionId).toBe(sessionId);
    expect(controller.getCurrentSession()?.isFocused).toBe(true);

    await controller.dispose();
  });

  it('spawns a fresh project session when the existing launcher record is stale', async () => {
    const clusterDir = await mkdtemp(path.join(os.tmpdir(), 'agent-browser-session-cluster-'));
    tempDirs.push(clusterDir);

    const projectRoot = '/tmp/client-b';
    const sessionId = deriveProjectSessionSlug(projectRoot);
    await writeSessionRecord(clusterDir, {
      sessionId,
      projectRoot,
      projectName: 'client-b',
      pid: 515151,
    });

    vi.spyOn(process, 'kill').mockImplementation(((pid: number, signal?: number | NodeJS.Signals) => {
      if (pid === 515151 && signal === 0) {
        const error = new Error('No such process') as NodeJS.ErrnoException;
        error.code = 'ESRCH';
        throw error;
      }

      return originalProcessKill(pid, signal);
    }) as typeof process.kill);

    const unrefMock = vi.fn();
    const removeAllListenersMock = vi.fn();
    spawnMock.mockImplementation(() => {
      void writeSessionRecord(clusterDir, {
        sessionId,
        projectRoot,
        projectName: 'client-b',
        isFocused: false,
      });

      return {
        unref: unrefMock,
        removeAllListeners: removeAllListenersMock,
      };
    });

    const controller = new SessionDirectoryController({
      role: 'launcher',
      clusterDir,
      currentSessionId: null,
    });

    await controller.start();
    await controller.executeCommand({
      action: 'openProject',
      projectRoot,
    });

    expect(spawnMock).toHaveBeenCalledTimes(1);
    expect(unrefMock).toHaveBeenCalledTimes(1);
    expect(controller.getState().currentSessionId).toBe(sessionId);
    expect(controller.getSessionRecord(sessionId)?.summary.projectRoot).toBe(projectRoot);

    await controller.dispose();
  });

  it('publishes a fresh session snapshot immediately on focus changes', async () => {
    const clusterDir = await mkdtemp(path.join(os.tmpdir(), 'agent-browser-session-cluster-'));
    tempDirs.push(clusterDir);

    const focusListeners = new Set<(isFocused: boolean) => void>();
    let isFocused = false;
    const browserShell = {
      getChromeAppearanceState: () => ({
        chromeColor: '#F297E7',
        projectIconPath: '',
        dockIconStatus: 'applied' as const,
      }),
      isWindowFocused: () => isFocused,
      subscribeWindowFocus: (listener: (focused: boolean) => void) => {
        focusListeners.add(listener);
        return () => {
          focusListeners.delete(listener);
        };
      },
    } as unknown as BrowserShell;

    const advertiser = new ProjectSessionAdvertiser({
      clusterDir,
      sessionId: 'client-a-1234abcd',
      browserShell,
      connectionInfo: {
        url: 'http://127.0.0.1:46255/mcp',
        token: 'session-token',
        registrationFile: '/tmp/mcp-registration.json',
      },
      projectRoot: '/tmp/client-a',
    });

    await advertiser.start();
    expect((await readSessionRecord(clusterDir, 'client-a-1234abcd')).summary.isFocused).toBe(false);

    isFocused = true;
    for (const listener of focusListeners) {
      listener(true);
    }

    const startedAt = Date.now();
    while (Date.now() - startedAt < 1_000) {
      if ((await readSessionRecord(clusterDir, 'client-a-1234abcd')).summary.isFocused) {
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 25));
    }

    expect((await readSessionRecord(clusterDir, 'client-a-1234abcd')).summary.isFocused).toBe(true);

    await advertiser.stop();
  });
});
