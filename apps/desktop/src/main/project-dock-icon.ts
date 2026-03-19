import { promises as fs } from 'node:fs';
import path from 'node:path';

export interface DockIconTemplateLocationOptions {
  appPath: string;
  isPackaged: boolean;
  resourcesPath: string;
}

export const dockIconTemplatePath = ({
  appPath,
  isPackaged,
  resourcesPath,
}: DockIconTemplateLocationOptions): string =>
  isPackaged
    ? path.join(resourcesPath, 'static', 'dock-icon-template.svg')
    : path.join(appPath, 'static', 'dock-icon-template.svg');

const buildBaseSvg = (accentColor: string): Buffer =>
  Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">
      <defs>
        <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stop-color="${accentColor}" stop-opacity="0.96" />
          <stop offset="100%" stop-color="#111827" stop-opacity="0.18" />
        </linearGradient>
      </defs>
      <rect x="16" y="16" width="480" height="480" rx="116" fill="url(#bg)" />
    </svg>`,
  );

const buildMaskSvg = (): Buffer =>
  Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="360" height="360" viewBox="0 0 360 360">
      <rect x="0" y="0" width="360" height="360" rx="88" fill="#ffffff" />
    </svg>`,
  );

const buildDefaultGlyphSvg = (): Buffer =>
  Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">
      <rect x="116" y="116" width="280" height="280" rx="88" fill="rgba(255,255,255,0.94)" />
      <path
        d="M256 194c-34 0-62 28-62 62s28 62 62 62c20 0 37-8 48-22"
        fill="none"
        stroke="#111827"
        stroke-linecap="round"
        stroke-linejoin="round"
        stroke-width="24"
      />
      <path
        d="M256 318c34 0 62-28 62-62s-28-62-62-62c-20 0-37 8-48 22"
        fill="none"
        stroke="#111827"
        stroke-linecap="round"
        stroke-linejoin="round"
        stroke-width="24"
      />
    </svg>`,
  );

type SharpFactory = typeof import('sharp');

let sharpPromise: Promise<SharpFactory> | null = null;

const loadSharp = async (): Promise<SharpFactory> => {
  if (sharpPromise === null) {
    sharpPromise = import('sharp').then(
      (module) =>
        (module as unknown as { default?: SharpFactory }).default ??
        (module as unknown as SharpFactory),
    );
  }

  return sharpPromise;
};

export const composeProjectDockIcon = async (options: {
  accentColor: string;
  projectIconPath: string;
  templatePath: string;
}): Promise<Buffer> => {
  const sharp = await loadSharp();
  const templateBuffer = await fs.readFile(options.templatePath);
  const maskedProjectIcon = await sharp(options.projectIconPath)
    .resize(360, 360, {
      fit: 'cover',
      position: 'centre',
    })
    .composite([
      {
        input: buildMaskSvg(),
        blend: 'dest-in',
      },
    ])
    .png()
    .toBuffer();

  return sharp(buildBaseSvg(options.accentColor))
    .composite([
      {
        input: maskedProjectIcon,
        left: 76,
        top: 76,
      },
      {
        input: templateBuffer,
      },
    ])
    .png()
    .toBuffer();
};

export const composeDefaultDockIcon = async (options: {
  accentColor: string;
  templatePath: string;
}): Promise<Buffer> => {
  const sharp = await loadSharp();
  const templateBuffer = await fs.readFile(options.templatePath);

  return sharp(buildBaseSvg(options.accentColor))
    .composite([
      {
        input: buildDefaultGlyphSvg(),
      },
      {
        input: templateBuffer,
      },
    ])
    .png()
    .toBuffer();
};
