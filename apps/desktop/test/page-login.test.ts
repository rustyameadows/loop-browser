import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { parseHTML } from 'linkedom';
import {
  fillAgentLogin,
  findVisibleLoginFields,
  hasVisibleLoginForm,
} from '../src/preload/page-login';

type GlobalSnapshot = {
  window: typeof globalThis.window | undefined;
  document: typeof globalThis.document | undefined;
  HTMLElement: typeof globalThis.HTMLElement | undefined;
  HTMLInputElement: typeof globalThis.HTMLInputElement | undefined;
  HTMLTextAreaElement: typeof globalThis.HTMLTextAreaElement | undefined;
  Event: typeof globalThis.Event | undefined;
};

let globals: GlobalSnapshot;

beforeEach(() => {
  globals = {
    window: globalThis.window,
    document: globalThis.document,
    HTMLElement: globalThis.HTMLElement,
    HTMLInputElement: globalThis.HTMLInputElement,
    HTMLTextAreaElement: globalThis.HTMLTextAreaElement,
    Event: globalThis.Event,
  };

  const { window, document } = parseHTML('<html><body></body></html>');
  window.getComputedStyle = ((element: Element) => ({
    display: (element as HTMLElement).style.display || 'block',
    visibility: (element as HTMLElement).style.visibility || 'visible',
  })) as typeof window.getComputedStyle;
  Object.defineProperty(window.HTMLElement.prototype, 'focus', {
    configurable: true,
    value() {
      return undefined;
    },
  });
  Object.defineProperty(window.HTMLElement.prototype, 'getBoundingClientRect', {
    configurable: true,
    value() {
      return {
        x: 0,
        y: 0,
        top: 0,
        left: 0,
        right: 240,
        bottom: 48,
        width: 240,
        height: 48,
        toJSON() {
          return this;
        },
      };
    },
  });

  Object.assign(globalThis, {
    window,
    document,
    HTMLElement: window.HTMLElement,
    HTMLInputElement: window.HTMLInputElement,
    HTMLTextAreaElement: window.HTMLTextAreaElement,
    Event: window.Event,
  });
});

afterEach(() => {
  Object.assign(globalThis, {
    window: globals.window,
    document: globals.document,
    HTMLElement: globals.HTMLElement,
    HTMLInputElement: globals.HTMLInputElement,
    HTMLTextAreaElement: globals.HTMLTextAreaElement,
    Event: globals.Event,
  });
});

describe('page login helpers', () => {
  it('detects a visible login form and prefers the email field in the same form', () => {
    document.body.innerHTML = `
      <form id="login">
        <input id="email" type="email" />
        <input id="password" type="password" />
      </form>
      <form id="other">
        <input id="other-text" type="text" />
      </form>
    `;

    const match = findVisibleLoginFields(document);

    expect(hasVisibleLoginForm(document)).toBe(true);
    expect(match?.usernameField?.id).toBe('email');
    expect(match?.passwordField.id).toBe('password');
  });

  it('fills the detected login fields and dispatches input/change events', () => {
    document.body.innerHTML = `
      <form>
        <input id="username" autocomplete="username" />
        <input id="password" type="password" />
      </form>
    `;

    const usernameField = document.getElementById('username') as HTMLInputElement;
    const passwordField = document.getElementById('password') as HTMLInputElement;
    const usernameInputSpy = vi.fn();
    const usernameChangeSpy = vi.fn();
    const passwordInputSpy = vi.fn();
    const passwordChangeSpy = vi.fn();

    usernameField.addEventListener('input', usernameInputSpy);
    usernameField.addEventListener('change', usernameChangeSpy);
    passwordField.addEventListener('input', passwordInputSpy);
    passwordField.addEventListener('change', passwordChangeSpy);

    expect(
      fillAgentLogin(document, {
        username: 'agent@example.com',
        password: 'password123',
      }),
    ).toBe(true);

    expect(usernameField.value).toBe('agent@example.com');
    expect(passwordField.value).toBe('password123');
    expect(usernameInputSpy).toHaveBeenCalledTimes(1);
    expect(usernameChangeSpy).toHaveBeenCalledTimes(1);
    expect(passwordInputSpy).toHaveBeenCalledTimes(1);
    expect(passwordChangeSpy).toHaveBeenCalledTimes(1);
  });

  it('returns false when there is no visible password field', () => {
    document.body.innerHTML = '<input id="email" type="email" />';

    expect(
      fillAgentLogin(document, {
        username: 'agent@example.com',
        password: 'password123',
      }),
    ).toBe(false);
  });
});
