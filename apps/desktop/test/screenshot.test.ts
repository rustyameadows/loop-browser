import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ArtifactStore } from '../src/main/artifact-store';
import {
  CHROME_HEIGHT,
  buildScreenshotFileName,
  clipElementToViewport,
  computeContentSizeForResize,
} from '../src/main/screenshot';

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map(async (directory) => {
      await rm(directory, { recursive: true, force: true });
    }),
  );
});

describe('screenshot helpers', () => {
  it('computes resize math for window, content, and page viewport targets', () => {
    expect(
      computeContentSizeForResize({
        width: 1440,
        height: 900,
        target: 'window',
        hasSidePanelOpen: false,
      }),
    ).toEqual({ width: 1440, height: 900 });

    expect(
      computeContentSizeForResize({
        width: 1280,
        height: 760,
        target: 'content',
        hasSidePanelOpen: false,
      }),
    ).toEqual({ width: 1280, height: 760 });

    expect(
      computeContentSizeForResize({
        width: 1280,
        height: 720,
        target: 'pageViewport',
        hasSidePanelOpen: false,
      }),
    ).toEqual({ width: 1280, height: 720 + CHROME_HEIGHT });
  });

  it('clips element bounds to the visible viewport and computes pixel size', () => {
    expect(
      clipElementToViewport({
        x: -20,
        y: 12,
        width: 120,
        height: 64,
        devicePixelRatio: 2,
        viewportWidth: 90,
        viewportHeight: 70,
      }),
    ).toEqual({
      x: 0,
      y: 12,
      width: 90,
      height: 58,
      pixelWidth: 180,
      pixelHeight: 116,
    });

    expect(
      clipElementToViewport({
        x: 300,
        y: 400,
        width: 100,
        height: 50,
        devicePixelRatio: 2,
        viewportWidth: 200,
        viewportHeight: 200,
      }),
    ).toBeNull();
  });

  it('builds stable artifact file names and persists metadata', async () => {
    expect(
      buildScreenshotFileName({
        artifactId: 'artifact-1',
        target: 'element',
        format: 'jpeg',
        fileNameHint: 'Hero CTA',
      }),
    ).toBe('artifact-1-hero-cta.jpg');

    const storageDir = await mkdtemp(path.join(os.tmpdir(), 'agent-browser-artifacts-'));
    tempDirs.push(storageDir);

    const store = new ArtifactStore(storageDir);
    const artifact = await store.saveScreenshot({
      buffer: Buffer.from('fixture-image'),
      format: 'png',
      target: 'page',
      pixelWidth: 1280,
      pixelHeight: 720,
      fileNameHint: 'Fixture Shot',
    });

    const stored = await store.getArtifact(artifact.artifactId);
    expect(stored.fileName).toContain('fixture-shot');
    expect(stored.filePath).toContain(path.join('artifacts', stored.fileName));

    const listed = await store.listArtifacts();
    expect(listed[0]?.artifactId).toBe(artifact.artifactId);

    await store.deleteArtifact(artifact.artifactId);
    await expect(store.getArtifact(artifact.artifactId)).rejects.toThrow('not found');
  });
});
