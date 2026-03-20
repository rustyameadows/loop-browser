const USERNAME_FIELD_SELECTORS = [
  'input[autocomplete="username"]',
  'input[autocomplete="email"]',
  'input[type="email"]',
  'input[name*="email" i]',
  'input[id*="email" i]',
  'input[placeholder*="email" i]',
  'input[name*="user" i]',
  'input[id*="user" i]',
  'input[placeholder*="user" i]',
  'input[name*="login" i]',
  'input[id*="login" i]',
  'input[placeholder*="login" i]',
  'input[type="text"]',
  'textarea',
].join(',');

const isVisibleElement = (element: Element): boolean => {
  const htmlElement = element as HTMLElement;
  if (htmlElement.hidden) {
    return false;
  }

  const style = window.getComputedStyle(htmlElement);
  if (style.display === 'none' || style.visibility === 'hidden') {
    return false;
  }

  const rect = htmlElement.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0;
};

const isEditableField = (
  element: HTMLInputElement | HTMLTextAreaElement,
): boolean => !element.disabled && !element.readOnly;

const isVisiblePasswordField = (element: HTMLInputElement): boolean =>
  element.type === 'password' && isEditableField(element) && isVisibleElement(element);

const isVisibleUsernameField = (
  element: HTMLInputElement | HTMLTextAreaElement,
): boolean => {
  if (!isEditableField(element) || !isVisibleElement(element)) {
    return false;
  }

  return !(element instanceof HTMLInputElement && element.type === 'hidden');
};

const findVisibleUsernameField = (
  root: ParentNode,
): HTMLInputElement | HTMLTextAreaElement | null => {
  const matches = Array.from(
    root.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>(USERNAME_FIELD_SELECTORS),
  );

  for (const match of matches) {
    if (isVisibleUsernameField(match)) {
      return match;
    }
  }

  return null;
};

export type AgentLoginFieldMatch = {
  usernameField: HTMLInputElement | HTMLTextAreaElement | null;
  passwordField: HTMLInputElement;
};

export const findVisibleLoginFields = (
  root: Document = document,
): AgentLoginFieldMatch | null => {
  const passwordFields = Array.from(root.querySelectorAll<HTMLInputElement>('input[type="password"]'));
  const passwordField = passwordFields.find(isVisiblePasswordField);
  if (!passwordField) {
    return null;
  }

  const formRoot = passwordField.form ?? root;
  const usernameField =
    findVisibleUsernameField(formRoot) ??
    findVisibleUsernameField(root);

  return {
    usernameField,
    passwordField,
  };
};

export const hasVisibleLoginForm = (root: Document = document): boolean =>
  findVisibleLoginFields(root) !== null;

const setFieldValue = (
  field: HTMLInputElement | HTMLTextAreaElement,
  value: string,
): void => {
  const prototype =
    field instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set;
  if (setter) {
    setter.call(field, value);
  } else {
    field.value = value;
  }

  field.dispatchEvent(new Event('input', { bubbles: true }));
  field.dispatchEvent(new Event('change', { bubbles: true }));
};

export const fillAgentLogin = (
  root: Document,
  credentials: { username: string; password: string },
): boolean => {
  const match = findVisibleLoginFields(root);
  if (!match) {
    return false;
  }

  if (match.usernameField) {
    match.usernameField.focus();
    setFieldValue(match.usernameField, credentials.username);
  }

  match.passwordField.focus();
  setFieldValue(match.passwordField, credentials.password);
  return true;
};
