export const PROJECT_AGENT_LOGIN_GET_STATE_CHANNEL = 'project-agent-login:get-state';
export const PROJECT_AGENT_LOGIN_STATE_CHANNEL = 'project-agent-login:state';
export const PROJECT_AGENT_LOGIN_SAVE_CHANNEL = 'project-agent-login:save';
export const PROJECT_AGENT_LOGIN_CLEAR_CHANNEL = 'project-agent-login:clear';

export const projectAgentLoginSources = ['local-file', 'legacy-env', 'none'] as const;

export type ProjectAgentLoginSource = (typeof projectAgentLoginSources)[number];

export interface ProjectAgentLoginState {
  projectRoot: string;
  filePath: string;
  username: string;
  hasPassword: boolean;
  isGitIgnored: boolean;
  source: ProjectAgentLoginSource;
  lastError: string | null;
}

export interface ProjectAgentLoginSaveRequest {
  username: string;
  password: string;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

export const createEmptyProjectAgentLoginState = (): ProjectAgentLoginState => ({
  projectRoot: '',
  filePath: '',
  username: '',
  hasPassword: false,
  isGitIgnored: false,
  source: 'none',
  lastError: null,
});

export const isProjectAgentLoginState = (value: unknown): value is ProjectAgentLoginState => {
  if (!isRecord(value)) {
    return false;
  }

  return (
    typeof value.projectRoot === 'string' &&
    typeof value.filePath === 'string' &&
    typeof value.username === 'string' &&
    typeof value.hasPassword === 'boolean' &&
    typeof value.isGitIgnored === 'boolean' &&
    typeof value.source === 'string' &&
    projectAgentLoginSources.includes(value.source as ProjectAgentLoginSource) &&
    (typeof value.lastError === 'string' || value.lastError === null)
  );
};

export const isProjectAgentLoginSaveRequest = (
  value: unknown,
): value is ProjectAgentLoginSaveRequest => {
  if (!isRecord(value)) {
    return false;
  }

  return typeof value.username === 'string' && typeof value.password === 'string';
};
