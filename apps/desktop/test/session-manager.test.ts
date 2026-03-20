import { mkdtemp, mkdir, rm, unlink, writeFile } from 'node:fs/promises';
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
import { SessionDirectoryController } from '../src/main/session-manager';

const originalFetch = globalThis.fetch;
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
        pid: 12345,
      },
      null,
      2,
    )}\n`,
    'utf8',
  );
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

    const fetchMock = vi.fn(async () =>
      new Response(
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
      ),
    );
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

    await controller.dispose();
  });
});
