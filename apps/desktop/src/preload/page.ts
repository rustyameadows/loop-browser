import { ipcRenderer } from 'electron';
import {
  PAGE_PICKER_CONTROL_CHANNEL,
  PAGE_PICKER_EVENT_CHANNEL,
  isPagePickerControl,
} from '@agent-browser/protocol';
import {
  createAccessibleName,
  createElementDescriptor,
  createPlaywrightLocator,
  createStableSelector,
  inferRole,
} from '@agent-browser/selector';

const OVERLAY_ROOT_ID = '__agent_browser_picker_overlay__';

type OverlayElements = {
  root: HTMLDivElement;
  box: HTMLDivElement;
  label: HTMLDivElement;
  hint: HTMLDivElement;
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

  const hint = document.createElement('div');
  hint.textContent = 'Click to add feedback • Esc to cancel';
  hint.setAttribute(
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

  root.append(box, label, hint);
  document.documentElement.append(root);
  state.overlay = { root, box, label, hint };
  return state.overlay;
};

const hideOverlay = (): void => {
  if (!state.overlay) {
    return;
  }

  state.overlay.root.style.display = 'none';
  state.overlay.box.style.display = 'none';
  state.overlay.label.style.display = 'none';
  state.overlay.hint.style.display = 'none';
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
    overlay.hint.style.display = 'block';
    return;
  }

  const labelCopy = describeElement(state.hoveredElement);
  overlay.root.style.display = 'block';
  overlay.box.style.display = 'block';
  overlay.label.style.display = 'block';
  overlay.hint.style.display = 'block';
  overlay.box.style.left = `${rect.left}px`;
  overlay.box.style.top = `${rect.top}px`;
  overlay.box.style.width = `${rect.width}px`;
  overlay.box.style.height = `${rect.height}px`;
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

  overlay.label.replaceChildren(labelTitle, labelMeta);

  const preferredTop = Math.max(rect.top - 68, 8);
  const preferredLeft = Math.min(
    Math.max(rect.left, 8),
    Math.max(window.innerWidth - 372, 8),
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
