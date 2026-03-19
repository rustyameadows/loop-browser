import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import { existsSync, readFileSync, statSync, unwatchFile, watchFile } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  DEFAULT_ACCENT_COLOR,
  DEFAULT_CHROME_COLOR,
  type ChromeAppearanceState,
} from '@agent-browser/protocol';

export const PROJECT_CONFIG_FILE_NAME = '.loop-browser.json';
export const PROJECT_SELECTION_FILE_NAME = 'project-selection.json';
const CONFIG_VERSION = 1;
const PROJECT_SELECTION_VERSION = 1;
const HEX_COLOR_PATTERN = /^#[0-9A-F]{6}$/;

type ProjectChromeConfigDocument = {
  version?: unknown;
  chrome?: {
    chromeColor?: unknown;
    accentColor?: unknown;
    projectIconPath?: unknown;
  };
};

type ProjectSelectionDocument = {
  version?: unknown;
  projectRoot?: unknown;
};

export type ProjectAppearanceUpdate = {
  chromeColor?: string;
  accentColor?: string;
  projectIconPath?: string;
};

export interface ProjectAppearanceRuntime {
  getState(): ChromeAppearanceState;
  subscribe(listener: AppearanceSubscriber): () => void;
  selectProject(projectRoot: string | null): Promise<ChromeAppearanceState>;
  setAppearance(update: ProjectAppearanceUpdate): Promise<ChromeAppearanceState>;
  resetAppearance(): Promise<ChromeAppearanceState>;
  dispose(): void;
}

type AppearanceSubscriber = (state: ChromeAppearanceState) => void;

const normalizeHexColor = (value: string, fieldName: string): string => {
  const normalized = value.trim().toUpperCase();
  if (!HEX_COLOR_PATTERN.test(normalized)) {
    throw new Error(`${fieldName} must be a hex color in the form #RRGGBB.`);
  }

  return normalized;
};

const trimOptionalPath = (value: string): string => value.trim();

const resolveProjectIconInfo = (
  projectRoot: string,
  projectIconPath: string,
): { projectIconPath: string; resolvedProjectIconPath: string | null; warning: string | null } => {
  const trimmedPath = trimOptionalPath(projectIconPath);
  if (!trimmedPath) {
    return {
      projectIconPath: '',
      resolvedProjectIconPath: null,
      warning: null,
    };
  }

  const resolvedPath = path.isAbsolute(trimmedPath)
    ? path.resolve(trimmedPath)
    : path.resolve(projectRoot, trimmedPath);

  try {
    const stats = statSync(resolvedPath);
    if (!stats.isFile()) {
      return {
        projectIconPath: trimmedPath,
        resolvedProjectIconPath: null,
        warning: `Project icon path is not a file: ${resolvedPath}`,
      };
    }
  } catch {
    return {
      projectIconPath: trimmedPath,
      resolvedProjectIconPath: null,
      warning: `Project icon file does not exist: ${resolvedPath}`,
    };
  }

  return {
    projectIconPath: trimmedPath,
    resolvedProjectIconPath: resolvedPath,
    warning: null,
  };
};

export const getProjectConfigPath = (projectRoot: string): string =>
  path.join(projectRoot, PROJECT_CONFIG_FILE_NAME);

export const createProjectAppearanceState = (projectRoot: string | null): ChromeAppearanceState => ({
  isOpen: false,
  projectRoot: projectRoot ?? '',
  configPath: projectRoot ? getProjectConfigPath(projectRoot) : '',
  chromeColor: DEFAULT_CHROME_COLOR,
  accentColor: DEFAULT_ACCENT_COLOR,
  projectIconPath: '',
  resolvedProjectIconPath: null,
  lastError: null,
});

const parseProjectAppearanceDocument = (
  document: ProjectChromeConfigDocument,
  projectRoot: string,
): ChromeAppearanceState => {
  if (document.version !== CONFIG_VERSION) {
    throw new Error(`Project config version must be ${CONFIG_VERSION}.`);
  }

  if (document.chrome !== undefined && (typeof document.chrome !== 'object' || document.chrome === null)) {
    throw new Error('Project config "chrome" must be an object.');
  }

  const chromeColor =
    document.chrome?.chromeColor === undefined
      ? DEFAULT_CHROME_COLOR
      : typeof document.chrome.chromeColor === 'string'
        ? normalizeHexColor(document.chrome.chromeColor, 'chrome.chromeColor')
        : (() => {
            throw new Error('chrome.chromeColor must be a string.');
          })();

  const accentColor =
    document.chrome?.accentColor === undefined
      ? DEFAULT_ACCENT_COLOR
      : typeof document.chrome.accentColor === 'string'
        ? normalizeHexColor(document.chrome.accentColor, 'chrome.accentColor')
        : (() => {
            throw new Error('chrome.accentColor must be a string.');
          })();

  const rawProjectIconPath =
    document.chrome?.projectIconPath === undefined
      ? ''
      : typeof document.chrome.projectIconPath === 'string'
        ? document.chrome.projectIconPath
        : (() => {
            throw new Error('chrome.projectIconPath must be a string.');
          })();

  const iconInfo = resolveProjectIconInfo(projectRoot, rawProjectIconPath);

  return {
    ...createProjectAppearanceState(projectRoot),
    chromeColor,
    accentColor,
    projectIconPath: iconInfo.projectIconPath,
    resolvedProjectIconPath: iconInfo.resolvedProjectIconPath,
    lastError: iconInfo.warning,
  };
};

export const parseProjectAppearanceConfig = (
  raw: string,
  projectRoot: string,
): ChromeAppearanceState => {
  let parsed: ProjectChromeConfigDocument;
  try {
    parsed = JSON.parse(raw) as ProjectChromeConfigDocument;
  } catch {
    throw new Error('Project config is not valid JSON.');
  }

  if (typeof parsed !== 'object' || parsed === null) {
    throw new Error('Project config must be an object.');
  }

  return parseProjectAppearanceDocument(parsed, projectRoot);
};

const serializeProjectAppearanceConfig = (state: ChromeAppearanceState): string => {
  const chrome: Record<string, string> = {
    chromeColor: state.chromeColor,
    accentColor: state.accentColor,
  };

  if (state.projectIconPath) {
    chrome.projectIconPath = state.projectIconPath;
  }

  return `${JSON.stringify(
    {
      version: CONFIG_VERSION,
      chrome,
    },
    null,
    2,
  )}\n`;
};

export const deriveProjectSessionSlug = (projectRoot: string): string => {
  const baseName = path.basename(projectRoot) || 'project';
  const slug = baseName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 36);
  const hash = createHash('sha256').update(projectRoot).digest('hex').slice(0, 8);
  return `${slug || 'project'}-${hash}`;
};

export const deriveProjectUserDataDir = (
  projectRoot: string,
  platform = process.platform,
  homeDir = os.homedir(),
): string => {
  const sessionSlug = deriveProjectSessionSlug(projectRoot);

  if (platform === 'darwin') {
    return path.join(
      homeDir,
      'Library',
      'Application Support',
      'Loop Browser',
      'projects',
      sessionSlug,
    );
  }

  return path.join(homeDir, '.loop-browser', 'projects', sessionSlug);
};

export class ProjectAppearanceStore implements ProjectAppearanceRuntime {
  private state: ChromeAppearanceState;
  private readonly subscribers = new Set<AppearanceSubscriber>();
  private readonly configPath: string;

  constructor(private readonly projectRoot: string) {
    this.configPath = getProjectConfigPath(projectRoot);
    this.state = createProjectAppearanceState(projectRoot);
    this.reloadFromDisk(false);
    this.startWatching();
  }

  getState(): ChromeAppearanceState {
    return { ...this.state };
  }

  subscribe(listener: AppearanceSubscriber): () => void {
    this.subscribers.add(listener);
    return () => {
      this.subscribers.delete(listener);
    };
  }

  async selectProject(projectRoot: string | null): Promise<ChromeAppearanceState> {
    if (projectRoot && path.resolve(projectRoot) === this.projectRoot) {
      return this.getState();
    }

    return {
      ...this.getState(),
      lastError: 'This Loop Browser session is already scoped to a fixed project folder.',
    };
  }

  async setAppearance(update: ProjectAppearanceUpdate): Promise<ChromeAppearanceState> {
    const nextState = this.buildMergedState(update);
    await fs.writeFile(nextState.configPath, serializeProjectAppearanceConfig(nextState), 'utf8');
    this.state = nextState;
    this.emit();
    return this.getState();
  }

  async resetAppearance(): Promise<ChromeAppearanceState> {
    return this.setAppearance({
      chromeColor: DEFAULT_CHROME_COLOR,
      accentColor: DEFAULT_ACCENT_COLOR,
      projectIconPath: '',
    });
  }

  dispose(): void {
    unwatchFile(this.configPath);
  }

  private emit(): void {
    const snapshot = this.getState();
    for (const subscriber of this.subscribers) {
      subscriber(snapshot);
    }
  }

  private buildMergedState(update: ProjectAppearanceUpdate): ChromeAppearanceState {
    const chromeColor =
      update.chromeColor === undefined
        ? this.state.chromeColor
        : normalizeHexColor(update.chromeColor, 'chromeColor');
    const accentColor =
      update.accentColor === undefined
        ? this.state.accentColor
        : normalizeHexColor(update.accentColor, 'accentColor');
    const projectIconPath =
      update.projectIconPath === undefined ? this.state.projectIconPath : update.projectIconPath;
    const iconInfo = resolveProjectIconInfo(this.projectRoot, projectIconPath);

    return {
      ...this.state,
      chromeColor,
      accentColor,
      projectIconPath: iconInfo.projectIconPath,
      resolvedProjectIconPath: iconInfo.resolvedProjectIconPath,
      lastError: iconInfo.warning,
    };
  }

  private startWatching(): void {
    try {
      watchFile(this.configPath, { interval: 80 }, () => {
        this.reloadFromDisk();
      });
    } catch (error) {
      this.state = {
        ...this.state,
        lastError:
          error instanceof Error
            ? `Could not watch project config: ${error.message}`
            : 'Could not watch project config.',
      };
    }
  }

  private reloadFromDisk(emit = true): void {
    if (!existsSync(this.configPath)) {
      this.state = createProjectAppearanceState(this.projectRoot);
      if (emit) {
        this.emit();
      }
      return;
    }

    try {
      const raw = statSync(this.configPath).isFile() ? readFileSync(this.configPath, 'utf8') : '';
      const nextState = parseProjectAppearanceConfig(raw, this.projectRoot);
      this.state = {
        ...this.state,
        ...nextState,
        isOpen: this.state.isOpen,
      };
    } catch (error) {
      this.state = {
        ...this.state,
        lastError:
          error instanceof Error ? error.message : 'Could not load project appearance config.',
      };
    }

    if (emit) {
      this.emit();
    }
  }
}

const createProjectSelectionDocument = (projectRoot: string): ProjectSelectionDocument => ({
  version: PROJECT_SELECTION_VERSION,
  projectRoot,
});

const composeProjectAppearanceError = (
  stateError: string | null,
  runtimeError: string | null,
): string | null => {
  if (stateError && runtimeError) {
    return `${stateError} ${runtimeError}`;
  }

  return stateError ?? runtimeError;
};

const resolveExistingProjectDirectory = (projectRoot: string): string | null => {
  const normalizedProjectRoot = path.resolve(projectRoot);

  try {
    const stats = statSync(normalizedProjectRoot);
    return stats.isDirectory() ? normalizedProjectRoot : null;
  } catch {
    return null;
  }
};

export class ProjectAppearanceController implements ProjectAppearanceRuntime {
  private state = createProjectAppearanceState(null);
  private readonly subscribers = new Set<AppearanceSubscriber>();
  private store: ProjectAppearanceStore | null = null;
  private storeUnsubscribe: (() => void) | null = null;

  constructor(
    private readonly selectionStatePath: string,
    initialProjectRoot: string | null = null,
  ) {
    const preferredProjectRoot =
      (initialProjectRoot ? resolveExistingProjectDirectory(initialProjectRoot) : null) ??
      this.loadPersistedProjectRoot();

    if (preferredProjectRoot) {
      this.attachStore(preferredProjectRoot);
    }
  }

  getState(): ChromeAppearanceState {
    return { ...this.state };
  }

  subscribe(listener: AppearanceSubscriber): () => void {
    this.subscribers.add(listener);
    return () => {
      this.subscribers.delete(listener);
    };
  }

  async selectProject(projectRoot: string | null): Promise<ChromeAppearanceState> {
    if (projectRoot === null) {
      await this.clearSelection();
      return this.getState();
    }

    const normalizedProjectRoot = resolveExistingProjectDirectory(projectRoot);
    if (!normalizedProjectRoot) {
      this.state = {
        ...this.state,
        lastError: `Project folder does not exist or is not a directory: ${path.resolve(projectRoot)}`,
      };
      this.emit();
      return this.getState();
    }

    if (this.store?.getState().projectRoot === normalizedProjectRoot) {
      return this.getState();
    }

    this.attachStore(normalizedProjectRoot);

    try {
      await fs.mkdir(path.dirname(this.selectionStatePath), { recursive: true });
      await fs.writeFile(
        this.selectionStatePath,
        `${JSON.stringify(createProjectSelectionDocument(normalizedProjectRoot), null, 2)}\n`,
        'utf8',
      );
    } catch (error) {
      this.state = {
        ...this.state,
        lastError: composeProjectAppearanceError(
          this.state.lastError,
          error instanceof Error
            ? `Opened the project folder, but could not remember it for next launch: ${error.message}`
            : 'Opened the project folder, but could not remember it for next launch.',
        ),
      };
    }

    this.emit();
    return this.getState();
  }

  async setAppearance(update: ProjectAppearanceUpdate): Promise<ChromeAppearanceState> {
    if (!this.store) {
      this.state = {
        ...createProjectAppearanceState(null),
        lastError: 'Choose a project folder first. Loop Browser writes style settings to .loop-browser.json inside that folder.',
      };
      this.emit();
      return this.getState();
    }

    this.state = await this.store.setAppearance(update);
    this.emit();
    return this.getState();
  }

  async resetAppearance(): Promise<ChromeAppearanceState> {
    if (!this.store) {
      this.state = {
        ...createProjectAppearanceState(null),
        lastError: 'Choose a project folder first. Loop Browser resets style settings through that folder’s .loop-browser.json file.',
      };
      this.emit();
      return this.getState();
    }

    this.state = await this.store.resetAppearance();
    this.emit();
    return this.getState();
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

    this.store = new ProjectAppearanceStore(projectRoot);
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

  private async clearSelection(): Promise<void> {
    this.detachStore();
    this.state = createProjectAppearanceState(null);

    try {
      await fs.rm(this.selectionStatePath, { force: true });
    } catch {
      // Best effort; the current session can still continue without persisted selection.
    }

    this.emit();
  }

  private loadPersistedProjectRoot(): string | null {
    if (!existsSync(this.selectionStatePath)) {
      return null;
    }

    try {
      const parsed = JSON.parse(readFileSync(this.selectionStatePath, 'utf8')) as ProjectSelectionDocument;
      if (parsed.version !== PROJECT_SELECTION_VERSION || typeof parsed.projectRoot !== 'string') {
        return null;
      }

      return resolveExistingProjectDirectory(parsed.projectRoot);
    } catch {
      return null;
    }
  }
}
