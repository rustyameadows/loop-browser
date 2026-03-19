const HEX_COLOR_PATTERN = /^#[0-9A-F]{6}$/;

export const normalizeHexColorDraft = (value: string): string => value.trim().toUpperCase();

export const isValidHexColorDraft = (value: string): boolean =>
  HEX_COLOR_PATTERN.test(normalizeHexColorDraft(value));

export const getHexColorDraftError = (
  label: string,
  value: string,
): string | null => {
  if (!value.trim()) {
    return `${label} is required.`;
  }

  return isValidHexColorDraft(value)
    ? null
    : `${label} must be a hex color in the form #RRGGBB.`;
};

export const getColorPickerValue = (draft: string, fallback: string): string =>
  isValidHexColorDraft(draft) ? normalizeHexColorDraft(draft) : normalizeHexColorDraft(fallback);

export const resolveDraftProjectIconPath = (
  projectRoot: string,
  draftProjectIconPath: string,
  appliedProjectIconPath: string,
  appliedResolvedProjectIconPath: string | null,
): string | null => {
  const trimmedDraftPath = draftProjectIconPath.trim();
  if (!projectRoot.trim() || !trimmedDraftPath) {
    return null;
  }

  if (
    trimmedDraftPath === appliedProjectIconPath &&
    appliedResolvedProjectIconPath
  ) {
    return appliedResolvedProjectIconPath;
  }

  const separator = projectRoot.includes('\\') ? '\\' : '/';
  const normalizedProjectRoot = projectRoot.replace(/[\\/]+$/, '');
  const normalizedRelativePath = trimmedDraftPath
    .replace(/^\.[/\\]?/, '')
    .replace(/[\\/]+/g, separator);

  return `${normalizedProjectRoot}${separator}${normalizedRelativePath}`;
};
