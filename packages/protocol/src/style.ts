import { isElementDescriptor, type ElementDescriptor } from './navigation';
import {
  isPanelPresentationMode,
  isPanelSidebarSide,
  type PanelPresentationMode,
  type PanelSidebarSide,
} from './panel-presentation';

export const STYLE_VIEW_COMMAND_CHANNEL = 'style-view:command';
export const STYLE_VIEW_GET_STATE_CHANNEL = 'style-view:get-state';
export const STYLE_VIEW_STATE_CHANNEL = 'style-view:state';
export const PAGE_STYLE_CONTROL_CHANNEL = 'page-style:control';
export const PAGE_STYLE_EVENT_CHANNEL = 'page-style:event';

export const styleViewActions = [
  'open',
  'close',
  'toggle',
  'setPresentation',
  'moveFloatingPill',
  'startInspectionFromSelection',
  'refreshInspection',
  'setOverrideDeclaration',
  'removeOverrideDeclaration',
  'replaceOverridesFromRawCss',
  'clearPreview',
] as const;
export const styleViewStatuses = ['idle', 'loading', 'ready', 'error'] as const;
export const stylePreviewStatuses = ['idle', 'applied', 'error'] as const;
export const styleRuleOrigins = ['inline', 'author'] as const;
export const curatedStyleProperties = [
  'color',
  'background-color',
  'font-size',
  'font-weight',
  'line-height',
  'text-align',
  'margin-top',
  'margin-right',
  'margin-bottom',
  'margin-left',
  'padding-top',
  'padding-right',
  'padding-bottom',
  'padding-left',
  'width',
  'height',
  'border-radius',
  'border-width',
  'border-style',
  'border-color',
  'opacity',
  'display',
  'justify-content',
  'align-items',
] as const;

export type StyleViewAction = (typeof styleViewActions)[number];
export type StyleViewStatus = (typeof styleViewStatuses)[number];
export type StyleViewPreviewStatus = (typeof stylePreviewStatuses)[number];
export type StyleRuleOrigin = (typeof styleRuleOrigins)[number];
export type CuratedStyleProperty = (typeof curatedStyleProperties)[number];

export interface StyleTweak {
  property: string;
  value: string;
  previousValue: string;
}

export interface StyleRuleMatch {
  origin: StyleRuleOrigin;
  selectorText: string;
  declarations: string;
  sourceLabel: string;
  atRuleContext: string[];
}

export interface StyleInspectionPayload {
  selection: ElementDescriptor;
  matchedRules: StyleRuleMatch[];
  computedValues: Record<string, string>;
  unreadableStylesheetCount: number;
  unreadableStylesheetWarning: string | null;
  overrideDeclarations: Record<string, string>;
  previewStatus: StyleViewPreviewStatus;
  lastError: string | null;
}

export interface StyleViewState extends Omit<StyleInspectionPayload, 'selection'> {
  isOpen: boolean;
  status: StyleViewStatus;
  selection: ElementDescriptor | null;
  linkedAnnotationId: string | null;
}

export type StyleViewCommand =
  | {
      action: 'open' | 'close' | 'toggle' | 'refreshInspection' | 'clearPreview';
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
      action: 'startInspectionFromSelection';
      selection: ElementDescriptor;
    }
  | {
      action: 'setOverrideDeclaration';
      property: string;
      value: string;
    }
  | {
      action: 'removeOverrideDeclaration';
      property: string;
    }
  | {
      action: 'replaceOverridesFromRawCss';
      rawCss: string;
    };

export type PageStyleControl =
  | {
      requestId: string;
      action: 'inspect';
      selection: ElementDescriptor;
      declarations: Record<string, string>;
    }
  | {
      requestId: string;
      action: 'replaceOverridesFromRawCss';
      selection: ElementDescriptor;
      rawCss: string;
    }
  | {
      requestId: string;
      action: 'clearPreview';
      selection: ElementDescriptor | null;
    };

export type PageStyleEvent =
  | {
      type: 'result';
      requestId: string;
      inspection: StyleInspectionPayload;
    }
  | {
      type: 'error';
      requestId: string;
      message: string;
    }
  | {
      type: 'selectionLost';
      message: string;
    };

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const isPlainStringRecord = (value: unknown): value is Record<string, string> => {
  if (!isRecord(value)) {
    return false;
  }

  return Object.values(value).every((entry) => typeof entry === 'string');
};

export const createEmptyStyleViewState = (): StyleViewState => ({
  isOpen: false,
  status: 'idle',
  selection: null,
  matchedRules: [],
  computedValues: {},
  unreadableStylesheetCount: 0,
  unreadableStylesheetWarning: null,
  overrideDeclarations: {},
  previewStatus: 'idle',
  linkedAnnotationId: null,
  lastError: null,
});

export const isStyleTweak = (value: unknown): value is StyleTweak => {
  if (!isRecord(value)) {
    return false;
  }

  return (
    typeof value.property === 'string' &&
    typeof value.value === 'string' &&
    typeof value.previousValue === 'string'
  );
};

export const isStyleRuleMatch = (value: unknown): value is StyleRuleMatch => {
  if (!isRecord(value)) {
    return false;
  }

  return (
    typeof value.origin === 'string' &&
    styleRuleOrigins.includes(value.origin as StyleRuleOrigin) &&
    typeof value.selectorText === 'string' &&
    typeof value.declarations === 'string' &&
    typeof value.sourceLabel === 'string' &&
    Array.isArray(value.atRuleContext) &&
    value.atRuleContext.every((entry) => typeof entry === 'string')
  );
};

export const isStyleInspectionPayload = (value: unknown): value is StyleInspectionPayload => {
  if (!isRecord(value)) {
    return false;
  }

  return (
    isElementDescriptor(value.selection) &&
    Array.isArray(value.matchedRules) &&
    value.matchedRules.every(isStyleRuleMatch) &&
    isPlainStringRecord(value.computedValues) &&
    typeof value.unreadableStylesheetCount === 'number' &&
    (typeof value.unreadableStylesheetWarning === 'string' ||
      value.unreadableStylesheetWarning === null) &&
    isPlainStringRecord(value.overrideDeclarations) &&
    typeof value.previewStatus === 'string' &&
    stylePreviewStatuses.includes(value.previewStatus as StyleViewPreviewStatus) &&
    (typeof value.lastError === 'string' || value.lastError === null)
  );
};

export const isStyleViewState = (value: unknown): value is StyleViewState => {
  if (!isRecord(value)) {
    return false;
  }

  return (
    typeof value.isOpen === 'boolean' &&
    typeof value.status === 'string' &&
    styleViewStatuses.includes(value.status as StyleViewStatus) &&
    (value.selection === null || isElementDescriptor(value.selection)) &&
    Array.isArray(value.matchedRules) &&
    value.matchedRules.every(isStyleRuleMatch) &&
    isPlainStringRecord(value.computedValues) &&
    typeof value.unreadableStylesheetCount === 'number' &&
    (typeof value.unreadableStylesheetWarning === 'string' ||
      value.unreadableStylesheetWarning === null) &&
    isPlainStringRecord(value.overrideDeclarations) &&
    typeof value.previewStatus === 'string' &&
    stylePreviewStatuses.includes(value.previewStatus as StyleViewPreviewStatus) &&
    (typeof value.linkedAnnotationId === 'string' || value.linkedAnnotationId === null) &&
    (typeof value.lastError === 'string' || value.lastError === null)
  );
};

export const isStyleViewCommand = (value: unknown): value is StyleViewCommand => {
  if (!isRecord(value) || typeof value.action !== 'string') {
    return false;
  }

  if (!styleViewActions.includes(value.action as StyleViewAction)) {
    return false;
  }

  switch (value.action) {
    case 'open':
    case 'close':
    case 'toggle':
    case 'refreshInspection':
    case 'clearPreview':
      return true;
    case 'setPresentation':
      return (
        isPanelPresentationMode(value.mode) &&
        (!('side' in value) || value.side === undefined || isPanelSidebarSide(value.side))
      );
    case 'moveFloatingPill':
      return typeof value.deltaX === 'number' && typeof value.deltaY === 'number';
    case 'startInspectionFromSelection':
      return isElementDescriptor(value.selection);
    case 'setOverrideDeclaration':
      return typeof value.property === 'string' && typeof value.value === 'string';
    case 'removeOverrideDeclaration':
      return typeof value.property === 'string';
    case 'replaceOverridesFromRawCss':
      return typeof value.rawCss === 'string';
    default:
      return false;
  }
};

export const isPageStyleControl = (value: unknown): value is PageStyleControl => {
  if (!isRecord(value) || typeof value.requestId !== 'string' || typeof value.action !== 'string') {
    return false;
  }

  switch (value.action) {
    case 'inspect':
      return isElementDescriptor(value.selection) && isPlainStringRecord(value.declarations);
    case 'replaceOverridesFromRawCss':
      return isElementDescriptor(value.selection) && typeof value.rawCss === 'string';
    case 'clearPreview':
      return value.selection === null || isElementDescriptor(value.selection);
    default:
      return false;
  }
};

export const isPageStyleEvent = (value: unknown): value is PageStyleEvent => {
  if (!isRecord(value) || typeof value.type !== 'string') {
    return false;
  }

  switch (value.type) {
    case 'result':
      return typeof value.requestId === 'string' && isStyleInspectionPayload(value.inspection);
    case 'error':
      return typeof value.requestId === 'string' && typeof value.message === 'string';
    case 'selectionLost':
      return typeof value.message === 'string';
    default:
      return false;
  }
};
