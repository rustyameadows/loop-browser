export const screenshotTargets = ['page', 'element', 'window'] as const;
export const screenshotFormats = ['png', 'jpeg'] as const;
export const resizeTargets = ['window', 'content', 'pageViewport'] as const;

export type ScreenshotTarget = (typeof screenshotTargets)[number];
export type ScreenshotFormat = (typeof screenshotFormats)[number];
export type ResizeTarget = (typeof resizeTargets)[number];

export interface WindowRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ScreenshotRequest {
  target: ScreenshotTarget;
  selector?: string;
  format?: ScreenshotFormat;
  quality?: number;
  fileNameHint?: string;
}

export interface ScreenshotArtifact {
  artifactId: string;
  mimeType: string;
  byteLength: number;
  pixelWidth: number;
  pixelHeight: number;
  target: ScreenshotTarget;
  createdAt: string;
  fileName: string;
}

export interface ArtifactRecord extends ScreenshotArtifact {
  filePath: string;
}

export interface WindowState {
  outerBounds: WindowRect;
  contentBounds: WindowRect;
  pageViewportBounds: WindowRect;
  chromeHeight: number;
  deviceScaleFactor: number;
}

export interface ResizeWindowRequest {
  width: number;
  height: number;
  target?: ResizeTarget;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

const isWindowRect = (value: unknown): value is WindowRect => {
  if (!isRecord(value)) {
    return false;
  }

  return (
    isFiniteNumber(value.x) &&
    isFiniteNumber(value.y) &&
    isFiniteNumber(value.width) &&
    isFiniteNumber(value.height)
  );
};

export const isScreenshotRequest = (value: unknown): value is ScreenshotRequest => {
  if (!isRecord(value) || typeof value.target !== 'string') {
    return false;
  }

  if (!screenshotTargets.includes(value.target as ScreenshotTarget)) {
    return false;
  }

  if ('selector' in value && value.selector !== undefined && typeof value.selector !== 'string') {
    return false;
  }

  if ('format' in value && value.format !== undefined) {
    if (typeof value.format !== 'string') {
      return false;
    }

    if (!screenshotFormats.includes(value.format as ScreenshotFormat)) {
      return false;
    }
  }

  if ('quality' in value && value.quality !== undefined && !isFiniteNumber(value.quality)) {
    return false;
  }

  if (
    'fileNameHint' in value &&
    value.fileNameHint !== undefined &&
    typeof value.fileNameHint !== 'string'
  ) {
    return false;
  }

  return true;
};

const isScreenshotArtifactBase = (value: unknown): value is ScreenshotArtifact => {
  if (!isRecord(value)) {
    return false;
  }

  return (
    typeof value.artifactId === 'string' &&
    typeof value.mimeType === 'string' &&
    isFiniteNumber(value.byteLength) &&
    isFiniteNumber(value.pixelWidth) &&
    isFiniteNumber(value.pixelHeight) &&
    typeof value.target === 'string' &&
    screenshotTargets.includes(value.target as ScreenshotTarget) &&
    typeof value.createdAt === 'string' &&
    typeof value.fileName === 'string'
  );
};

export const isScreenshotArtifact = (value: unknown): value is ScreenshotArtifact =>
  isScreenshotArtifactBase(value);

export const isArtifactRecord = (value: unknown): value is ArtifactRecord =>
  isScreenshotArtifactBase(value) &&
  isRecord(value) &&
  typeof value.filePath === 'string';

export const isWindowState = (value: unknown): value is WindowState => {
  if (!isRecord(value)) {
    return false;
  }

  return (
    isWindowRect(value.outerBounds) &&
    isWindowRect(value.contentBounds) &&
    isWindowRect(value.pageViewportBounds) &&
    isFiniteNumber(value.chromeHeight) &&
    isFiniteNumber(value.deviceScaleFactor)
  );
};

export const isResizeWindowRequest = (value: unknown): value is ResizeWindowRequest => {
  if (!isRecord(value)) {
    return false;
  }

  if (!isFiniteNumber(value.width) || !isFiniteNumber(value.height)) {
    return false;
  }

  if ('target' in value && value.target !== undefined) {
    return (
      typeof value.target === 'string' &&
      resizeTargets.includes(value.target as ResizeTarget)
    );
  }

  return true;
};
