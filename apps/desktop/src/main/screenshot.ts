import path from 'node:path';
import type {
  ResizeTarget,
  ScreenshotFormat,
  ScreenshotTarget,
  WindowRect,
} from '@agent-browser/protocol';

export const CHROME_HEIGHT = 98;
export const SIDE_PANEL_WIDTH = 460;
export const SIDE_PANEL_BREAKPOINT = 1100;

export interface Size {
  width: number;
  height: number;
}

export interface ViewportRect extends WindowRect {
  deviceScaleFactor: number;
}

export interface ElementBox {
  viewportX: number;
  viewportY: number;
  pageX: number;
  pageY: number;
  width: number;
  height: number;
  devicePixelRatio: number;
  viewportWidth: number;
  viewportHeight: number;
  scrollX: number;
  scrollY: number;
};

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
