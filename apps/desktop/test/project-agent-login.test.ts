import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  PROJECT_AGENT_LOGIN_FILE_NAME,
  ProjectAgentLoginController,
} from '../src/main/project-agent-login';

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map(async (directory) => {
      await rm(directory, { recursive: true, force: true });
    }),
  );
});

describe('ProjectAgentLoginController', () => {
  it('saves repo-local credentials and auto-adds the file to .gitignore', async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), 'loop-browser-project-agent-login-'));
    tempDirs.push(tempDir);

    const controller = new ProjectAgentLoginController(tempDir);
    const state = await controller.saveLogin({
      username: 'dev@example.com',
      password: 'password123',
    });

    expect(state.filePath).toBe(path.join(tempDir, PROJECT_AGENT_LOGIN_FILE_NAME));
    expect(state.username).toBe('dev@example.com');
    expect(state.hasPassword).toBe(true);
    expect(state.isGitIgnored).toBe(true);
    expect(controller.resolveLocalCredentials()).toEqual({
      username: 'dev@example.com',
      password: 'password123',
    });

    const savedConfig = JSON.parse(
      await readFile(path.join(tempDir, PROJECT_AGENT_LOGIN_FILE_NAME), 'utf8'),
    ) as {
      agentLogin: {
        username: string;
        password: string;
      };
    };
    expect(savedConfig.agentLogin.username).toBe('dev@example.com');
    expect(savedConfig.agentLogin.password).toBe('password123');

    const gitIgnore = await readFile(path.join(tempDir, '.gitignore'), 'utf8');
    expect(gitIgnore).toContain('.loop-browser.local.json');

    controller.dispose();
  });

  it('surfaces malformed repo-local login files without exposing credentials', async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), 'loop-browser-project-agent-login-'));
    tempDirs.push(tempDir);

    await writeFile(
      path.join(tempDir, PROJECT_AGENT_LOGIN_FILE_NAME),
      JSON.stringify({
        version: 1,
        agentLogin: {
          username: 'dev@example.com',
        },
      }),
      'utf8',
    );

    const controller = new ProjectAgentLoginController(tempDir);

    expect(controller.getState().username).toBe('');
    expect(controller.getState().hasPassword).toBe(false);
    expect(controller.getState().lastError).toContain('agentLogin.password');
    expect(controller.resolveLocalCredentials()).toBeNull();

    controller.dispose();
  });

  it('clears repo-local credentials and leaves the gitignore protection in place', async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), 'loop-browser-project-agent-login-'));
    tempDirs.push(tempDir);

    const controller = new ProjectAgentLoginController(tempDir);
    await controller.saveLogin({
      username: 'dev@example.com',
      password: 'password123',
    });

    const clearedState = await controller.clearLogin();

    expect(clearedState.username).toBe('');
    expect(clearedState.hasPassword).toBe(false);
    expect(clearedState.isGitIgnored).toBe(true);
    await expect(readFile(path.join(tempDir, PROJECT_AGENT_LOGIN_FILE_NAME), 'utf8')).rejects.toThrow();

    controller.dispose();
  });
});
