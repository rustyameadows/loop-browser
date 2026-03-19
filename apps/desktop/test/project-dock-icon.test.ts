import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { afterEach, describe, expect, it } from 'vitest';
import {
  composeDefaultDockIcon,
  composeProjectDockIcon,
  dockIconTemplatePath,
} from '../src/main/project-dock-icon';

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map(async (directory) => {
      await rm(directory, { recursive: true, force: true });
    }),
  );
});

describe('project dock icon helpers', () => {
  it('resolves the dock icon template in dev and packaged layouts', () => {
    expect(
      dockIconTemplatePath({
        appPath: '/tmp/loop-browser',
        isPackaged: false,
        resourcesPath: '/tmp/loop-browser/resources',
      }),
    ).toBe('/tmp/loop-browser/static/dock-icon-template.svg');

    expect(
      dockIconTemplatePath({
        appPath: '/tmp/loop-browser',
        isPackaged: true,
        resourcesPath: '/tmp/loop-browser/resources',
      }),
    ).toBe('/tmp/loop-browser/resources/static/dock-icon-template.svg');
  });

  it('composes a dock icon png from the project icon and template', async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), 'loop-browser-dock-icon-'));
    tempDirs.push(tempDir);

    const projectIconPath = path.join(tempDir, 'project-icon.png');
    await sharp({
      create: {
        width: 120,
        height: 120,
        channels: 4,
        background: '#2266AA',
      },
    })
      .png()
      .toFile(projectIconPath);

    const dockIcon = await composeProjectDockIcon({
      accentColor: '#1144AA',
      projectIconPath,
      templatePath: path.resolve('apps/desktop/static/dock-icon-template.svg'),
    });

    const metadata = await sharp(dockIcon).metadata();
    expect(metadata.width).toBe(512);
    expect(metadata.height).toBe(512);
  });

  it('composes the default Loop Browser dock icon', async () => {
    const dockIcon = await composeDefaultDockIcon({
      accentColor: '#1144AA',
      templatePath: path.resolve('apps/desktop/static/dock-icon-template.svg'),
    });

    const metadata = await sharp(dockIcon).metadata();
    expect(metadata.width).toBe(512);
    expect(metadata.height).toBe(512);
  });
});
