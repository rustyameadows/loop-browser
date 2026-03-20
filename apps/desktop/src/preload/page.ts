import { ipcRenderer } from 'electron';
import {
  PAGE_AGENT_OVERLAY_CHANNEL,
  PAGE_LOGIN_CONTROL_CHANNEL,
  PAGE_LOGIN_EVENT_CHANNEL,
  PAGE_PICKER_CONTROL_CHANNEL,
  PAGE_PICKER_EVENT_CHANNEL,
  PAGE_STYLE_CONTROL_CHANNEL,
  PAGE_STYLE_EVENT_CHANNEL,
  isPageAgentOverlayState,
  isPageLoginControl,
  isPagePickerControl,
  isPageStyleControl,
  type PickerIntent,
  type PageAgentOverlayState,
} from '@agent-browser/protocol';
import {
  createAccessibleName,
  createElementDescriptor,
  createPlaywrightLocator,
  createStableSelector,
  inferRole,
} from '@agent-browser/selector';
import { fillAgentLogin, hasVisibleLoginForm } from './page-login';
import { PageStyleController } from './page-style';

const OVERLAY_ROOT_ID = '__agent_browser_picker_overlay__';
const AGENT_DONE_PULSE_MS = 1600;

type OverlayElements = {
  root: HTMLDivElement;
  pickerBox: HTMLDivElement;
  pickerLabel: HTMLDivElement;
  pickerHint: HTMLDivElement;
  agentBox: HTMLDivElement;
  agentLabel: HTMLDivElement;
};

const state: {
  enabled: boolean;
  hoveredElement: Element | null;
  overlay: OverlayElements | null;
  pickerIntent: PickerIntent;
  lastPoint: { x: number; y: number } | null;
  animationFrame: number | null;
  agentOverlay: PageAgentOverlayState | null;
  agentClearTimer: number | null;
  hasVisibleLoginForm: boolean;
  loginFormAnimationFrame: number | null;
  loginFormObserver: MutationObserver | null;
} = {
  enabled: false,
  hoveredElement: null,
  overlay: null,
  pickerIntent: 'feedback',
  lastPoint: null,
  animationFrame: null,
  agentOverlay: null,
  agentClearTimer: null,
  hasVisibleLoginForm: false,
  loginFormAnimationFrame: null,
  loginFormObserver: null,
};

const styleController = new PageStyleController((payload) => {
  ipcRenderer.send(PAGE_STYLE_EVENT_CHANNEL, payload);
});

const describeElement = (element: Element): { title: string; meta: string } => {
  const role = inferRole(element);
  const accessibleName = createAccessibleName(element);
  const selector = createStableSelector(element);
  const locator = createPlaywrightLocator(element);

  const titleParts = [role ?? element.localName];
  if (accessibleName) {
    titleParts.push(`"${accessibleName}"`);
  }

  return {
    title: titleParts.join(' '),
    meta: locator ?? selector,
  };
};

const ensureOverlay = (): OverlayElements => {
  if (state.overlay) {
    return state.overlay;
  }

  const root = document.createElement('div');
  root.id = OVERLAY_ROOT_ID;
  root.setAttribute(
    'style',
    [
      'position:fixed',
      'inset:0',
      'pointer-events:none',
      'z-index:2147483647',
      'display:none',
      'font-family:-apple-system,BlinkMacSystemFont,"SF Pro Text","Helvetica Neue",sans-serif',
    ].join(';'),
  );

  const style = document.createElement('style');
  style.textContent = `
    @keyframes agent-browser-picker-pulse {
      0%, 100% { box-shadow: 0 0 0 0 rgba(10, 132, 255, 0.22); }
      50% { box-shadow: 0 0 0 8px rgba(10, 132, 255, 0.08); }
    }

    @keyframes agent-browser-progress-pulse {
      0%, 100% { box-shadow: 0 0 0 0 rgba(10, 132, 255, 0.2); }
      50% { box-shadow: 0 0 0 12px rgba(10, 132, 255, 0.06); }
    }

    @keyframes agent-browser-done-pulse {
      0% { box-shadow: 0 0 0 0 rgba(41, 201, 110, 0.28); transform: scale(0.995); }
      55% { box-shadow: 0 0 0 14px rgba(41, 201, 110, 0.08); transform: scale(1); }
      100% { box-shadow: 0 0 0 0 rgba(41, 201, 110, 0); transform: scale(1); }
    }
  `;

  const pickerBox = document.createElement('div');
  pickerBox.setAttribute(
    'style',
    [
      'position:fixed',
      'border:2px solid rgba(10,132,255,0.95)',
      'background:rgba(10,132,255,0.14)',
      'border-radius:10px',
      'box-shadow:0 0 0 1px rgba(255,255,255,0.92) inset',
      'display:none',
    ].join(';'),
  );

  const pickerLabel = document.createElement('div');
  pickerLabel.setAttribute(
    'style',
    [
      'position:fixed',
      'max-width:min(360px, calc(100vw - 24px))',
      'padding:10px 12px',
      'border-radius:14px',
      'background:rgba(11,22,39,0.96)',
      'color:#f6f8fc',
      'font-size:12px',
      'font-weight:600',
      'letter-spacing:0.01em',
      'display:none',
      'line-height:1.4',
      'box-shadow:0 18px 30px rgba(9,16,28,0.25)',
      'white-space:normal',
    ].join(';'),
  );

  const pickerHint = document.createElement('div');
  pickerHint.textContent = 'Click to add feedback • Esc to cancel';
  pickerHint.setAttribute(
    'style',
    [
      'position:fixed',
      'right:14px',
      'bottom:14px',
      'padding:9px 12px',
      'border-radius:999px',
      'background:rgba(11,22,39,0.96)',
      'color:#f6f8fc',
      'font-size:11px',
      'font-weight:700',
      'letter-spacing:0.02em',
      'box-shadow:0 18px 30px rgba(9,16,28,0.25)',
      'display:none',
    ].join(';'),
  );

  const agentBox = document.createElement('div');
  agentBox.setAttribute(
    'style',
    [
      'position:fixed',
      'border:2px solid transparent',
      'background:transparent',
      'border-radius:14px',
      'display:none',
      'transform-origin:center',
    ].join(';'),
  );

  const agentLabel = document.createElement('div');
  agentLabel.setAttribute(
    'style',
    [
      'position:fixed',
      'max-width:min(280px, calc(100vw - 24px))',
      'padding:10px 12px',
      'border-radius:999px',
      'display:none',
      'line-height:1.35',
      'box-shadow:0 18px 30px rgba(9,16,28,0.18)',
      'white-space:normal',
    ].join(';'),
  );

  root.append(style, pickerBox, pickerLabel, pickerHint, agentBox, agentLabel);
  document.documentElement.append(root);
  state.overlay = {
    root,
    pickerBox,
    pickerLabel,
    pickerHint,
    agentBox,
    agentLabel,
  };
  return state.overlay;
};

const hidePickerOverlay = (): void => {
  if (!state.overlay) {
    return;
  }

  state.overlay.pickerBox.style.display = 'none';
  state.overlay.pickerLabel.style.display = 'none';
  state.overlay.pickerHint.style.display = 'none';
};

const hideAgentOverlay = (): void => {
  if (!state.overlay) {
    return;
  }

  state.overlay.agentBox.style.display = 'none';
  state.overlay.agentLabel.style.display = 'none';
};

const hideOverlay = (): void => {
  if (!state.overlay) {
    return;
  }

  hidePickerOverlay();
  hideAgentOverlay();
  state.overlay.root.style.display = 'none';
};

const renderPickerOverlay = (overlay: OverlayElements): boolean => {
  if (!state.enabled || !(state.hoveredElement instanceof Element)) {
    hidePickerOverlay();
    return false;
  }

  overlay.pickerHint.textContent =
    state.pickerIntent === 'style'
      ? 'Click to inspect styles • Esc to cancel'
      : 'Click to add feedback • Esc to cancel';

  const rect = state.hoveredElement.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) {
    overlay.pickerHint.style.display = 'block';
    overlay.pickerBox.style.display = 'none';
    overlay.pickerLabel.style.display = 'none';
    return true;
  }

  const labelCopy = describeElement(state.hoveredElement);
  overlay.pickerBox.style.display = 'block';
  overlay.pickerLabel.style.display = 'block';
  overlay.pickerHint.style.display = 'block';
  overlay.pickerBox.style.left = `${rect.left}px`;
  overlay.pickerBox.style.top = `${rect.top}px`;
  overlay.pickerBox.style.width = `${rect.width}px`;
  overlay.pickerBox.style.height = `${rect.height}px`;

  const labelTitle = document.createElement('div');
  labelTitle.textContent = labelCopy.title;
  labelTitle.style.fontSize = '12px';
  labelTitle.style.fontWeight = '700';
  labelTitle.style.color = '#f8fbff';

  const labelMeta = document.createElement('div');
  labelMeta.textContent = labelCopy.meta;
  labelMeta.style.marginTop = '4px';
  labelMeta.style.fontSize = '11px';
  labelMeta.style.fontWeight = '500';
  labelMeta.style.color = 'rgba(226,233,244,0.88)';
  labelMeta.style.fontFamily = "'SF Mono','JetBrains Mono',ui-monospace,monospace";
  labelMeta.style.wordBreak = 'break-word';

  overlay.pickerLabel.replaceChildren(labelTitle, labelMeta);

  const preferredTop = Math.max(rect.top - 68, 8);
  const preferredLeft = Math.min(
    Math.max(rect.left, 8),
    Math.max(window.innerWidth - 372, 8),
  );
  overlay.pickerLabel.style.left = `${preferredLeft}px`;
  overlay.pickerLabel.style.top = `${preferredTop}px`;
  return true;
};

const resolveXPathElement = (xpath: string | null): Element | null => {
  if (!xpath) {
    return null;
  }

  try {
    const result = document.evaluate(
      xpath,
      document,
      null,
      XPathResult.FIRST_ORDERED_NODE_TYPE,
      null,
    );
    return result.singleNodeValue instanceof Element ? result.singleNodeValue : null;
  } catch {
    return null;
  }
};

const resolveAgentOverlayElement = (payload: PageAgentOverlayState): Element | null => {
  if (payload.sourceUrl && payload.sourceUrl !== window.location.href) {
    return null;
  }

  if (payload.selection.frame.url && payload.selection.frame.url !== window.location.href) {
    return null;
  }

  try {
    const selectorMatch = document.querySelector(payload.selection.selector);
    if (selectorMatch instanceof Element) {
      return selectorMatch;
    }
  } catch {
    // Ignore invalid selectors and continue to XPath fallback.
  }

  return resolveXPathElement(payload.selection.xpath);
};

const getAgentPhaseCopy = (
  phase: PageAgentOverlayState['phase'],
): {
  title: string;
  border: string;
  fill: string;
  labelBackground: string;
  labelColor: string;
  animation: string;
} => {
  switch (phase) {
    case 'acknowledged':
      return {
        title: 'Agent has the note',
        border: 'rgba(209, 153, 0, 0.96)',
        fill: 'rgba(255, 211, 110, 0.18)',
        labelBackground: 'rgba(254, 244, 214, 0.98)',
        labelColor: '#7a4c00',
        animation: 'none',
      };
    case 'done':
      return {
        title: 'Updated',
        border: 'rgba(41, 201, 110, 0.98)',
        fill: 'rgba(41, 201, 110, 0.16)',
        labelBackground: 'rgba(232, 255, 241, 0.98)',
        labelColor: '#0f6a36',
        animation: 'agent-browser-done-pulse 1.1s ease-out 1',
      };
    case 'in_progress':
    default:
      return {
        title: 'Updating...',
        border: 'rgba(10, 132, 255, 0.98)',
        fill: 'rgba(10, 132, 255, 0.14)',
        labelBackground: 'rgba(235, 245, 255, 0.98)',
        labelColor: '#0b5db8',
        animation: 'agent-browser-progress-pulse 1.3s ease-in-out infinite',
      };
  }
};

const renderAgentOverlay = (overlay: OverlayElements): boolean => {
  if (state.enabled || !state.agentOverlay) {
    hideAgentOverlay();
    return false;
  }

  const target = resolveAgentOverlayElement(state.agentOverlay);
  if (!(target instanceof Element)) {
    hideAgentOverlay();
    return false;
  }

  const rect = target.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) {
    hideAgentOverlay();
    return false;
  }

  const phaseCopy = getAgentPhaseCopy(state.agentOverlay.phase);
  overlay.agentBox.style.display = 'block';
  overlay.agentLabel.style.display = 'block';
  overlay.agentBox.style.left = `${rect.left}px`;
  overlay.agentBox.style.top = `${rect.top}px`;
  overlay.agentBox.style.width = `${rect.width}px`;
  overlay.agentBox.style.height = `${rect.height}px`;
  overlay.agentBox.style.borderColor = phaseCopy.border;
  overlay.agentBox.style.background = phaseCopy.fill;
  overlay.agentBox.style.boxShadow = `0 0 0 1px rgba(255,255,255,0.88) inset, 0 18px 30px ${phaseCopy.fill}`;
  overlay.agentBox.style.animation = phaseCopy.animation;

  const labelTitle = document.createElement('div');
  labelTitle.textContent = phaseCopy.title;
  labelTitle.style.fontSize = '11px';
  labelTitle.style.fontWeight = '800';
  labelTitle.style.letterSpacing = '0.03em';
  labelTitle.style.textTransform = 'uppercase';

  const labelBody = document.createElement('div');
  labelBody.textContent = state.agentOverlay.message;
  labelBody.style.marginTop = '2px';
  labelBody.style.fontSize = '12px';
  labelBody.style.fontWeight = '600';

  overlay.agentLabel.replaceChildren(labelTitle, labelBody);
  overlay.agentLabel.style.background = phaseCopy.labelBackground;
  overlay.agentLabel.style.color = phaseCopy.labelColor;

  const preferredTop =
    rect.top >= 56 ? rect.top - 48 : Math.min(rect.bottom + 12, window.innerHeight - 70);
  const preferredLeft = Math.min(
    Math.max(rect.left, 10),
    Math.max(window.innerWidth - 292, 10),
  );
  overlay.agentLabel.style.left = `${preferredLeft}px`;
  overlay.agentLabel.style.top = `${preferredTop}px`;
  return true;
};

const renderOverlay = (): void => {
  const overlay = ensureOverlay();
  const pickerVisible = renderPickerOverlay(overlay);
  const agentVisible = renderAgentOverlay(overlay);

  if (!pickerVisible && !agentVisible) {
    hideOverlay();
    return;
  }

  overlay.root.style.display = 'block';
};

const resolveHoveredElement = (clientX: number, clientY: number): Element | null => {
  const hovered = document.elementFromPoint(clientX, clientY);
  if (!(hovered instanceof Element)) {
    return null;
  }

  if (hovered.id === OVERLAY_ROOT_ID || hovered.closest(`#${OVERLAY_ROOT_ID}`)) {
    return null;
  }

  return hovered;
};

const scheduleHoverUpdate = (clientX: number, clientY: number): void => {
  state.lastPoint = { x: clientX, y: clientY };

  if (state.animationFrame !== null) {
    return;
  }

  state.animationFrame = window.requestAnimationFrame(() => {
    state.animationFrame = null;
    if (!state.lastPoint) {
      return;
    }

    state.hoveredElement = resolveHoveredElement(state.lastPoint.x, state.lastPoint.y);
    renderOverlay();
  });
};

const disablePicker = (notifyCancelled: boolean): void => {
  state.enabled = false;
  state.hoveredElement = null;
  state.lastPoint = null;
  if (state.animationFrame !== null) {
    window.cancelAnimationFrame(state.animationFrame);
    state.animationFrame = null;
  }

  renderOverlay();

  if (notifyCancelled) {
    ipcRenderer.send(PAGE_PICKER_EVENT_CHANNEL, { type: 'cancelled' });
  }
};

const enablePicker = (intent: PickerIntent): void => {
  state.enabled = true;
  state.pickerIntent = intent;
  state.hoveredElement = null;
  renderOverlay();
};

const clearAgentOverlayTimer = (): void => {
  if (state.agentClearTimer === null) {
    return;
  }

  window.clearTimeout(state.agentClearTimer);
  state.agentClearTimer = null;
};

const setAgentOverlay = (payload: PageAgentOverlayState | null): void => {
  clearAgentOverlayTimer();
  state.agentOverlay = payload;

  if (payload?.phase === 'done') {
    const remaining =
      AGENT_DONE_PULSE_MS - Math.max(Date.now() - new Date(payload.updatedAt).getTime(), 0);

    if (remaining <= 0) {
      state.agentOverlay = null;
    } else {
      state.agentClearTimer = window.setTimeout(() => {
        state.agentClearTimer = null;
        state.agentOverlay = null;
        renderOverlay();
      }, remaining);
    }
  }

  renderOverlay();
};

const publishLoginFormAvailability = (): void => {
  const nextValue = hasVisibleLoginForm(document);
  if (state.hasVisibleLoginForm === nextValue) {
    return;
  }

  state.hasVisibleLoginForm = nextValue;
  ipcRenderer.send(PAGE_LOGIN_EVENT_CHANNEL, {
    type: 'availability',
    hasVisibleLoginForm: nextValue,
  });
};

const scheduleLoginFormAvailabilityCheck = (): void => {
  if (state.loginFormAnimationFrame !== null) {
    return;
  }

  state.loginFormAnimationFrame = window.requestAnimationFrame(() => {
    state.loginFormAnimationFrame = null;
    publishLoginFormAvailability();
  });
};

const observeLoginForms = (): void => {
  if (state.loginFormObserver || !document.documentElement) {
    return;
  }

  state.loginFormObserver = new MutationObserver(() => {
    scheduleLoginFormAvailabilityCheck();
  });
  state.loginFormObserver.observe(document.documentElement, {
    subtree: true,
    childList: true,
    attributes: true,
    attributeFilter: [
      'aria-hidden',
      'autocomplete',
      'class',
      'disabled',
      'hidden',
      'id',
      'name',
      'placeholder',
      'readonly',
      'style',
      'type',
    ],
  });
};

window.addEventListener(
  'mousemove',
  (event) => {
    if (!state.enabled) {
      return;
    }

    scheduleHoverUpdate(event.clientX, event.clientY);
  },
  true,
);

window.addEventListener(
  'scroll',
  () => {
    renderOverlay();
  },
  true,
);

window.addEventListener(
  'resize',
  () => {
    renderOverlay();
  },
  true,
);

window.addEventListener(
  'keydown',
  (event) => {
    if (!state.enabled || event.key !== 'Escape') {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
    disablePicker(true);
  },
  true,
);

window.addEventListener(
  'click',
  (event) => {
    if (!state.enabled) {
      return;
    }

    const target = resolveHoveredElement(event.clientX, event.clientY) ?? state.hoveredElement;
    if (!(target instanceof Element)) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();

    ipcRenderer.send(PAGE_PICKER_EVENT_CHANNEL, {
      type: 'selection',
      intent: state.pickerIntent,
      descriptor: createElementDescriptor(target),
    });

    disablePicker(false);
  },
  true,
);

window.addEventListener('DOMContentLoaded', () => {
  observeLoginForms();
  scheduleLoginFormAvailabilityCheck();
});

window.addEventListener('load', () => {
  scheduleLoginFormAvailabilityCheck();
});

window.addEventListener(
  'pageshow',
  () => {
    scheduleLoginFormAvailabilityCheck();
  },
  true,
);

window.addEventListener('beforeunload', () => {
  if (state.loginFormAnimationFrame !== null) {
    window.cancelAnimationFrame(state.loginFormAnimationFrame);
    state.loginFormAnimationFrame = null;
  }

  state.loginFormObserver?.disconnect();
  state.loginFormObserver = null;
  styleController.dispose();
});

ipcRenderer.on(PAGE_PICKER_CONTROL_CHANNEL, (_event, payload: unknown) => {
  if (!isPagePickerControl(payload)) {
    return;
  }

  if (payload.action === 'enable') {
    enablePicker(payload.intent);
    return;
  }

  disablePicker(false);
});

ipcRenderer.on(PAGE_STYLE_CONTROL_CHANNEL, (_event, payload: unknown) => {
  if (!isPageStyleControl(payload)) {
    return;
  }

  styleController.handleCommand(payload);
});

ipcRenderer.on(PAGE_LOGIN_CONTROL_CHANNEL, (_event, payload: unknown) => {
  if (!isPageLoginControl(payload) || payload.action !== 'fill') {
    return;
  }

  fillAgentLogin(document, {
    username: payload.username,
    password: payload.password,
  });
  scheduleLoginFormAvailabilityCheck();
});

ipcRenderer.on(PAGE_AGENT_OVERLAY_CHANNEL, (_event, payload: unknown) => {
  if (payload === null) {
    setAgentOverlay(null);
    return;
  }

  if (!isPageAgentOverlayState(payload)) {
    return;
  }

  setAgentOverlay(payload);
});

observeLoginForms();
scheduleLoginFormAvailabilityCheck();
