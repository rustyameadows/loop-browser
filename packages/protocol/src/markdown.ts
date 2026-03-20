import {
  isPanelPresentationMode,
  isPanelSidebarSide,
  type PanelPresentationMode,
  type PanelSidebarSide,
} from './panel-presentation';

export const MARKDOWN_VIEW_COMMAND_CHANNEL = 'markdown-view:command';
export const MARKDOWN_VIEW_GET_STATE_CHANNEL = 'markdown-view:get-state';
export const MARKDOWN_VIEW_STATE_CHANNEL = 'markdown-view:state';

export const markdownViewActions = [
  'open',
  'close',
  'refresh',
  'toggle',
  'setPresentation',
  'moveFloatingPill',
] as const;
export const markdownViewStatuses = ['idle', 'loading', 'ready', 'error'] as const;

export type MarkdownViewAction = (typeof markdownViewActions)[number];
export type MarkdownViewStatus = (typeof markdownViewStatuses)[number];

export type MarkdownViewCommand =
  | {
      action: 'open';
    }
  | {
      action: 'setPresentation';
      mode: PanelPresentationMode;
      side?: PanelSidebarSide;
    }
  | {
      action: 'close';
    }
  | {
      action: 'toggle';
    }
  | {
      action: 'refresh';
      force?: boolean;
    }
  | {
      action: 'moveFloatingPill';
      deltaX: number;
      deltaY: number;
    };

export interface MarkdownViewState {
  isOpen: boolean;
  status: MarkdownViewStatus;
  sourceUrl: string;
  title: string;
  markdown: string;
  author: string | null;
  site: string | null;
  wordCount: number | null;
  lastError: string | null;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

export const createEmptyMarkdownViewState = (): MarkdownViewState => ({
  isOpen: false,
  status: 'idle',
  sourceUrl: '',
  title: '',
  markdown: '',
  author: null,
  site: null,
  wordCount: null,
  lastError: null,
});

export const isMarkdownViewCommand = (value: unknown): value is MarkdownViewCommand => {
  if (!isRecord(value) || typeof value.action !== 'string') {
    return false;
  }

  if (!markdownViewActions.includes(value.action as MarkdownViewAction)) {
    return false;
  }

  if (value.action === 'refresh') {
    return !('force' in value) || typeof value.force === 'boolean';
  }

  if (value.action === 'moveFloatingPill') {
    return typeof value.deltaX === 'number' && typeof value.deltaY === 'number';
  }

  if (value.action === 'setPresentation') {
    return (
      isPanelPresentationMode(value.mode) &&
      (!('side' in value) || value.side === undefined || isPanelSidebarSide(value.side))
    );
  }

  return (
    (!('force' in value) || value.force === undefined) &&
    !('deltaX' in value) &&
    !('deltaY' in value)
  );
};

export const isMarkdownViewState = (value: unknown): value is MarkdownViewState => {
  if (!isRecord(value)) {
    return false;
  }

  return (
    typeof value.isOpen === 'boolean' &&
    typeof value.status === 'string' &&
    markdownViewStatuses.includes(value.status as MarkdownViewStatus) &&
    typeof value.sourceUrl === 'string' &&
    typeof value.title === 'string' &&
    typeof value.markdown === 'string' &&
    (typeof value.author === 'string' || value.author === null) &&
    (typeof value.site === 'string' || value.site === null) &&
    (typeof value.wordCount === 'number' || value.wordCount === null) &&
    (typeof value.lastError === 'string' || value.lastError === null)
  );
};
