import { randomBytes } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import type {
  ArtifactRecord,
  ScreenshotArtifact,
  ScreenshotFormat,
  ScreenshotTarget,
} from '@agent-browser/protocol';
import {
  buildScreenshotFileName,
  getArtifactFilePath,
  getMimeTypeForFormat,
} from './screenshot';

type ArtifactMetadata = Omit<ArtifactRecord, 'filePath'>;

export interface ArtifactStoreSaveInput {
  buffer: Buffer;
  format: ScreenshotFormat;
  target: ScreenshotTarget;
  pixelWidth: number;
  pixelHeight: number;
  fileNameHint?: string;
}

const METADATA_EXTENSION = '.json';

const nowIso = (): string => new Date().toISOString();

const metadataFileName = (artifactId: string): string => `${artifactId}${METADATA_EXTENSION}`;

const isArtifactMetadata = (value: unknown): value is ArtifactMetadata => {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.artifactId === 'string' &&
    typeof candidate.mimeType === 'string' &&
    typeof candidate.byteLength === 'number' &&
    typeof candidate.pixelWidth === 'number' &&
    typeof candidate.pixelHeight === 'number' &&
    typeof candidate.target === 'string' &&
    typeof candidate.createdAt === 'string' &&
    typeof candidate.fileName === 'string'
  );
};

export class ArtifactStore {
  private readonly artifactsDir: string;

  constructor(private readonly storageDir: string) {
    this.artifactsDir = path.join(storageDir, 'artifacts');
  }

  async ensureReady(): Promise<void> {
    await fs.mkdir(this.artifactsDir, { recursive: true });
  }

  async saveScreenshot(input: ArtifactStoreSaveInput): Promise<ScreenshotArtifact> {
    await this.ensureReady();

    const artifactId = randomBytes(12).toString('hex');
    const fileName = buildScreenshotFileName({
      artifactId,
      target: input.target,
      format: input.format,
      fileNameHint: input.fileNameHint,
    });
    const metadata: ArtifactMetadata = {
      artifactId,
      mimeType: getMimeTypeForFormat(input.format),
      byteLength: input.buffer.byteLength,
      pixelWidth: input.pixelWidth,
      pixelHeight: input.pixelHeight,
      target: input.target,
      createdAt: nowIso(),
      fileName,
    };

    const filePath = getArtifactFilePath(this.artifactsDir, fileName);
    await fs.writeFile(filePath, input.buffer);
    await fs.writeFile(
      path.join(this.artifactsDir, metadataFileName(artifactId)),
      JSON.stringify(metadata, null, 2),
      'utf8',
    );

    return metadata;
  }

  async getArtifact(artifactId: string): Promise<ArtifactRecord> {
    const metadata = await this.readMetadata(artifactId);
    return {
      ...metadata,
      filePath: getArtifactFilePath(this.artifactsDir, metadata.fileName),
    };
  }

  async listArtifacts(): Promise<ArtifactRecord[]> {
    await this.ensureReady();
    const entries = await fs.readdir(this.artifactsDir);
    const metadataFiles = entries.filter((entry) => entry.endsWith(METADATA_EXTENSION));
    const artifacts = await Promise.all(
      metadataFiles.map(async (fileName) => {
        const raw = JSON.parse(
          await fs.readFile(path.join(this.artifactsDir, fileName), 'utf8'),
        ) as unknown;

        if (!isArtifactMetadata(raw)) {
          return null;
        }

        return {
          ...raw,
          filePath: getArtifactFilePath(this.artifactsDir, raw.fileName),
        };
      }),
    );

    return artifacts
      .filter((artifact): artifact is ArtifactRecord => artifact !== null)
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  }

  async deleteArtifact(artifactId: string): Promise<void> {
    const artifact = await this.getArtifact(artifactId);
    await Promise.all([
      fs.rm(artifact.filePath, { force: true }),
      fs.rm(path.join(this.artifactsDir, metadataFileName(artifactId)), { force: true }),
    ]);
  }

  private async readMetadata(artifactId: string): Promise<ArtifactMetadata> {
    await this.ensureReady();

    const metadataPath = path.join(this.artifactsDir, metadataFileName(artifactId));
    let parsed: unknown;

    try {
      parsed = JSON.parse(await fs.readFile(metadataPath, 'utf8'));
    } catch {
      throw new Error(`Artifact ${artifactId} was not found.`);
    }

    if (!isArtifactMetadata(parsed)) {
      throw new Error(`Artifact ${artifactId} metadata is invalid.`);
    }

    return parsed;
  }
}
