import { promises as fs } from 'node:fs';
import { existsSync, readFileSync, statSync, unwatchFile, watchFile } from 'node:fs';
import path from 'node:path';
import {
  createEmptyProjectAgentLoginState,
  type ProjectAgentLoginState,
} from '@agent-browser/protocol';

export const PROJECT_AGENT_LOGIN_FILE_NAME = '.loop-browser.local.json';
const GITIGNORE_FILE_NAME = '.gitignore';
const CONFIG_VERSION = 1;
const GITIGNORE_ENTRY = PROJECT_AGENT_LOGIN_FILE_NAME;

type ProjectAgentLoginDocument = {
  version?: unknown;
  agentLogin?: {
    username?: unknown;
    password?: unknown;
  };
};

type ProjectAgentLoginCredentials = {
  username: string;
  password: string;
};

type AgentLoginSubscriber = (state: ProjectAgentLoginState) => void;

export interface ProjectAgentLoginRuntime {
  getState(): ProjectAgentLoginState;
  subscribe(listener: AgentLoginSubscriber): () => void;
  selectProject(projectRoot: string | null): Promise<ProjectAgentLoginState>;
  saveLogin(credentials: ProjectAgentLoginCredentials): Promise<ProjectAgentLoginState>;
  clearLogin(): Promise<ProjectAgentLoginState>;
  resolveLocalCredentials(): ProjectAgentLoginCredentials | null;
  dispose(): void;
}

const trimOptionalText = (value: string): string => value.trim();

const resolveExistingProjectDirectory = (projectRoot: string): string | null => {
  const normalizedProjectRoot = path.resolve(projectRoot);

  try {
    const stats = statSync(normalizedProjectRoot);
    return stats.isDirectory() ? normalizedProjectRoot : null;
  } catch {
    return null;
  }
};

export const getProjectAgentLoginPath = (projectRoot: string): string =>
  path.join(projectRoot, PROJECT_AGENT_LOGIN_FILE_NAME);

const getProjectGitIgnorePath = (projectRoot: string): string =>
  path.join(projectRoot, GITIGNORE_FILE_NAME);

const createProjectAgentLoginStoreState = (
  projectRoot: string | null,
): ProjectAgentLoginState => ({
  ...createEmptyProjectAgentLoginState(),
  projectRoot: projectRoot ?? '',
  filePath: projectRoot ? getProjectAgentLoginPath(projectRoot) : '',
});

const parseProjectAgentLoginConfig = (raw: string): ProjectAgentLoginCredentials => {
  let parsed: ProjectAgentLoginDocument;
  try {
    parsed = JSON.parse(raw) as ProjectAgentLoginDocument;
  } catch {
    throw new Error('Project agent login file is not valid JSON.');
  }

  if (typeof parsed !== 'object' || parsed === null) {
    throw new Error('Project agent login file must be an object.');
  }

  if (parsed.version !== CONFIG_VERSION) {
    throw new Error(`Project agent login file version must be ${CONFIG_VERSION}.`);
  }

  if (typeof parsed.agentLogin !== 'object' || parsed.agentLogin === null) {
    throw new Error('Project agent login file "agentLogin" must be an object.');
  }

  if (typeof parsed.agentLogin.username !== 'string') {
    throw new Error('agentLogin.username must be a string.');
  }

  if (typeof parsed.agentLogin.password !== 'string') {
    throw new Error('agentLogin.password must be a string.');
  }

  const username = trimOptionalText(parsed.agentLogin.username);
  const password = trimOptionalText(parsed.agentLogin.password);
  if (!username || !password) {
    throw new Error('Project agent login file must include both a username and password.');
  }

  return {
    username,
    password,
  };
};

const serializeProjectAgentLoginConfig = (credentials: ProjectAgentLoginCredentials): string =>
  `${JSON.stringify(
    {
      version: CONFIG_VERSION,
      agentLogin: {
        username: credentials.username,
        password: credentials.password,
      },
    },
    null,
    2,
  )}\n`;

const hasGitIgnoreEntry = (raw: string): boolean =>
  raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .some((line) => line === GITIGNORE_ENTRY || line === `/${GITIGNORE_ENTRY}`);

const readGitIgnoreStatus = (projectRoot: string): boolean => {
  const gitIgnorePath = getProjectGitIgnorePath(projectRoot);
  if (!existsSync(gitIgnorePath)) {
    return false;
  }

  try {
    const stats = statSync(gitIgnorePath);
    if (!stats.isFile()) {
      return false;
    }

    return hasGitIgnoreEntry(readFileSync(gitIgnorePath, 'utf8'));
  } catch {
    return false;
  }
};

const ensureGitIgnoreEntry = async (projectRoot: string): Promise<void> => {
  const gitIgnorePath = getProjectGitIgnorePath(projectRoot);
  const existingRaw = existsSync(gitIgnorePath) ? await fs.readFile(gitIgnorePath, 'utf8') : '';
  if (hasGitIgnoreEntry(existingRaw)) {
    return;
  }

  const prefix = existingRaw.length > 0 && !existingRaw.endsWith('\n') ? '\n' : '';
  const nextRaw =
    existingRaw.length > 0 ? `${existingRaw}${prefix}${GITIGNORE_ENTRY}\n` : `${GITIGNORE_ENTRY}\n`;
  await fs.writeFile(gitIgnorePath, nextRaw, 'utf8');
};

class ProjectAgentLoginStore {
  private state: ProjectAgentLoginState;
  private credentials: ProjectAgentLoginCredentials | null = null;
  private readonly subscribers = new Set<AgentLoginSubscriber>();
  private readonly filePath: string;
  private readonly gitIgnorePath: string;

  constructor(private readonly projectRoot: string) {
    this.filePath = getProjectAgentLoginPath(projectRoot);
    this.gitIgnorePath = getProjectGitIgnorePath(projectRoot);
    this.state = createProjectAgentLoginStoreState(projectRoot);
    this.reloadFromDisk(false);
    this.startWatching();
  }

  getState(): ProjectAgentLoginState {
    return { ...this.state };
  }

  subscribe(listener: AgentLoginSubscriber): () => void {
    this.subscribers.add(listener);
    return () => {
      this.subscribers.delete(listener);
    };
  }

  async saveLogin(credentials: ProjectAgentLoginCredentials): Promise<ProjectAgentLoginState> {
    const username = trimOptionalText(credentials.username);
    const password = trimOptionalText(credentials.password);
    if (!username || !password) {
      throw new Error('Enter both an agent login username and password.');
    }

    await fs.writeFile(this.filePath, serializeProjectAgentLoginConfig({ username, password }), 'utf8');
    let runtimeError: string | null = null;

    try {
      await ensureGitIgnoreEntry(this.projectRoot);
    } catch (error) {
      runtimeError =
        error instanceof Error
          ? `Saved login, but could not update .gitignore: ${error.message}`
          : 'Saved login, but could not update .gitignore.';
    }

    this.credentials = { username, password };
    this.state = {
      ...createProjectAgentLoginStoreState(this.projectRoot),
      username,
      hasPassword: true,
      isGitIgnored: readGitIgnoreStatus(this.projectRoot),
      lastError: runtimeError,
    };
    this.emit();
    return this.getState();
  }

  async clearLogin(): Promise<ProjectAgentLoginState> {
    await fs.rm(this.filePath, { force: true });
    this.credentials = null;
    this.state = {
      ...createProjectAgentLoginStoreState(this.projectRoot),
      isGitIgnored: readGitIgnoreStatus(this.projectRoot),
    };
    this.emit();
    return this.getState();
  }

  resolveLocalCredentials(): ProjectAgentLoginCredentials | null {
    return this.credentials ? { ...this.credentials } : null;
  }

  dispose(): void {
    unwatchFile(this.filePath);
    unwatchFile(this.gitIgnorePath);
  }

  private emit(): void {
    const snapshot = this.getState();
    for (const subscriber of this.subscribers) {
      subscriber(snapshot);
    }
  }

  private startWatching(): void {
    try {
      watchFile(this.filePath, { interval: 80 }, () => {
        this.reloadFromDisk();
      });
      watchFile(this.gitIgnorePath, { interval: 80 }, () => {
        this.reloadFromDisk();
      });
    } catch (error) {
      this.state = {
        ...this.state,
        lastError:
          error instanceof Error
            ? `Could not watch project agent login files: ${error.message}`
            : 'Could not watch project agent login files.',
      };
    }
  }

  private reloadFromDisk(emit = true): void {
    const nextBaseState = {
      ...createProjectAgentLoginStoreState(this.projectRoot),
      isGitIgnored: readGitIgnoreStatus(this.projectRoot),
    };

    if (!existsSync(this.filePath)) {
      this.credentials = null;
      this.state = nextBaseState;
      if (emit) {
        this.emit();
      }
      return;
    }

    try {
      const raw = statSync(this.filePath).isFile() ? readFileSync(this.filePath, 'utf8') : '';
      const credentials = parseProjectAgentLoginConfig(raw);
      this.credentials = credentials;
      this.state = {
        ...nextBaseState,
        username: credentials.username,
        hasPassword: true,
      };
    } catch (error) {
      this.credentials = null;
      this.state = {
        ...nextBaseState,
        lastError:
          error instanceof Error ? error.message : 'Could not load project agent login file.',
      };
    }

    if (emit) {
      this.emit();
    }
  }
}

export class ProjectAgentLoginController implements ProjectAgentLoginRuntime {
  private state = createProjectAgentLoginStoreState(null);
  private readonly subscribers = new Set<AgentLoginSubscriber>();
  private store: ProjectAgentLoginStore | null = null;
  private storeUnsubscribe: (() => void) | null = null;

  constructor(initialProjectRoot: string | null = null) {
    const preferredProjectRoot =
      initialProjectRoot ? resolveExistingProjectDirectory(initialProjectRoot) : null;

    if (preferredProjectRoot) {
      this.attachStore(preferredProjectRoot);
    }
  }

  getState(): ProjectAgentLoginState {
    return { ...this.state };
  }

  subscribe(listener: AgentLoginSubscriber): () => void {
    this.subscribers.add(listener);
    return () => {
      this.subscribers.delete(listener);
    };
  }

  async selectProject(projectRoot: string | null): Promise<ProjectAgentLoginState> {
    if (projectRoot === null) {
      this.detachStore();
      this.state = createProjectAgentLoginStoreState(null);
      this.emit();
      return this.getState();
    }

    const normalizedProjectRoot = resolveExistingProjectDirectory(projectRoot);
    if (!normalizedProjectRoot) {
      this.state = {
        ...createProjectAgentLoginStoreState(null),
        lastError: `Project folder does not exist or is not a directory: ${path.resolve(projectRoot)}`,
      };
      this.emit();
      return this.getState();
    }

    if (this.store?.getState().projectRoot === normalizedProjectRoot) {
      return this.getState();
    }

    this.attachStore(normalizedProjectRoot);
    this.emit();
    return this.getState();
  }

  async saveLogin(credentials: ProjectAgentLoginCredentials): Promise<ProjectAgentLoginState> {
    if (!this.store) {
      this.state = {
        ...createProjectAgentLoginStoreState(null),
        lastError: 'Choose a project folder first. Loop Browser saves agent login in .loop-browser.local.json inside that folder.',
      };
      this.emit();
      return this.getState();
    }

    this.state = await this.store.saveLogin(credentials);
    this.emit();
    return this.getState();
  }

  async clearLogin(): Promise<ProjectAgentLoginState> {
    if (!this.store) {
      this.state = {
        ...createProjectAgentLoginStoreState(null),
        lastError: 'Choose a project folder first. Loop Browser clears agent login from that folder’s .loop-browser.local.json file.',
      };
      this.emit();
      return this.getState();
    }

    this.state = await this.store.clearLogin();
    this.emit();
    return this.getState();
  }

  resolveLocalCredentials(): ProjectAgentLoginCredentials | null {
    return this.store?.resolveLocalCredentials() ?? null;
  }

  dispose(): void {
    this.detachStore();
  }

  private emit(): void {
    const snapshot = this.getState();
    for (const subscriber of this.subscribers) {
      subscriber(snapshot);
    }
  }

  private attachStore(projectRoot: string): void {
    this.detachStore();

    this.store = new ProjectAgentLoginStore(projectRoot);
    this.storeUnsubscribe = this.store.subscribe((state) => {
      this.state = state;
      this.emit();
    });
    this.state = this.store.getState();
  }

  private detachStore(): void {
    this.storeUnsubscribe?.();
    this.storeUnsubscribe = null;
    this.store?.dispose();
    this.store = null;
  }
}
