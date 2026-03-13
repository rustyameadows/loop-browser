import type { NavigationBridge } from '@agent-browser/protocol';

declare global {
  interface Window {
    agentBrowser: NavigationBridge;
  }
}

export {};

