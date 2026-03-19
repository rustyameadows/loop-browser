import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  PROJECT_SELECTION_FILE_NAME,
  ProjectAppearanceController,
  ProjectAppearanceStore,
  createProjectAppearanceState,
  deriveProjectSessionSlug,
  deriveProjectUserDataDir,
  parseProjectAppearanceConfig,
  toProjectRelativePath,
} from '../src/main/project-appearance';

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map(async (directory) => {
      await rm(directory, { recursive: true, force: true });
    }),
  );
});

describe('project appearance config parsing', () => {
  it('parses a valid config and resolves a relative icon path', async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), 'loop-browser-project-config-'));
    tempDirs.push(tempDir);

    const iconPath = path.join(tempDir, 'icon.png');
    await writeFile(iconPath, 'icon');

    const state = parseProjectAppearanceConfig(
      JSON.stringify({
        version: 1,
        chrome: {
          chromeColor: '#ABCDEF',
          accentColor: '#112233',
          projectIconPath: './icon.png',
        },
      }),
      tempDir,
    );

    expect(state.chromeColor).toBe('#ABCDEF');
    expect(state.accentColor).toBe('#112233');
    expect(state.resolvedProjectIconPath).toBe(iconPath);
  });

  it('uses defaults for omitted values', () => {
    const state = parseProjectAppearanceConfig(
      JSON.stringify({
        version: 1,
        chrome: {},
      }),
      '/tmp/project',
    );

    expect(state.chromeColor).toBe(createProjectAppearanceState('/tmp/project').chromeColor);
    expect(state.accentColor).toBe(createProjectAppearanceState('/tmp/project').accentColor);
  });

  it('rejects invalid json and invalid colors', () => {
    expect(() => parseProjectAppearanceConfig('{nope', '/tmp/project')).toThrow(
      'Project config is not valid JSON.',
    );
    expect(() =>
      parseProjectAppearanceConfig(
        JSON.stringify({
          version: 1,
          chrome: {
            chromeColor: 'blue',
          },
        }),
        '/tmp/project',
      ),
    ).toThrow('chrome.chromeColor must be a hex color in the form #RRGGBB.');
  });

  it('surfaces a warning for missing project icon files', () => {
    const state = parseProjectAppearanceConfig(
      JSON.stringify({
        version: 1,
        chrome: {
          projectIconPath: './missing-icon.png',
        },
      }),
      '/tmp/project',
    );

    expect(state.resolvedProjectIconPath).toBeNull();
    expect(state.lastError).toContain('Project icon file does not exist');
  });
});

describe('project appearance store', () => {
  it('writes through updates and reacts to external file edits', async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), 'loop-browser-project-store-'));
    tempDirs.push(tempDir);

    const store = new ProjectAppearanceStore(tempDir);

    await store.setAppearance({
      chromeColor: '#112233',
      accentColor: '#445566',
    });

    const writtenConfig = JSON.parse(
      await readFile(path.join(tempDir, '.loop-browser.json'), 'utf8'),
    ) as {
      chrome: {
        chromeColor: string;
        accentColor: string;
      };
    };

    expect(writtenConfig.chrome.chromeColor).toBe('#112233');
    expect(writtenConfig.chrome.accentColor).toBe('#445566');

    await writeFile(
      path.join(tempDir, '.loop-browser.json'),
      JSON.stringify({
        version: 1,
        chrome: {
          chromeColor: '#AABBCC',
          accentColor: '#334455',
        },
      }),
    );

    await new Promise((resolve) => setTimeout(resolve, 140));

    expect(store.getState().chromeColor).toBe('#AABBCC');
    expect(store.getState().accentColor).toBe('#334455');

    store.dispose();
  });
});

describe('project appearance controller', () => {
  it('requires an explicit project folder before writing appearance config', async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), 'loop-browser-project-controller-'));
    tempDirs.push(tempDir);

    const controller = new ProjectAppearanceController(
      path.join(tempDir, PROJECT_SELECTION_FILE_NAME),
      null,
    );

    const state = await controller.setAppearance({
      chromeColor: '#112233',
    });

    expect(state.projectRoot).toBe('');
    expect(state.lastError).toContain('Choose a project folder first');

    controller.dispose();
  });

  it('switches to a selected project folder and remembers it for next launch', async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), 'loop-browser-project-controller-'));
    tempDirs.push(tempDir);

    const projectDir = path.join(tempDir, 'client-project');
    const selectionPath = path.join(tempDir, PROJECT_SELECTION_FILE_NAME);

    await mkdir(projectDir, { recursive: true });

    const controller = new ProjectAppearanceController(selectionPath, null);
    const selectedState = await controller.selectProject(projectDir);
    expect(selectedState.projectRoot).toBe(projectDir);
    expect(selectedState.configPath).toBe(path.join(projectDir, '.loop-browser.json'));

    const updatedState = await controller.setAppearance({
      chromeColor: '#223344',
      accentColor: '#556677',
    });
    expect(updatedState.chromeColor).toBe('#223344');
    expect(updatedState.accentColor).toBe('#556677');
    const writtenConfig = JSON.parse(
      await readFile(path.join(projectDir, '.loop-browser.json'), 'utf8'),
    ) as {
      chrome: {
        chromeColor: string;
        accentColor: string;
      };
    };
    expect(writtenConfig.chrome.chromeColor).toBe('#223344');
    expect(writtenConfig.chrome.accentColor).toBe('#556677');

    const rememberedSelection = JSON.parse(await readFile(selectionPath, 'utf8')) as {
      projectRoot: string;
    };
    expect(rememberedSelection.projectRoot).toBe(projectDir);

    controller.dispose();

    const restoredController = new ProjectAppearanceController(selectionPath, null);
    expect(restoredController.getState().projectRoot).toBe(projectDir);
    restoredController.dispose();
  });
});

describe('project session identity helpers', () => {
  it('derives stable project slugs and user data directories', () => {
    expect(deriveProjectSessionSlug('/Users/tester/dev/browser-loop')).toMatch(
      /^browser-loop-[0-9a-f]{8}$/,
    );
    expect(
      deriveProjectUserDataDir('/Users/tester/dev/browser-loop', 'darwin', '/Users/tester'),
    ).toContain('/Library/Application Support/Loop Browser/projects/');
  });

  it('converts icon paths to project-relative config paths', () => {
    expect(
      toProjectRelativePath('/Users/tester/dev/browser-loop', '/Users/tester/dev/browser-loop/assets/icon.png'),
    ).toBe('./assets/icon.png');
  });

  it('rejects icon files outside the selected project', () => {
    expect(() =>
      toProjectRelativePath(
        '/Users/tester/dev/browser-loop',
        '/Users/tester/dev/shared/icon.png',
      ),
    ).toThrow('Selected icon must be inside the current project folder.');
  });
});
