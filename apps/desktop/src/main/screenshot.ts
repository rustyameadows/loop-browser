import path from 'node:path';
import type {
  ResizeTarget,
  ScreenshotFormat,
  ScreenshotTarget,
  WindowRect,
} from '@agent-browser/protocol';

export const CHROME_HEIGHT = 152;
export const SIDE_PANEL_WIDTH = 460;
export const SIDE_PANEL_BREAKPOINT = 1100;

export interface Size {
  width: number;
  height: number;
}

export interface ViewportRect extends WindowRect {
  deviceScaleFactor: number;
}

export interface ElementCaptureRect {
  x: number;
  y: number;
  width: number;
  height: number;
  pixelWidth: number;
  pixelHeight: number;
}

export interface ElementBox {
  x: number;
  y: number;
  width: number;
  height: number;
  devicePixelRatio: number;
  viewportWidth: number;
  viewportHeight: number;
}

const clampDimension = (value: number): number => Math.max(Math.round(value), 1);

export const computeContentSizeForResize = (options: {
  width: number;
  height: number;
  target: ResizeTarget;
  hasSidePanelOpen: boolean;
}): Size => {
  const width = clampDimension(options.width);
  const height = clampDimension(options.height);

  if (options.target === 'window') {
    return { width, height };
  }

  if (options.target === 'content') {
    return { width, height };
  }

  if (!options.hasSidePanelOpen) {
    return {
      width,
      height: height + CHROME_HEIGHT,
    };
  }

  const contentWidth = Math.max(width + SIDE_PANEL_WIDTH, SIDE_PANEL_BREAKPOINT);
  return {
    width: contentWidth,
    height: height + CHROME_HEIGHT,
  };
};

export const clipElementToViewport = (box: ElementBox): ElementCaptureRect | null => {
  const left = Math.max(0, box.x);
  const top = Math.max(0, box.y);
  const right = Math.min(box.viewportWidth, box.x + box.width);
  const bottom = Math.min(box.viewportHeight, box.y + box.height);
  const clippedWidth = right - left;
  const clippedHeight = bottom - top;

  if (clippedWidth <= 0 || clippedHeight <= 0) {
    return null;
  }

  return {
    x: Math.round(left),
    y: Math.round(top),
    width: Math.round(clippedWidth),
    height: Math.round(clippedHeight),
    pixelWidth: Math.max(Math.round(clippedWidth * box.devicePixelRatio), 1),
    pixelHeight: Math.max(Math.round(clippedHeight * box.devicePixelRatio), 1),
  };
};

export const sanitizeFileNameHint = (value: string | undefined, fallback: string): string => {
  if (!value || value.trim().length === 0) {
    return fallback;
  }

  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-');

  return normalized.length > 0 ? normalized.slice(0, 48) : fallback;
};

export const buildScreenshotFileName = (options: {
  artifactId: string;
  target: ScreenshotTarget;
  format: ScreenshotFormat;
  fileNameHint?: string;
}): string => {
  const extension = options.format === 'jpeg' ? 'jpg' : 'png';
  const hint = sanitizeFileNameHint(options.fileNameHint, options.target);
  return `${options.artifactId}-${hint}.${extension}`;
};

export const getMimeTypeForFormat = (format: ScreenshotFormat): string =>
  format === 'jpeg' ? 'image/jpeg' : 'image/png';

export const inferPixelSizeFromScaleFactor = (
  width: number,
  height: number,
  deviceScaleFactor: number,
): Size => ({
  width: Math.max(Math.round(width * deviceScaleFactor), 1),
  height: Math.max(Math.round(height * deviceScaleFactor), 1),
});

export const getArtifactFilePath = (artifactsDir: string, fileName: string): string =>
  path.join(artifactsDir, fileName);
