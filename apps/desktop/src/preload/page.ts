import { ipcRenderer } from 'electron';
import {
  PAGE_PICKER_CONTROL_CHANNEL,
  PAGE_PICKER_EVENT_CHANNEL,
  isPagePickerControl,
} from '@agent-browser/protocol';
import { createElementDescriptor } from '@agent-browser/selector';

const OVERLAY_ROOT_ID = '__agent_browser_picker_overlay__';

type OverlayElements = {
  root: HTMLDivElement;
  box: HTMLDivElement;
  label: HTMLDivElement;
};

const state: {
  enabled: boolean;
  hoveredElement: Element | null;
  overlay: OverlayElements | null;
  lastPoint: { x: number; y: number } | null;
  animationFrame: number | null;
} = {
  enabled: false,
  hoveredElement: null,
  overlay: null,
  lastPoint: null,
  animationFrame: null,
};

const describeElement = (element: Element): string => {
  const parts = [element.localName];

  if (element.id) {
    parts.push(`#${element.id}`);
  }

  const className = Array.from(element.classList).slice(0, 2).join('.');
  if (className) {
    parts.push(`.${className}`);
  }

  return parts.join('');
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

  const box = document.createElement('div');
  box.setAttribute(
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

  const label = document.createElement('div');
  label.setAttribute(
    'style',
    [
      'position:fixed',
      'max-width:min(360px, calc(100vw - 24px))',
      'padding:6px 10px',
      'border-radius:999px',
      'background:rgba(11,22,39,0.96)',
      'color:#f6f8fc',
      'font-size:12px',
      'font-weight:600',
      'letter-spacing:0.01em',
      'display:none',
      'white-space:nowrap',
      'overflow:hidden',
      'text-overflow:ellipsis',
    ].join(';'),
  );

  root.append(box, label);
  document.documentElement.append(root);
  state.overlay = { root, box, label };
  return state.overlay;
};

const hideOverlay = (): void => {
  if (!state.overlay) {
    return;
  }

  state.overlay.root.style.display = 'none';
  state.overlay.box.style.display = 'none';
  state.overlay.label.style.display = 'none';
};

const renderOverlay = (): void => {
  const overlay = ensureOverlay();

  if (!state.enabled || !(state.hoveredElement instanceof Element)) {
    hideOverlay();
    return;
  }

  const rect = state.hoveredElement.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) {
    overlay.root.style.display = 'block';
    overlay.box.style.display = 'none';
    overlay.label.style.display = 'none';
    return;
  }

  const labelText = describeElement(state.hoveredElement);
  overlay.root.style.display = 'block';
  overlay.box.style.display = 'block';
  overlay.label.style.display = 'block';
  overlay.box.style.left = `${rect.left}px`;
  overlay.box.style.top = `${rect.top}px`;
  overlay.box.style.width = `${rect.width}px`;
  overlay.box.style.height = `${rect.height}px`;
  overlay.label.textContent = labelText;

  const preferredTop = Math.max(rect.top - 36, 8);
  const preferredLeft = Math.min(
    Math.max(rect.left, 8),
    Math.max(window.innerWidth - 280, 8),
  );
  overlay.label.style.left = `${preferredLeft}px`;
  overlay.label.style.top = `${preferredTop}px`;
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

  hideOverlay();

  if (notifyCancelled) {
    ipcRenderer.send(PAGE_PICKER_EVENT_CHANNEL, { type: 'cancelled' });
  }
};

const enablePicker = (): void => {
  state.enabled = true;
  state.hoveredElement = null;
  ensureOverlay().root.style.display = 'block';
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
    if (!state.enabled) {
      return;
    }

    renderOverlay();
  },
  true,
);

window.addEventListener(
  'resize',
  () => {
    if (!state.enabled) {
      return;
    }

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
      descriptor: createElementDescriptor(target),
    });

    disablePicker(false);
  },
  true,
);

ipcRenderer.on(PAGE_PICKER_CONTROL_CHANNEL, (_event, payload: unknown) => {
  if (!isPagePickerControl(payload)) {
    return;
  }

  if (payload.action === 'enable') {
    enablePicker();
    return;
  }

  disablePicker(false);
});
