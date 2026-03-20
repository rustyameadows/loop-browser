import { spawn, type ChildProcess } from 'node:child_process';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { app, dialog } from 'electron';
import type { SessionCommand, SessionSummary, SessionViewState } from '@agent-browser/protocol';
import { createEmptySessionViewState } from '@agent-browser/protocol';
import {
  deriveProjectSessionSlug,
  deriveProjectUserDataDir,
} from './project-appearance';
import type { ToolServerConnectionInfo } from './tool-server';
import type { BrowserShell } from './browser-shell';

const SESSION_RECORD_VERSION = 1;
const SESSION_SCAN_INTERVAL_MS = 350;
const SESSION_START_TIMEOUT_MS = 30_000;
const SESSION_FOCUS_TIMEOUT_MS = 2_000;
const SESSION_FOCUS_POLL_MS = 100;

export const LOOP_BROWSER_CLUSTER_DIR_ENV = 'LOOP_BROWSER_CLUSTER_DIR';
export const LOOP_BROWSER_ROLE_ENV = 'LOOP_BROWSER_ROLE';

type SessionRecord = {
  version: number;
  sessionId: string;
  summary: SessionSummary;
  connection: {
    url: string;
    token: string;
  };
  updatedAt: string;
  pid: number;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const isSessionRecord = (value: unknown): value is SessionRecord => {
  if (!isRecord(value)) {
    return false;
  }

  return (
    value.version === SESSION_RECORD_VERSION &&
    typeof value.sessionId === 'string' &&
    isRecord(value.summary) &&
    typeof value.summary.sessionId === 'string' &&
    typeof value.summary.projectRoot === 'string' &&
    typeof value.summary.projectName === 'string' &&
    typeof value.summary.chromeColor === 'string' &&
    typeof value.summary.projectIconPath === 'string' &&
    typeof value.summary.isFocused === 'boolean' &&
    typeof value.summary.isHome === 'boolean' &&
    (value.summary.dockIconStatus === 'idle' ||
      value.summary.dockIconStatus === 'applied' ||
      value.summary.dockIconStatus === 'failed') &&
    (value.summary.status === 'launching' ||
      value.summary.status === 'ready' ||
      value.summary.status === 'closing' ||
      value.summary.status === 'closed' ||
      value.summary.status === 'error') &&
    isRecord(value.connection) &&
    typeof value.connection.url === 'string' &&
    typeof value.connection.token === 'string' &&
    typeof value.updatedAt === 'string' &&
    typeof value.pid === 'number'
  );
};

const nowIso = (): string => new Date().toISOString();

const sessionRegistryDir = (clusterDir: string): string => path.join(clusterDir, 'sessions');

const sessionRecordPath = (clusterDir: string, sessionId: string): string =>
  path.join(sessionRegistryDir(clusterDir), `${sessionId}.json`);

const readJsonFile = async (filePath: string): Promise<unknown> => {
  const raw = await fs.readFile(filePath, 'utf8');
  return JSON.parse(raw) as unknown;
};

const fetchJsonRpc = async (
  url: string,
  token: string,
  method: string,
  params: unknown,
): Promise<unknown> => {
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: `${method}-${Date.now()}`,
      method,
      params,
    }),
  });

  const payload = (await response.json()) as { result?: unknown; error?: { message?: string } };
  if (!response.ok || payload.error) {
    throw new Error(payload.error?.message ?? `Request failed (${response.status}).`);
  }

  return payload.result;
};

const projectNameFromRoot = (projectRoot: string): string =>
  path.basename(projectRoot) || 'Project';

const cloneSessionSummary = (session: SessionSummary): SessionSummary => ({ ...session });

const cloneSessionViewState = (state: SessionViewState): SessionViewState => ({
  ...state,
  sessions: state.sessions.map((session) => ({ ...session })),
});

const buildSpawnArgs = (): { command: string; args: string[] } => ({
  command: process.execPath,
  args: process.argv.slice(1),
});

const isSessionProcessAlive = (pid: number): boolean => {
  if (!Number.isInteger(pid) || pid <= 0) {
    return false;
  }

  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException | undefined)?.code;
    if (code === 'EPERM') {
      return true;
    }
    if (code === 'ESRCH') {
      return false;
    }
    return false;
  }
};

export const deriveClusterDir = (
  appDataDir = app.getPath('appData'),
): string => path.join(appDataDir, 'Loop Browser', 'cluster');

export class ProjectSessionAdvertiser {
  private timer: NodeJS.Timeout | null = null;
  private disposed = false;
  private lastSerialized = '';
  private status: SessionSummary['status'] = 'launching';
  private focusUnsubscribe: (() => void) | null = null;

  constructor(
    private readonly options: {
      clusterDir: string;
      sessionId: string;
      browserShell: BrowserShell;
      connectionInfo: ToolServerConnectionInfo;
      projectRoot: string;
    },
  ) {}

  async start(): Promise<void> {
    await fs.mkdir(sessionRegistryDir(this.options.clusterDir), { recursive: true });
    this.focusUnsubscribe = this.options.browserShell.subscribeWindowFocus(() => {
      void this.writeSnapshot();
    });
    this.status = 'ready';
    await this.writeSnapshot();
    this.timer = setInterval(() => {
      void this.writeSnapshot();
    }, SESSION_SCAN_INTERVAL_MS);
  }

  async stop(status: SessionSummary['status'] = 'closing'): Promise<void> {
    this.status = status;
    this.disposed = true;
    this.focusUnsubscribe?.();
    this.focusUnsubscribe = null;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    await fs.rm(sessionRecordPath(this.options.clusterDir, this.options.sessionId), {
      force: true,
    });
  }

  private createSummary(): SessionSummary {
    const appearance = this.options.browserShell.getChromeAppearanceState();
    return {
      sessionId: this.options.sessionId,
      projectRoot: this.options.projectRoot,
      projectName: projectNameFromRoot(this.options.projectRoot),
      chromeColor: appearance.chromeColor,
      projectIconPath: appearance.projectIconPath,
      isFocused: this.options.browserShell.isWindowFocused(),
      isHome: false,
      dockIconStatus: appearance.dockIconStatus,
      status: this.status,
    };
  }

  private async writeSnapshot(): Promise<void> {
    if (this.disposed) {
      return;
    }

    const record: SessionRecord = {
      version: SESSION_RECORD_VERSION,
      sessionId: this.options.sessionId,
      summary: this.createSummary(),
      connection: {
        url: this.options.connectionInfo.url,
        token: this.options.connectionInfo.token,
      },
      updatedAt: nowIso(),
      pid: process.pid,
    };
    const serialized = `${JSON.stringify(record, null, 2)}\n`;
    if (serialized === this.lastSerialized) {
      return;
    }

    this.lastSerialized = serialized;
    await fs.writeFile(
      sessionRecordPath(this.options.clusterDir, this.options.sessionId),
      serialized,
      'utf8',
    );
  }
}

export class SessionDirectoryController {
  private state: SessionViewState;
  private readonly listeners = new Set<(state: SessionViewState) => void>();
  private scanTimer: NodeJS.Timeout | null = null;
  private launchedChildren = new Map<string, ChildProcess>();

  constructor(
    private readonly options: {
      role: SessionViewState['role'];
      clusterDir: string;
      currentSessionId: string | null;
      logger?: Pick<Console, 'error' | 'warn' | 'info'>;
    },
  ) {
    this.state = {
      ...createEmptySessionViewState(),
      role: options.role,
      currentSessionId: options.currentSessionId,
    };
  }

  async start(): Promise<void> {
    await fs.mkdir(sessionRegistryDir(this.options.clusterDir), { recursive: true });
    await this.refresh();
    this.scanTimer = setInterval(() => {
      void this.refresh();
    }, SESSION_SCAN_INTERVAL_MS);
  }

  async dispose(): Promise<void> {
    if (this.scanTimer) {
      clearInterval(this.scanTimer);
      this.scanTimer = null;
    }
    for (const child of this.launchedChildren.values()) {
      child.removeAllListeners();
    }
    this.launchedChildren.clear();
  }

  getState(): SessionViewState {
    return cloneSessionViewState(this.state);
  }

  subscribe(listener: (state: SessionViewState) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  async executeCommand(command: SessionCommand): Promise<SessionViewState> {
    try {
      switch (command.action) {
        case 'refresh':
          await this.refresh();
          break;
        case 'openProject':
          await this.openProject(command.projectRoot);
          break;
        case 'focus':
          await this.focusSession(command.sessionId);
          break;
        case 'close':
          await this.closeSession(command.sessionId);
          break;
        default:
          break;
      }
      this.clearLastError();
    } catch (error) {
      this.setLastError(error instanceof Error ? error.message : 'Session command failed.');
      throw error;
    }

    return this.getState();
  }

  listSessions(): SessionSummary[] {
    return this.state.sessions.map(cloneSessionSummary);
  }

  getCurrentSession(): SessionSummary | null {
    return (
      this.state.sessions.find((session) => session.isFocused) ??
      this.state.sessions.find((session) => session.sessionId === this.state.currentSessionId) ??
      this.state.sessions[0] ??
      null
    );
  }

  getSessionRecord(sessionId: string): SessionRecord | null {
    return this.sessionRecords.get(sessionId) ?? null;
  }

  private readonly sessionRecords = new Map<string, SessionRecord>();

  private emit(): void {
    const snapshot = this.getState();
    for (const listener of this.listeners) {
      listener(snapshot);
    }
  }

  private setLastError(message: string): void {
    if (this.state.lastError === message) {
      return;
    }

    this.state = {
      ...this.state,
      lastError: message,
    };
    this.emit();
  }

  private clearLastError(): void {
    if (this.state.lastError === null) {
      return;
    }

    this.state = {
      ...this.state,
      lastError: null,
    };
    this.emit();
  }

  private async removeSessionRecordFile(sessionId: string): Promise<void> {
    await fs.rm(sessionRecordPath(this.options.clusterDir, sessionId), { force: true });
  }

  private async pruneStaleRecord(record: SessionRecord): Promise<boolean> {
    if (isSessionProcessAlive(record.pid)) {
      return false;
    }

    await this.removeSessionRecordFile(record.sessionId);
    this.options.logger?.warn?.(
      `Pruned stale session record for ${record.sessionId} after detecting dead pid ${record.pid}.`,
    );
    return true;
  }

  private async handlePossiblyStaleSession(
    record: SessionRecord,
    error: unknown,
    action: 'focus' | 'close',
  ): Promise<never> {
    if (await this.pruneStaleRecord(record)) {
      await this.refresh();
      throw new Error(
        `Could not ${action} session ${record.sessionId} because it had already crashed. Removed the stale launcher entry.`,
      );
    }

    throw error instanceof Error ? error : new Error(`Session ${action} failed.`);
  }

  private async refresh(): Promise<void> {
    const records = new Map<string, SessionRecord>();

    try {
      const entries = await fs.readdir(sessionRegistryDir(this.options.clusterDir), {
        withFileTypes: true,
      });
      for (const entry of entries) {
        if (!entry.isFile() || !entry.name.endsWith('.json')) {
          continue;
        }

        try {
          const parsed = await readJsonFile(
            path.join(sessionRegistryDir(this.options.clusterDir), entry.name),
          );
          if (isSessionRecord(parsed)) {
            if (await this.pruneStaleRecord(parsed)) {
              continue;
            }
            records.set(parsed.sessionId, parsed);
          }
        } catch {
          // Ignore transient or malformed files while a session is updating them.
        }
      }
    } catch {
      // Directory may not exist yet.
    }

    this.sessionRecords.clear();
    for (const [sessionId, record] of records) {
      this.sessionRecords.set(sessionId, record);
    }

    const nextSessions = Array.from(records.values())
      .map((record) => record.summary)
      .sort((left, right) => {
        if (left.isFocused !== right.isFocused) {
          return left.isFocused ? -1 : 1;
        }

        return left.projectName.localeCompare(right.projectName);
      });

    const nextCurrentSessionId =
      nextSessions.find((session) => session.isFocused)?.sessionId ??
      (this.state.currentSessionId &&
      nextSessions.some((session) => session.sessionId === this.state.currentSessionId)
        ? this.state.currentSessionId
        : nextSessions[0]?.sessionId ?? null);

    const nextState: SessionViewState = {
      ...this.state,
      sessions: nextSessions,
      currentSessionId: nextCurrentSessionId,
    };

    const previousSerialized = JSON.stringify(this.state);
    const nextSerialized = JSON.stringify(nextState);
    this.state = nextState;
    if (previousSerialized !== nextSerialized) {
      this.emit();
    }
  }

  private async promptForProjectFolder(): Promise<string | null> {
    const result = await dialog.showOpenDialog({
      title: 'Open Project Folder',
      buttonLabel: 'Open Project',
      properties: ['openDirectory', 'createDirectory'],
    });

    if (result.canceled || result.filePaths.length === 0) {
      return null;
    }

    return path.resolve(result.filePaths[0]);
  }

  private async openProject(projectRoot?: string): Promise<void> {
    const normalizedProjectRoot = projectRoot?.trim()
      ? path.resolve(projectRoot)
      : await this.promptForProjectFolder();
    if (!normalizedProjectRoot) {
      return;
    }

    await this.refresh();
    const sessionId = deriveProjectSessionSlug(normalizedProjectRoot);
    const existing = this.sessionRecords.get(sessionId);
    if (existing) {
      this.state = {
        ...this.state,
        currentSessionId: sessionId,
      };
      try {
        await this.focusSession(sessionId);
        return;
      } catch (error) {
        if (!(await this.pruneStaleRecord(existing))) {
          throw error;
        }
        await this.refresh();
      }
    }

    const { command, args } = buildSpawnArgs();
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      [LOOP_BROWSER_ROLE_ENV]: 'project-session',
      [LOOP_BROWSER_CLUSTER_DIR_ENV]: this.options.clusterDir,
      AGENT_BROWSER_PROJECT_ROOT: normalizedProjectRoot,
      AGENT_BROWSER_USER_DATA_DIR: deriveProjectUserDataDir(normalizedProjectRoot),
      AGENT_BROWSER_TOOL_SERVER_PORT: '0',
    };
    const child = spawn(command, args, {
      env,
      stdio: 'ignore',
      detached: true,
    });
    child.unref();
    this.launchedChildren.set(sessionId, child);

    const startedAt = Date.now();
    while (Date.now() - startedAt < SESSION_START_TIMEOUT_MS) {
      await this.refresh();
      if (this.sessionRecords.has(sessionId)) {
        this.state = {
          ...this.state,
          currentSessionId: sessionId,
        };
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 200));
    }

    throw new Error(`Timed out waiting for project session ${sessionId} to start.`);
  }

  async focusSession(sessionId: string): Promise<void> {
    await this.refresh();
    const record = this.sessionRecords.get(sessionId);
    if (!record) {
      throw new Error(`Could not find session ${sessionId}.`);
    }

    this.state = {
      ...this.state,
      currentSessionId: sessionId,
    };
    try {
      await fetchJsonRpc(record.connection.url, record.connection.token, 'internal/sessionFocus', {});
    } catch (error) {
      await this.handlePossiblyStaleSession(record, error, 'focus');
    }

    const startedAt = Date.now();
    while (Date.now() - startedAt < SESSION_FOCUS_TIMEOUT_MS) {
      await this.refresh();
      const focusedRecord = this.sessionRecords.get(sessionId);
      if (focusedRecord?.summary.isFocused) {
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, SESSION_FOCUS_POLL_MS));
    }

    throw new Error(`Timed out waiting for session ${sessionId} to report focus.`);
  }

  async closeSession(sessionId: string): Promise<void> {
    await this.refresh();
    const record = this.sessionRecords.get(sessionId);
    if (!record) {
      throw new Error(`Could not find session ${sessionId}.`);
    }

    try {
      await fetchJsonRpc(record.connection.url, record.connection.token, 'internal/sessionClose', {});
    } catch (error) {
      await this.handlePossiblyStaleSession(record, error, 'close');
    }
    const startedAt = Date.now();
    while (Date.now() - startedAt < SESSION_START_TIMEOUT_MS / 2) {
      await this.refresh();
      if (!this.sessionRecords.has(sessionId)) {
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
  }
}
