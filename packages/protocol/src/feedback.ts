import { isElementDescriptor, type ElementDescriptor, type PickerIntent } from './navigation';
import {
  isPanelPresentationMode,
  isPanelSidebarSide,
  type PanelPresentationMode,
  type PanelSidebarSide,
} from './panel-presentation';
import { isStyleTweak, type StyleTweak } from './style';

export const FEEDBACK_COMMAND_CHANNEL = 'feedback:command';
export const FEEDBACK_GET_STATE_CHANNEL = 'feedback:get-state';
export const FEEDBACK_STATE_CHANNEL = 'feedback:state';

export const feedbackKinds = ['bug', 'change', 'question', 'praise'] as const;
export const feedbackPriorities = ['low', 'medium', 'high', 'critical'] as const;
export const feedbackStatuses = [
  'open',
  'acknowledged',
  'in_progress',
  'resolved',
  'dismissed',
] as const;
export const feedbackAuthors = ['human', 'agent', 'system'] as const;

export type FeedbackKind = (typeof feedbackKinds)[number];
export type FeedbackPriority = (typeof feedbackPriorities)[number];
export type FeedbackStatus = (typeof feedbackStatuses)[number];
export type FeedbackAuthor = (typeof feedbackAuthors)[number];

export interface FeedbackReply {
  id: string;
  author: FeedbackAuthor;
  body: string;
  createdAt: string;
}

export interface FeedbackDraft {
  selection: ElementDescriptor | null;
  summary: string;
  note: string;
  kind: FeedbackKind;
  priority: FeedbackPriority;
  intent: PickerIntent;
  styleTweaks: StyleTweak[];
  sourceUrl: string;
  sourceTitle: string;
}

export interface FeedbackAnnotation {
  id: string;
  selection: ElementDescriptor;
  summary: string;
  note: string;
  kind: FeedbackKind;
  priority: FeedbackPriority;
  intent: PickerIntent;
  styleTweaks: StyleTweak[];
  status: FeedbackStatus;
  createdAt: string;
  updatedAt: string;
  url: string;
  pageTitle: string;
  replies: FeedbackReply[];
}

export interface FeedbackState {
  isOpen: boolean;
  draft: FeedbackDraft;
  activeAnnotationId: string | null;
  annotations: FeedbackAnnotation[];
  lastUpdatedAt: string | null;
}

export type FeedbackCommand =
  | {
      action: 'open' | 'close' | 'toggle' | 'clearDraft';
    }
  | {
      action: 'setPresentation';
      mode: PanelPresentationMode;
      side?: PanelSidebarSide;
    }
  | {
      action: 'moveFloatingPill';
      deltaX: number;
      deltaY: number;
    }
  | {
      action: 'startDraftFromSelection';
      selection: ElementDescriptor;
      intent?: PickerIntent;
      styleTweaks?: StyleTweak[];
      sourceUrl?: string;
      sourceTitle?: string;
    }
  | {
      action: 'updateDraft';
      summary?: string;
      note?: string;
      kind?: FeedbackKind;
      priority?: FeedbackPriority;
      intent?: PickerIntent;
      styleTweaks?: StyleTweak[];
    }
  | {
      action: 'submitDraft';
    }
  | {
      action: 'selectAnnotation';
      annotationId: string | null;
    }
  | {
      action: 'setStatus';
      annotationId: string;
      status: FeedbackStatus;
    }
  | {
      action: 'reply';
      annotationId: string;
      body: string;
      author?: FeedbackAuthor;
    };

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const isPickerIntent = (value: unknown): value is PickerIntent =>
  value === 'feedback' || value === 'style';

export const createEmptyFeedbackDraft = (): FeedbackDraft => ({
  selection: null,
  summary: '',
  note: '',
  kind: 'bug',
  priority: 'medium',
  intent: 'feedback',
  styleTweaks: [],
  sourceUrl: '',
  sourceTitle: '',
});

export const createEmptyFeedbackState = (): FeedbackState => ({
  isOpen: false,
  draft: createEmptyFeedbackDraft(),
  activeAnnotationId: null,
  annotations: [],
  lastUpdatedAt: null,
});

export const isFeedbackKind = (value: unknown): value is FeedbackKind =>
  typeof value === 'string' && feedbackKinds.includes(value as FeedbackKind);

export const isFeedbackPriority = (value: unknown): value is FeedbackPriority =>
  typeof value === 'string' && feedbackPriorities.includes(value as FeedbackPriority);

export const isFeedbackStatus = (value: unknown): value is FeedbackStatus =>
  typeof value === 'string' && feedbackStatuses.includes(value as FeedbackStatus);

export const isFeedbackAuthor = (value: unknown): value is FeedbackAuthor =>
  typeof value === 'string' && feedbackAuthors.includes(value as FeedbackAuthor);

export const isFeedbackReply = (value: unknown): value is FeedbackReply => {
  if (!isRecord(value)) {
    return false;
  }

  return (
    typeof value.id === 'string' &&
    isFeedbackAuthor(value.author) &&
    typeof value.body === 'string' &&
    typeof value.createdAt === 'string'
  );
};

export const isFeedbackDraft = (value: unknown): value is FeedbackDraft => {
  if (!isRecord(value)) {
    return false;
  }

  return (
    (value.selection === null || isElementDescriptor(value.selection)) &&
    typeof value.summary === 'string' &&
    typeof value.note === 'string' &&
    isFeedbackKind(value.kind) &&
    isFeedbackPriority(value.priority) &&
    isPickerIntent(value.intent) &&
    Array.isArray(value.styleTweaks) &&
    value.styleTweaks.every(isStyleTweak) &&
    typeof value.sourceUrl === 'string' &&
    typeof value.sourceTitle === 'string'
  );
};

export const isFeedbackAnnotation = (value: unknown): value is FeedbackAnnotation => {
  if (!isRecord(value)) {
    return false;
  }

  return (
    typeof value.id === 'string' &&
    isElementDescriptor(value.selection) &&
    typeof value.summary === 'string' &&
    typeof value.note === 'string' &&
    isFeedbackKind(value.kind) &&
    isFeedbackPriority(value.priority) &&
    isPickerIntent(value.intent) &&
    Array.isArray(value.styleTweaks) &&
    value.styleTweaks.every(isStyleTweak) &&
    isFeedbackStatus(value.status) &&
    typeof value.createdAt === 'string' &&
    typeof value.updatedAt === 'string' &&
    typeof value.url === 'string' &&
    typeof value.pageTitle === 'string' &&
    Array.isArray(value.replies) &&
    value.replies.every(isFeedbackReply)
  );
};

export const isFeedbackState = (value: unknown): value is FeedbackState => {
  if (!isRecord(value)) {
    return false;
  }

  return (
    typeof value.isOpen === 'boolean' &&
    isFeedbackDraft(value.draft) &&
    (typeof value.activeAnnotationId === 'string' || value.activeAnnotationId === null) &&
    Array.isArray(value.annotations) &&
    value.annotations.every(isFeedbackAnnotation) &&
    (typeof value.lastUpdatedAt === 'string' || value.lastUpdatedAt === null)
  );
};

export const isFeedbackCommand = (value: unknown): value is FeedbackCommand => {
  if (!isRecord(value) || typeof value.action !== 'string') {
    return false;
  }

  switch (value.action) {
    case 'open':
    case 'close':
    case 'toggle':
    case 'clearDraft':
    case 'submitDraft':
      return true;
    case 'setPresentation':
      return (
        isPanelPresentationMode(value.mode) &&
        (!('side' in value) || value.side === undefined || isPanelSidebarSide(value.side))
      );
    case 'moveFloatingPill':
      return typeof value.deltaX === 'number' && typeof value.deltaY === 'number';
    case 'startDraftFromSelection':
      return (
        isElementDescriptor(value.selection) &&
        (!('intent' in value) || value.intent === undefined || isPickerIntent(value.intent)) &&
        (!('styleTweaks' in value) ||
          value.styleTweaks === undefined ||
          (Array.isArray(value.styleTweaks) && value.styleTweaks.every(isStyleTweak)))
      );
    case 'updateDraft':
      return (
        (!('summary' in value) || typeof value.summary === 'string') &&
        (!('note' in value) || typeof value.note === 'string') &&
        (!('kind' in value) || isFeedbackKind(value.kind)) &&
        (!('priority' in value) || isFeedbackPriority(value.priority)) &&
        (!('intent' in value) || value.intent === undefined || isPickerIntent(value.intent)) &&
        (!('styleTweaks' in value) ||
          value.styleTweaks === undefined ||
          (Array.isArray(value.styleTweaks) && value.styleTweaks.every(isStyleTweak)))
      );
    case 'selectAnnotation':
      return typeof value.annotationId === 'string' || value.annotationId === null;
    case 'setStatus':
      return typeof value.annotationId === 'string' && isFeedbackStatus(value.status);
    case 'reply':
      return (
        typeof value.annotationId === 'string' &&
        typeof value.body === 'string' &&
        value.body.trim().length > 0 &&
        (!('author' in value) || value.author === undefined || isFeedbackAuthor(value.author))
      );
    default:
      return false;
  }
};
