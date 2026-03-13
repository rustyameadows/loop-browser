import path from 'node:path';
import { pathToFileURL } from 'node:url';

const LOCAL_HOST_PATTERN = /^(localhost|127(?:\.\d{1,3}){3}|0\.0\.0\.0)(:\d+)?(\/.*)?$/i;
const HTTP_SCHEME_PATTERN = /^https?:\/\//i;
const FILE_SCHEME_PATTERN = /^file:\/\//i;

export const normalizeAddress = (input: string): string => {
  const trimmed = input.trim();

  if (!trimmed) {
    throw new Error('Enter a URL to navigate.');
  }

  if (trimmed === 'about:blank') {
    return trimmed;
  }

  if (HTTP_SCHEME_PATTERN.test(trimmed) || FILE_SCHEME_PATTERN.test(trimmed)) {
    return new URL(trimmed).toString();
  }

  if (path.isAbsolute(trimmed)) {
    return pathToFileURL(trimmed).toString();
  }

  if (LOCAL_HOST_PATTERN.test(trimmed)) {
    return new URL(`http://${trimmed}`).toString();
  }

  return new URL(`https://${trimmed}`).toString();
};

export const fixtureFilePath = (appPath: string): string =>
  path.join(appPath, 'static', 'local-fixture.html');

export const fixtureFileUrl = (appPath: string): string =>
  pathToFileURL(fixtureFilePath(appPath)).toString();

export const isSafeExternalUrl = (value: string): boolean => HTTP_SCHEME_PATTERN.test(value);

