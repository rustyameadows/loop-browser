import { useEffect, useRef, useState, type CSSProperties, type FormEvent, type JSX, type MouseEvent, type SVGProps } from 'react';
import {
  DEFAULT_CHROME_COLOR,
  createEmptyChromeAppearanceState,
  createEmptyFeedbackState,
  createEmptyMcpViewState,
  createEmptyMarkdownViewState,
  createEmptyNavigationState,
  createEmptyPickerState,
  createEmptySessionViewState,
  type ChromeAppearanceCommand,
  type ChromeAppearanceState,
  type ElementDescriptor,
  type FeedbackAnnotation,
  type FeedbackCommand,
  type FeedbackKind,
  type FeedbackPriority,
  type FeedbackState,
  type McpViewCommand,
  type McpViewState,
  type MarkdownViewCommand,
  type MarkdownViewState,
  type NavigationCommand,
  type NavigationState,
  type PickerCommand,
  type PickerState,
  type SessionCommand,
  type SessionSummary,
  type SessionViewState,
} from '@agent-browser/protocol';
import {
  getChromeAppearanceCssVariables,
  getChromeAppearanceThemeTokens,
  projectIconSrc,
} from './chrome-appearance-theme';
import {
  getDockIconArtMaskRadius,
  getDockIconLayoutMetrics,
  resolveDefaultDockIconColor,
} from '../../shared/dock-icon-style';
import {
  getColorPickerValue,
  getHexColorDraftError,
  normalizeHexColorDraft,
  resolveDraftProjectIconPath,
} from './project-style-form';

const emptyState = createEmptyNavigationState();
const emptyChromeAppearanceState = createEmptyChromeAppearanceState();
const emptyPickerState = createEmptyPickerState();
const emptyFeedbackState = createEmptyFeedbackState();
const emptyMarkdownState = createEmptyMarkdownViewState();
const emptyMcpState = createEmptyMcpViewState();
const emptySessionState = createEmptySessionViewState();
const stubTabs = ['Agent Chat', 'Inspector'];
const AGENT_DONE_PULSE_MS = 1600;

type SurfaceMode = 'chrome' | 'launcher' | 'markdown' | 'mcp' | 'feedback' | 'project';

type IconName =
  | 'arrowUpRight'
  | 'book'
  | 'chevronLeft'
  | 'chevronRight'
  | 'close'
  | 'crosshair'
  | 'file'
  | 'globe'
  | 'plus'
  | 'reload'
  | 'search'
  | 'sliders'
  | 'sparkles';

const getSurfaceMode = (): SurfaceMode => {
  const params = new URLSearchParams(window.location.search);
  if (params.get('surface') === 'markdown') {
    return 'markdown';
  }

  if (params.get('surface') === 'mcp') {
    return 'mcp';
  }

  if (params.get('surface') === 'feedback') {
    return 'feedback';
  }

  if (params.get('surface') === 'project') {
    return 'project';
  }

  if (params.get('surface') === 'launcher') {
    return 'launcher';
  }

  return 'chrome';
};

const getActiveTabLabel = (state: NavigationState): string => {
  if (state.title && state.title !== 'Loop Browser') {
    return state.title;
  }

  if (!state.url) {
    return 'Start Page';
  }

  try {
    const parsed = new URL(state.url);
    return parsed.protocol === 'file:' ? 'Start Page' : parsed.hostname.replace(/^www\./, '');
  } catch {
    return state.url;
  }
};

const getQuietStatus = (state: NavigationState): string => {
  if (!state.url) {
    return 'Single-tab preview | ready';
  }

  try {
    const parsed = new URL(state.url);
    const destination =
      parsed.protocol === 'file:' ? 'local fixture' : parsed.hostname.replace(/^www\./, '');
    return `Single-tab preview | ${destination}`;
  } catch {
    return 'Single-tab preview';
  }
};

const getLocationIcon = (url: string): IconName => (url.startsWith('file:') ? 'file' : 'globe');

const getSelectionHeading = (selection: ElementDescriptor): string => {
  const name = selection.accessibleName || selection.textSnippet;
  if (name) {
    return `${selection.role || selection.tag} "${name}"`;
  }

  const parts = [selection.tag];
  if (selection.id) {
    parts.push(`#${selection.id}`);
  }

  if (selection.classList.length > 0) {
    parts.push(`.${selection.classList.slice(0, 2).join('.')}`);
  }

  return parts.join('');
};

const getSelectionMeta = (selection: ElementDescriptor): string => {
  const summaryParts = [selection.playwrightLocator || selection.selector];
  if (selection.textSnippet && selection.textSnippet !== selection.accessibleName) {
    summaryParts.push(selection.textSnippet);
  }

  return summaryParts.join(' | ');
};

const getFeedbackStatusLabel = (status: FeedbackAnnotation['status']): string => {
  switch (status) {
    case 'acknowledged':
      return 'Acknowledged';
    case 'in_progress':
      return 'In Progress';
    case 'resolved':
      return 'Resolved';
    case 'dismissed':
      return 'Dismissed';
    case 'open':
    default:
      return 'Open';
  }
};

const getFeedbackStatusTone = (
  status: FeedbackAnnotation['status'],
): 'neutral' | 'blue' | 'green' | 'red' | 'gold' => {
  switch (status) {
    case 'acknowledged':
      return 'gold';
    case 'in_progress':
      return 'blue';
    case 'resolved':
      return 'green';
    case 'dismissed':
      return 'red';
    case 'open':
    default:
      return 'neutral';
  }
};

const getFeedbackKindLabel = (kind: FeedbackKind): string => {
  switch (kind) {
    case 'change':
      return 'Change';
    case 'question':
      return 'Question';
    case 'praise':
      return 'Praise';
    case 'bug':
    default:
      return 'Bug';
  }
};

const getFeedbackPriorityLabel = (priority: FeedbackPriority): string => {
  switch (priority) {
    case 'critical':
      return 'Critical';
    case 'high':
      return 'High';
    case 'low':
      return 'Low';
    case 'medium':
    default:
      return 'Medium';
  }
};

const getMarkdownSourceLabel = (state: MarkdownViewState): string => {
  if (state.site) {
    return state.site;
  }

  if (!state.sourceUrl) {
    return 'Current page';
  }

  try {
    return new URL(state.sourceUrl).hostname.replace(/^www\./, '');
  } catch {
    return state.sourceUrl;
  }
};

const getMarkdownStatusText = (state: MarkdownViewState): string => {
  switch (state.status) {
    case 'loading':
      return 'Generating Markdown from the current page...';
    case 'ready':
      return state.wordCount
        ? `${state.wordCount.toLocaleString()} words extracted`
        : 'Markdown ready';
    case 'error':
      return state.lastError ?? 'Markdown generation failed.';
    case 'idle':
    default:
      return 'Open this panel from the main chrome to convert the current page.';
  }
};

const formatTimestamp = (value: string | null): string => {
  if (!value) {
    return 'Never';
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }

  return parsed.toLocaleString([], {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    second: '2-digit',
  });
};

const getMcpSelfTestLabel = (state: McpViewState): string => {
  switch (state.lastSelfTest.status) {
    case 'running':
      return 'Running MCP self-test...';
    case 'passed':
      return `Verified ${formatTimestamp(state.lastSelfTest.checkedAt)}`;
    case 'failed':
      return state.lastSelfTest.summary;
    case 'idle':
    default:
      return 'Waiting for first verification.';
  }
};

const getDockIconStatusLabel = (state: ChromeAppearanceState): string => {
  if (state.dockIconStatus === 'failed') {
    return state.dockIconSource === 'projectIcon'
      ? 'Failed to apply project Dock icon'
      : 'Failed to apply chrome-color Dock icon';
  }

  if (state.dockIconStatus === 'applied') {
    return state.dockIconSource === 'projectIcon'
      ? 'Applied project Dock icon'
      : 'Applied chrome-color Dock icon';
  }

  return 'Dock icon not applied yet';
};

const getReadableForeground = (hexColor: string): string => {
  const red = Number.parseInt(hexColor.slice(1, 3), 16);
  const green = Number.parseInt(hexColor.slice(3, 5), 16);
  const blue = Number.parseInt(hexColor.slice(5, 7), 16);
  const perceivedLuminance = (red * 299 + green * 587 + blue * 114) / 1000;
  return perceivedLuminance >= 150 ? '#0F172A' : '#FFFFFF';
};

const getSessionBadgeLabel = (session: SessionSummary): string => {
  const letters = session.projectName
    .split(/[\s_-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('');

  return letters || 'LB';
};

const getSessionChipMeta = (session: SessionSummary): string => {
  if (session.status === 'launching') {
    return 'Launching';
  }

  if (session.status === 'closing') {
    return 'Closing';
  }

  if (session.status === 'error') {
    return 'Error';
  }

  if (session.isFocused) {
    return 'Focused';
  }

  return session.dockIconStatus === 'failed' ? 'Dock icon issue' : 'Ready';
};

const getMcpAuthLabel = (state: McpViewState): string => {
  if (!state.hasAuthToken) {
    return `${state.authType} missing`;
  }

  return state.authTokenPreview
    ? `${state.authType} configured | ${state.authTokenPreview}`
    : `${state.authType} configured`;
};

const getMcpIndicatorLabel = (state: McpViewState): string => {
  switch (state.indicator) {
    case 'green':
      return 'Verified';
    case 'red':
      return 'Error';
    case 'yellow':
    default:
      return 'Checking';
  }
};

const getAgentActivityFallback = (
  phase: NonNullable<McpViewState['agentActivity']>['phase'],
): string => {
  switch (phase) {
    case 'acknowledged':
      return 'Agent received this note.';
    case 'done':
      return 'Agent marked this complete.';
    case 'in_progress':
    default:
      return 'Agent is working on this.';
  }
};

const getMcpPresenceMessage = (state: McpViewState): string | null => {
  if (state.agentActivity) {
    return state.agentActivity.message || getAgentActivityFallback(state.agentActivity.phase);
  }

  if (state.activeToolCalls > 0 || state.busySince) {
    return 'Agent working via MCP.';
  }

  return null;
};

const ChromeIcon = ({
  name,
  ...props
}: SVGProps<SVGSVGElement> & { name: IconName }): JSX.Element => {
  switch (name) {
    case 'chevronLeft':
      return (
        <svg fill="none" viewBox="0 0 20 20" {...props}>
          <path
            d="M11.75 4.75 6.5 10l5.25 5.25"
            stroke="currentColor"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth="1.8"
          />
        </svg>
      );
    case 'chevronRight':
      return (
        <svg fill="none" viewBox="0 0 20 20" {...props}>
          <path
            d="M8.25 4.75 13.5 10l-5.25 5.25"
            stroke="currentColor"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth="1.8"
          />
        </svg>
      );
    case 'reload':
      return (
        <svg fill="none" viewBox="0 0 20 20" {...props}>
          <path
            d="M14.25 7.25A4.75 4.75 0 1 0 15 12m-.75-4.75V4.5m0 2.75H11.5"
            stroke="currentColor"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth="1.7"
          />
        </svg>
      );
    case 'plus':
      return (
        <svg fill="none" viewBox="0 0 20 20" {...props}>
          <path
            d="M10 4.5v11m-5.5-5.5h11"
            stroke="currentColor"
            strokeLinecap="round"
            strokeWidth="1.8"
          />
        </svg>
      );
    case 'search':
      return (
        <svg fill="none" viewBox="0 0 20 20" {...props}>
          <circle cx="8.75" cy="8.75" r="4.75" stroke="currentColor" strokeWidth="1.7" />
          <path d="m12.5 12.5 3 3" stroke="currentColor" strokeLinecap="round" strokeWidth="1.7" />
        </svg>
      );
    case 'sparkles':
      return (
        <svg fill="none" viewBox="0 0 20 20" {...props}>
          <path
            d="m10 3 1.3 3.7L15 8l-3.7 1.3L10 13l-1.3-3.7L5 8l3.7-1.3L10 3Zm5 9.5.6 1.7 1.7.6-1.7.6-.6 1.7-.6-1.7-1.7-.6 1.7-.6.6-1.7ZM4.5 11l.8 2.1 2.2.8-2.2.8-.8 2.1-.8-2.1-2.1-.8 2.1-.8.8-2.1Z"
            fill="currentColor"
          />
        </svg>
      );
    case 'sliders':
      return (
        <svg fill="none" viewBox="0 0 20 20" {...props}>
          <path
            d="M4 5.5h12M4 10h12M4 14.5h12"
            stroke="currentColor"
            strokeLinecap="round"
            strokeWidth="1.6"
          />
          <circle cx="7" cy="5.5" fill="currentColor" r="1.4" />
          <circle cx="12.5" cy="10" fill="currentColor" r="1.4" />
          <circle cx="9.5" cy="14.5" fill="currentColor" r="1.4" />
        </svg>
      );
    case 'file':
      return (
        <svg fill="none" viewBox="0 0 20 20" {...props}>
          <path
            d="M6.25 3.5h5.5l3 3v10H6.25a1.25 1.25 0 0 1-1.25-1.25v-10A1.25 1.25 0 0 1 6.25 3.5Z"
            stroke="currentColor"
            strokeLinejoin="round"
            strokeWidth="1.6"
          />
          <path
            d="M11.75 3.5v3h3"
            stroke="currentColor"
            strokeLinejoin="round"
            strokeWidth="1.6"
          />
        </svg>
      );
    case 'book':
      return (
        <svg fill="none" viewBox="0 0 20 20" {...props}>
          <path
            d="M5.25 4.25h8A1.75 1.75 0 0 1 15 6v8.75H7A1.75 1.75 0 0 0 5.25 16.5V4.25Zm0 0A1.75 1.75 0 0 0 3.5 6v8.5m3.5.25h8"
            stroke="currentColor"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth="1.55"
          />
        </svg>
      );
    case 'arrowUpRight':
      return (
        <svg fill="none" viewBox="0 0 20 20" {...props}>
          <path
            d="M6.5 13.5 13.5 6.5m-5 .5h5v5"
            stroke="currentColor"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth="1.8"
          />
        </svg>
      );
    case 'crosshair':
      return (
        <svg fill="none" viewBox="0 0 20 20" {...props}>
          <circle cx="10" cy="10" r="4.2" stroke="currentColor" strokeWidth="1.6" />
          <path
            d="M10 2.75v2.4m0 9.7v2.4M2.75 10h2.4m9.7 0h2.4"
            stroke="currentColor"
            strokeLinecap="round"
            strokeWidth="1.6"
          />
        </svg>
      );
    case 'close':
      return (
        <svg fill="none" viewBox="0 0 20 20" {...props}>
          <path
            d="m5.5 5.5 9 9m0-9-9 9"
            stroke="currentColor"
            strokeLinecap="round"
            strokeWidth="1.8"
          />
        </svg>
      );
    case 'globe':
      return (
        <svg fill="none" viewBox="0 0 20 20" {...props}>
          <circle cx="10" cy="10" r="6.25" stroke="currentColor" strokeWidth="1.6" />
          <path
            d="M4.5 10h11M10 3.75c1.8 1.75 2.7 3.83 2.7 6.25S11.8 14.5 10 16.25M10 3.75c-1.8 1.75-2.7 3.83-2.7 6.25S8.2 14.5 10 16.25"
            stroke="currentColor"
            strokeLinecap="round"
            strokeWidth="1.4"
          />
        </svg>
      );
  }
};

const useNavigationState = (): NavigationState => {
  const [navigationState, setNavigationState] = useState<NavigationState>(emptyState);

  useEffect(() => {
    let isMounted = true;

    const syncInitialState = async (): Promise<void> => {
      const initialState = await window.agentBrowser.getState();
      if (!isMounted) {
        return;
      }

      setNavigationState(initialState);
    };

    void syncInitialState();

    const unsubscribe = window.agentBrowser.subscribe((nextState) => {
      if (!isMounted) {
        return;
      }

      setNavigationState(nextState);
    });

    return () => {
      isMounted = false;
      unsubscribe();
    };
  }, []);

  return navigationState;
};

const usePickerState = (): PickerState => {
  const [pickerState, setPickerState] = useState<PickerState>(emptyPickerState);

  useEffect(() => {
    let isMounted = true;

    const syncInitialPickerState = async (): Promise<void> => {
      const initialState = await window.agentBrowser.getPickerState();
      if (!isMounted) {
        return;
      }

      setPickerState(initialState);
    };

    void syncInitialPickerState();

    const unsubscribe = window.agentBrowser.subscribePicker((nextState) => {
      if (!isMounted) {
        return;
      }

      setPickerState(nextState);
    });

    return () => {
      isMounted = false;
      unsubscribe();
    };
  }, []);

  return pickerState;
};

const useFeedbackState = (): FeedbackState => {
  const [feedbackState, setFeedbackState] = useState<FeedbackState>(emptyFeedbackState);

  useEffect(() => {
    let isMounted = true;

    const syncInitialFeedbackState = async (): Promise<void> => {
      const initialState = await window.agentBrowser.getFeedbackState();
      if (!isMounted) {
        return;
      }

      setFeedbackState(initialState);
    };

    void syncInitialFeedbackState();

    const unsubscribe = window.agentBrowser.subscribeFeedback((nextState) => {
      if (!isMounted) {
        return;
      }

      setFeedbackState(nextState);
    });

    return () => {
      isMounted = false;
      unsubscribe();
    };
  }, []);

  return feedbackState;
};

const useMarkdownViewState = (): MarkdownViewState => {
  const [markdownViewState, setMarkdownViewState] = useState<MarkdownViewState>(emptyMarkdownState);

  useEffect(() => {
    let isMounted = true;

    const syncInitialMarkdownState = async (): Promise<void> => {
      const initialState = await window.agentBrowser.getMarkdownViewState();
      if (!isMounted) {
        return;
      }

      setMarkdownViewState(initialState);
    };

    void syncInitialMarkdownState();

    const unsubscribe = window.agentBrowser.subscribeMarkdownView((nextState) => {
      if (!isMounted) {
        return;
      }

      setMarkdownViewState(nextState);
    });

    return () => {
      isMounted = false;
      unsubscribe();
    };
  }, []);

  return markdownViewState;
};

const useMcpViewState = (): McpViewState => {
  const [mcpViewState, setMcpViewState] = useState<McpViewState>(emptyMcpState);

  useEffect(() => {
    let isMounted = true;

    const syncInitialMcpState = async (): Promise<void> => {
      const initialState = await window.agentBrowser.getMcpViewState();
      if (!isMounted) {
        return;
      }

      setMcpViewState(initialState);
    };

    void syncInitialMcpState();

    const unsubscribe = window.agentBrowser.subscribeMcpView((nextState) => {
      if (!isMounted) {
        return;
      }

      setMcpViewState(nextState);
    });

    return () => {
      isMounted = false;
      unsubscribe();
    };
  }, []);

  return mcpViewState;
};

const useChromeAppearanceState = (): ChromeAppearanceState => {
  const [chromeAppearanceState, setChromeAppearanceState] =
    useState<ChromeAppearanceState>(emptyChromeAppearanceState);

  useEffect(() => {
    let isMounted = true;

    const syncInitialChromeAppearanceState = async (): Promise<void> => {
      const initialState = await window.agentBrowser.getChromeAppearanceState();
      if (!isMounted) {
        return;
      }

      setChromeAppearanceState(initialState);
    };

    void syncInitialChromeAppearanceState();

    const unsubscribe = window.agentBrowser.subscribeChromeAppearance((nextState) => {
      if (!isMounted) {
        return;
      }

      setChromeAppearanceState(nextState);
    });

    return () => {
      isMounted = false;
      unsubscribe();
    };
  }, []);

  return chromeAppearanceState;
};

const useSessionState = (): SessionViewState => {
  const [sessionState, setSessionState] = useState<SessionViewState>(emptySessionState);

  useEffect(() => {
    let isMounted = true;

    const syncInitialSessionState = async (): Promise<void> => {
      const initialState = await window.agentBrowser.getSessionState();
      if (!isMounted) {
        return;
      }

      setSessionState(initialState);
    };

    void syncInitialSessionState();

    const unsubscribe = window.agentBrowser.subscribeSessions((nextState) => {
      if (!isMounted) {
        return;
      }

      setSessionState(nextState);
    });

    return () => {
      isMounted = false;
      unsubscribe();
    };
  }, []);

  return sessionState;
};

const useMcpPresence = (
  mcpViewState: McpViewState,
): {
  isBusy: boolean;
  isDonePulse: boolean;
  message: string | null;
} => {
  const [isDonePulse, setIsDonePulse] = useState(false);

  useEffect(() => {
    if (!mcpViewState.agentActivity || mcpViewState.agentActivity.phase !== 'done') {
      setIsDonePulse(false);
      return;
    }

    const elapsed = Math.max(
      Date.now() - new Date(mcpViewState.agentActivity.updatedAt).getTime(),
      0,
    );
    if (elapsed >= AGENT_DONE_PULSE_MS) {
      setIsDonePulse(false);
      return;
    }

    setIsDonePulse(true);
    const timeout = window.setTimeout(() => {
      setIsDonePulse(false);
    }, AGENT_DONE_PULSE_MS - elapsed);

    return () => {
      window.clearTimeout(timeout);
    };
  }, [mcpViewState.agentActivity]);

  const isBusy = mcpViewState.activeToolCalls > 0 || mcpViewState.busySince !== null;
  const message =
    isBusy && mcpViewState.agentActivity?.phase === 'done'
      ? 'Agent working via MCP.'
      : getMcpPresenceMessage(mcpViewState);
  return {
    isBusy,
    isDonePulse: !isBusy && isDonePulse,
    message,
  };
};

const useSessionCommands = (): {
  isOpeningProject: boolean;
  handleOpenProject(): Promise<void>;
  handleFocusSession(sessionId: string): Promise<void>;
  handleCloseSession(event: MouseEvent<HTMLButtonElement>, sessionId: string): Promise<void>;
} => {
  const [isOpeningProject, setIsOpeningProject] = useState(false);

  const runSessionCommand = async (command: SessionCommand): Promise<void> => {
    await window.agentBrowser.executeSession(command);
  };

  const handleOpenProject = async (): Promise<void> => {
    setIsOpeningProject(true);
    try {
      await runSessionCommand({ action: 'openProject' });
    } catch {
      // Session errors are surfaced through session state.
    } finally {
      setIsOpeningProject(false);
    }
  };

  const handleFocusSession = async (sessionId: string): Promise<void> => {
    try {
      await runSessionCommand({ action: 'focus', sessionId });
    } catch {
      // Session errors are surfaced through session state.
    }
  };

  const handleCloseSession = async (
    event: MouseEvent<HTMLButtonElement>,
    sessionId: string,
  ): Promise<void> => {
    event.stopPropagation();
    try {
      await runSessionCommand({ action: 'close', sessionId });
    } catch {
      // Session errors are surfaced through session state.
    }
  };

  return {
    isOpeningProject,
    handleOpenProject,
    handleFocusSession,
    handleCloseSession,
  };
};

const SessionStrip = ({
  sessionState,
}: {
  sessionState: SessionViewState;
}): JSX.Element => {
  const { isOpeningProject, handleOpenProject, handleFocusSession, handleCloseSession } =
    useSessionCommands();
  const activeSessionId =
    sessionState.sessions.find((session) => session.isFocused)?.sessionId ??
    sessionState.currentSessionId;

  return (
    <section aria-label="Open projects" className="shell__projectStrip">
      <div className="shell__projectStripLabel">
        {sessionState.role === 'launcher' ? 'Launcher' : 'Projects'}
      </div>

      {sessionState.sessions.length > 0 ? (
        <div className="shell__projectStripRail">
          {sessionState.sessions.map((session) => {
            const badgeForeground = getReadableForeground(session.chromeColor);
            const isActive = activeSessionId === session.sessionId;

            return (
              <div
                className={`shell__projectChip${
                  isActive ? ' shell__projectChip--active' : ''
                }`}
                key={session.sessionId}
              >
                <button
                  className="shell__projectChipFocus"
                  onClick={() => void handleFocusSession(session.sessionId)}
                  type="button"
                >
                  <span
                    aria-hidden="true"
                    className="shell__projectBadge"
                    style={{
                      backgroundColor: session.chromeColor,
                      color: badgeForeground,
                    }}
                  >
                    {getSessionBadgeLabel(session)}
                  </span>
                  <span className="shell__projectChipCopy">
                    <span className="shell__projectChipTitle">{session.projectName}</span>
                    <span className="shell__projectChipMeta">{getSessionChipMeta(session)}</span>
                  </span>
                </button>
                <span className="shell__projectChipActions">
                  <span
                    aria-hidden="true"
                    className={`shell__statusDot shell__statusDot--${
                      session.status === 'error'
                        ? 'red'
                        : session.status === 'launching' || session.status === 'closing'
                          ? 'yellow'
                          : session.dockIconStatus === 'failed'
                            ? 'red'
                            : 'green'
                    }`}
                  />
                  <button
                    aria-label={`Close ${session.projectName}`}
                    className="shell__projectChipClose"
                    onClick={(event) => void handleCloseSession(event, session.sessionId)}
                    type="button"
                  >
                    <ChromeIcon className="shell__icon" name="close" />
                  </button>
                </span>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="shell__projectEmpty">
          No projects are open yet. Open a folder to launch a dedicated Loop Browser session.
        </div>
      )}

      <div className="shell__projectStripActions">
        <button
          className="shell__pillButton shell__pillButton--muted"
          disabled={isOpeningProject}
          onClick={() => void handleOpenProject()}
          type="button"
        >
          {isOpeningProject ? 'Opening...' : 'Open Project'}
        </button>
      </div>
    </section>
  );
};

const LauncherSurface = ({
  sessionState,
}: {
  sessionState: SessionViewState;
}): JSX.Element => {
  const { isOpeningProject, handleOpenProject, handleFocusSession, handleCloseSession } =
    useSessionCommands();
  const activeSessionId =
    sessionState.sessions.find((session) => session.isFocused)?.sessionId ??
    sessionState.currentSessionId;

  return (
    <main className="launcherSurface">
      <section className="launcherSurface__panel">
        <div className="launcherSurface__eyebrow">Loop Browser Launcher</div>

        <section className="launcherSurface__hero">
          <div className="launcherSurface__title">Open a project and jump in.</div>
          <div className="launcherSurface__subtitle">
            Each project opens in its own Loop Browser session with its own config, profile, and
            Dock icon. Use the launcher to start or revisit project windows.
          </div>
          <div className="launcherSurface__actions">
            <button
              className="launcherSurface__cta"
              disabled={isOpeningProject}
              onClick={() => void handleOpenProject()}
              type="button"
            >
              {isOpeningProject ? 'Opening Project...' : 'Open Project'}
            </button>
            <div className="launcherSurface__hint">Shortcut: Cmd/Ctrl + Shift + O</div>
          </div>
        </section>

        <section className="launcherSurface__section">
          <div className="launcherSurface__sectionHeader">
            <div className="launcherSurface__sectionTitle">Open Sessions</div>
            <div className="launcherSurface__sectionMeta">
              {sessionState.sessions.length} active
            </div>
          </div>

          {sessionState.lastError ? (
            <div className="projectSurface__error">{sessionState.lastError}</div>
          ) : null}

          {sessionState.sessions.length > 0 ? (
            <div className="launcherSurface__sessionList">
              {sessionState.sessions.map((session) => {
                const badgeForeground = getReadableForeground(session.chromeColor);
                const isActive = activeSessionId === session.sessionId;

                return (
                  <div
                    className={`launcherSurface__sessionCard${
                      isActive ? ' launcherSurface__sessionCard--active' : ''
                    }`}
                    key={session.sessionId}
                  >
                    <button
                      className="launcherSurface__sessionCardMain"
                      onClick={() => void handleFocusSession(session.sessionId)}
                      type="button"
                    >
                      <span
                        aria-hidden="true"
                        className="launcherSurface__sessionBadge"
                        style={{
                          backgroundColor: session.chromeColor,
                          color: badgeForeground,
                        }}
                      >
                        {getSessionBadgeLabel(session)}
                      </span>
                      <span className="launcherSurface__sessionCopy">
                        <span className="launcherSurface__sessionTitle">{session.projectName}</span>
                        <span className="launcherSurface__sessionMeta">
                          {session.projectRoot}
                        </span>
                      </span>
                    </button>
                    <div className="launcherSurface__sessionActions">
                      <span
                        className={`launcherSurface__status launcherSurface__status--${
                          session.status === 'error'
                            ? 'red'
                            : session.status === 'launching' || session.status === 'closing'
                              ? 'yellow'
                              : session.dockIconStatus === 'failed'
                                ? 'red'
                                : 'green'
                        }`}
                      >
                        {getSessionChipMeta(session)}
                      </span>
                      <button
                        aria-label={`Close ${session.projectName}`}
                        className="shell__pillButton shell__pillButton--muted"
                        onClick={(event) => void handleCloseSession(event, session.sessionId)}
                        type="button"
                      >
                        Close
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="launcherSurface__empty">
              No project sessions are open yet. Open a folder to launch your first project window.
            </div>
          )}
        </section>
      </section>
    </main>
  );
};

const ChromeSurface = ({
  chromeAppearanceState,
  sessionState,
}: {
  chromeAppearanceState: ChromeAppearanceState;
  sessionState: SessionViewState;
}): JSX.Element => {
  const navigationState = useNavigationState();
  const pickerState = usePickerState();
  const feedbackState = useFeedbackState();
  const markdownViewState = useMarkdownViewState();
  const mcpViewState = useMcpViewState();
  const mcpPresence = useMcpPresence(mcpViewState);
  const [draftUrl, setDraftUrl] = useState('');
  const [isEditingAddress, setIsEditingAddress] = useState(false);
  const [copyFeedback, setCopyFeedback] = useState('Copy JSON');
  const copyTimerRef = useRef<number | null>(null);

  useEffect(() => {
    if (!isEditingAddress) {
      setDraftUrl(navigationState.url);
    }
  }, [isEditingAddress, navigationState.url]);

  useEffect(() => {
    return () => {
      if (copyTimerRef.current !== null) {
        window.clearTimeout(copyTimerRef.current);
      }
    };
  }, []);

  const runCommand = async (command: NavigationCommand): Promise<void> => {
    const nextState = await window.agentBrowser.execute(command);

    if (command.action === 'navigate') {
      setDraftUrl(nextState.url);
      setIsEditingAddress(false);
    }
  };

  const runPickerCommand = async (command: PickerCommand): Promise<void> => {
    await window.agentBrowser.executePicker(command);
  };

  const runMarkdownCommand = async (command: MarkdownViewCommand): Promise<void> => {
    await window.agentBrowser.executeMarkdownView(command);
  };

  const runMcpCommand = async (command: McpViewCommand): Promise<void> => {
    await window.agentBrowser.executeMcpView(command);
  };

  const runChromeAppearanceCommand = async (command: ChromeAppearanceCommand): Promise<void> => {
    await window.agentBrowser.executeChromeAppearance(command);
  };

  const runFeedbackCommand = async (command: FeedbackCommand): Promise<void> => {
    await window.agentBrowser.executeFeedback(command);
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    await runCommand({ action: 'navigate', target: draftUrl });
  };

  const handleCopyDescriptor = (): void => {
    if (!pickerState.lastSelection) {
      return;
    }

    window.agentBrowser.copyText(JSON.stringify(pickerState.lastSelection, null, 2));
    setCopyFeedback('Copied');

    if (copyTimerRef.current !== null) {
      window.clearTimeout(copyTimerRef.current);
    }

    copyTimerRef.current = window.setTimeout(() => {
      setCopyFeedback('Copy JSON');
      copyTimerRef.current = null;
    }, 1500);
  };

  const activeTabLabel = getActiveTabLabel(navigationState);
  const locationIcon = getLocationIcon(navigationState.url);
  const selection = pickerState.lastSelection;
  const draftSelection = feedbackState.draft.selection;
  const activeAnnotation =
    feedbackState.annotations.find((annotation) => annotation.id === feedbackState.activeAnnotationId) ??
    null;
  const openAnnotationCount = feedbackState.annotations.filter(
    (annotation) => annotation.status === 'open' || annotation.status === 'acknowledged' || annotation.status === 'in_progress',
  ).length;
  const inspectorHeading = pickerState.enabled
    ? 'Pick mode is active'
    : draftSelection
      ? `Draft ready for ${getSelectionHeading(draftSelection)}`
      : selection
        ? getSelectionHeading(selection)
      : activeAnnotation
        ? getSelectionHeading(activeAnnotation.selection)
      : 'DOM picker ready';
  const inspectorMeta = pickerState.enabled
    ? 'Click any element in the page, or press Esc to cancel.'
    : draftSelection
      ? 'Add context, classify the issue, and let the agent respond in the feedback panel.'
      : selection
        ? getSelectionMeta(selection)
      : activeAnnotation
        ? `${getSelectionMeta(activeAnnotation.selection)} | ${
            mcpPresence.message ?? getFeedbackStatusLabel(activeAnnotation.status)
          }`
      : 'Use the crosshair button or View > Toggle Pick Mode.';
  const diagnosticLabel =
    sessionState.lastError ??
    navigationState.lastError ??
    (mcpPresence.isBusy || mcpPresence.isDonePulse
      ? mcpPresence.message ?? 'Agent working via MCP.'
      : getQuietStatus(navigationState));
  const mcpButtonLabel = mcpPresence.isBusy
    ? 'Agent Working'
    : mcpPresence.isDonePulse
      ? 'Agent Updated'
      : 'MCP Status';
  const mcpButtonAriaLabel = mcpPresence.isBusy
    ? `Agent working via MCP${mcpPresence.message ? `: ${mcpPresence.message}` : ''}`
    : mcpPresence.isDonePulse
      ? `Agent update complete${mcpPresence.message ? `: ${mcpPresence.message}` : ''}`
      : `MCP status: ${mcpViewState.statusLabel}`;
  const currentProjectIconSrc = projectIconSrc(chromeAppearanceState.resolvedProjectIconPath);

  return (
    <main className="shell">
      <section
        className={`shell__panel${
          mcpPresence.isBusy ? ' shell__panel--busy' : ''
        }${mcpPresence.isDonePulse ? ' shell__panel--done' : ''}`}
      >
        <div className="shell__tabstrip">
          <div className="shell__tabRail">
            <div aria-hidden="true" className="shell__newTab">
              <ChromeIcon className="shell__icon" name="plus" />
            </div>

            <div
              className={`shell__tab shell__tab--active${
                navigationState.isLoading ? ' shell__tab--loading' : ''
              }`}
            >
              <span
                className={`shell__tabIndicator${
                  navigationState.isLoading ? ' shell__tabIndicator--loading' : ''
                }`}
              />
              <span className="shell__tabTitle">{activeTabLabel}</span>
            </div>

            {stubTabs.map((label) => (
              <div aria-hidden="true" className="shell__tab shell__tab--stub" key={label}>
                <span className="shell__tabIndicator shell__tabIndicator--stub" />
                <span className="shell__tabTitle">{label}</span>
              </div>
            ))}
          </div>

          <div className="shell__utilityRail">
            <div aria-hidden="true" className="shell__utility shell__utility--icon">
              <ChromeIcon className="shell__icon" name="search" />
            </div>
            <div aria-hidden="true" className="shell__utility shell__utility--icon">
              <ChromeIcon className="shell__icon" name="sparkles" />
            </div>
            <div aria-hidden="true" className="shell__utility shell__utility--pill">
              Ask Agent
            </div>
            <div aria-hidden="true" className="shell__profileStub">
              {currentProjectIconSrc ? (
                <img
                  alt=""
                  className="shell__profileImage"
                  src={currentProjectIconSrc}
                />
              ) : (
                'LB'
              )}
            </div>
          </div>
        </div>

        <SessionStrip sessionState={sessionState} />

        <form className="shell__toolbar" onSubmit={(event) => void handleSubmit(event)}>
          <div className="shell__nav">
            <button
              aria-label="Go back"
              className="shell__navButton"
              disabled={!navigationState.canGoBack}
              onClick={() => void runCommand({ action: 'back' })}
              type="button"
            >
              <ChromeIcon className="shell__icon" name="chevronLeft" />
            </button>
            <button
              aria-label="Go forward"
              className="shell__navButton"
              disabled={!navigationState.canGoForward}
              onClick={() => void runCommand({ action: 'forward' })}
              type="button"
            >
              <ChromeIcon className="shell__icon" name="chevronRight" />
            </button>
            <button
              aria-label={navigationState.isLoading ? 'Stop loading' : 'Reload page'}
              className="shell__navButton"
              onClick={() =>
                void runCommand({ action: navigationState.isLoading ? 'stop' : 'reload' })
              }
              type="button"
            >
              <ChromeIcon className="shell__icon" name="reload" />
            </button>
          </div>

          <label className="shell__omnibox">
            <span className="shell__srOnly">Address</span>
            <span className="shell__omniboxFrame">
              <span aria-hidden="true" className="shell__omniboxIcon">
                <ChromeIcon className="shell__icon shell__icon--muted" name={locationIcon} />
              </span>
              <input
                autoCapitalize="off"
                autoCorrect="off"
                className={`shell__omniboxInput${
                  isEditingAddress ? ' shell__omniboxInput--editing' : ''
                }`}
                onBlur={() => setIsEditingAddress(false)}
                onChange={(event) => setDraftUrl(event.target.value)}
                onFocus={() => setIsEditingAddress(true)}
                placeholder="Search or enter website name"
                spellCheck={false}
                type="text"
                value={draftUrl}
              />
            </span>
          </label>

          <div className="shell__toolbarEdge">
            <button
              aria-label={pickerState.enabled ? 'Disable pick mode' : 'Enable pick mode'}
              aria-pressed={pickerState.enabled}
              className={`shell__navButton shell__navButton--picker${
                pickerState.enabled ? ' shell__navButton--pickerActive' : ''
              }`}
              onClick={() => void runPickerCommand({ action: 'toggle' })}
              type="button"
            >
              <ChromeIcon className="shell__icon" name="crosshair" />
            </button>
            <button
              aria-label={
                chromeAppearanceState.isOpen ? 'Close project style' : 'Open project style'
              }
              aria-pressed={chromeAppearanceState.isOpen}
              className={`shell__pillButton shell__pillButton--project${
                chromeAppearanceState.isOpen ? ' shell__pillButton--projectActive' : ''
              }`}
              onClick={() =>
                void runChromeAppearanceCommand({
                  action: chromeAppearanceState.isOpen ? 'close' : 'open',
                })
              }
              type="button"
            >
              <ChromeIcon className="shell__icon" name="sliders" />
              <span>Project Style</span>
            </button>
            <button
              aria-label={
                feedbackState.isOpen
                  ? 'Close feedback loop'
                  : `Open feedback loop${openAnnotationCount ? ` (${openAnnotationCount} open)` : ''}`
              }
              aria-pressed={feedbackState.isOpen}
              className={`shell__pillButton shell__pillButton--feedback${
                feedbackState.isOpen ? ' shell__pillButton--feedbackActive' : ''
              }`}
              onClick={() =>
                void runFeedbackCommand({
                  action: feedbackState.isOpen ? 'close' : 'open',
                })
              }
              type="button"
            >
              <span className="shell__feedbackCount">{openAnnotationCount}</span>
              <span>Feedback Loop</span>
            </button>
            <button
              aria-label={markdownViewState.isOpen ? 'Close Markdown view' : 'View page as Markdown'}
              aria-pressed={markdownViewState.isOpen}
              className={`shell__pillButton shell__pillButton--md${
                markdownViewState.isOpen ? ' shell__pillButton--mdActive' : ''
              }`}
              disabled={navigationState.isLoading}
              onClick={() =>
                void runMarkdownCommand({
                  action: markdownViewState.isOpen ? 'close' : 'open',
                })
              }
              type="button"
            >
              <ChromeIcon className="shell__icon" name="book" />
              <span>View as MD</span>
            </button>
            <button
              aria-label={mcpButtonAriaLabel}
              aria-pressed={mcpViewState.isOpen}
              className={`shell__pillButton shell__pillButton--mcp${
                mcpViewState.isOpen ? ' shell__pillButton--mcpActive' : ''
              }${mcpPresence.isBusy ? ' shell__pillButton--mcpBusy' : ''}${
                mcpPresence.isDonePulse ? ' shell__pillButton--mcpDone' : ''
              }`}
              onClick={() =>
                void runMcpCommand({
                  action: mcpViewState.isOpen ? 'close' : 'open',
                })
              }
              title={mcpPresence.message ?? mcpViewState.statusLabel}
              type="button"
            >
              <span
                aria-hidden="true"
                className={`shell__statusDot shell__statusDot--${mcpViewState.indicator}${
                  mcpPresence.isBusy ? ' shell__statusDot--busy' : ''
                }${mcpPresence.isDonePulse ? ' shell__statusDot--done' : ''}`}
              />
              <span>{mcpButtonLabel}</span>
            </button>
            <button aria-label="Load address" className="shell__goButton" type="submit">
              <ChromeIcon className="shell__icon" name="arrowUpRight" />
            </button>
          </div>
        </form>

        <div
          className={`shell__diagnostic${
            navigationState.lastError || sessionState.lastError ? ' shell__diagnostic--error' : ''
          }`}
        >
          {diagnosticLabel}
        </div>

        <div
          className={`shell__selectionBar${
            pickerState.enabled ? ' shell__selectionBar--armed' : ''
          }${selection || draftSelection || activeAnnotation ? ' shell__selectionBar--filled' : ''}`}
        >
          <div className="shell__selectionCopy">
            <div className="shell__selectionTitle">{inspectorHeading}</div>
            <div className="shell__selectionMeta">{inspectorMeta}</div>
          </div>

          <div className="shell__selectionActions">
            {draftSelection ? (
              <button
                className="shell__pillButton"
                onClick={() => void runFeedbackCommand({ action: 'open' })}
                type="button"
              >
                Open Draft
              </button>
            ) : null}
            {activeAnnotation ? (
              <span
                className={`shell__feedbackStatus shell__feedbackStatus--${getFeedbackStatusTone(
                  activeAnnotation.status,
                )}`}
              >
                {getFeedbackStatusLabel(activeAnnotation.status)}
              </span>
            ) : null}
            {selection ? (
              <button className="shell__pillButton" onClick={handleCopyDescriptor} type="button">
                {copyFeedback}
              </button>
            ) : null}
            {selection ? (
              <button
                className="shell__pillButton shell__pillButton--muted"
                onClick={() => void runPickerCommand({ action: 'clearSelection' })}
                type="button"
              >
                Clear
              </button>
            ) : null}
          </div>
        </div>
      </section>
    </main>
  );
};

const MarkdownSurface = (): JSX.Element => {
  const markdownViewState = useMarkdownViewState();
  const [copyFeedback, setCopyFeedback] = useState('Copy Markdown');
  const copyTimerRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (copyTimerRef.current !== null) {
        window.clearTimeout(copyTimerRef.current);
      }
    };
  }, []);

  const runMarkdownCommand = async (command: MarkdownViewCommand): Promise<void> => {
    await window.agentBrowser.executeMarkdownView(command);
  };

  const handleCopyMarkdown = (): void => {
    if (!markdownViewState.markdown) {
      return;
    }

    window.agentBrowser.copyText(markdownViewState.markdown);
    setCopyFeedback('Copied');

    if (copyTimerRef.current !== null) {
      window.clearTimeout(copyTimerRef.current);
    }

    copyTimerRef.current = window.setTimeout(() => {
      setCopyFeedback('Copy Markdown');
      copyTimerRef.current = null;
    }, 1500);
  };

  return (
    <main className="markdownSurface">
      <section className="markdownSurface__panel">
        <header className="markdownSurface__header">
          <div className="markdownSurface__eyebrow">View Page As MD</div>
          <button
            aria-label="Close Markdown view"
            className="markdownSurface__iconButton"
            onClick={() => void runMarkdownCommand({ action: 'close' })}
            type="button"
          >
            <ChromeIcon className="shell__icon" name="close" />
          </button>
        </header>

        <div className="markdownSurface__summary">
          <div className="markdownSurface__title">
            {markdownViewState.title || 'Current page'}
          </div>
          <div className="markdownSurface__source">
            {getMarkdownSourceLabel(markdownViewState)}
          </div>
        </div>

        <div
          className={`markdownSurface__status${
            markdownViewState.status === 'error' ? ' markdownSurface__status--error' : ''
          }`}
        >
          {getMarkdownStatusText(markdownViewState)}
        </div>

        <div className="markdownSurface__actions">
          <button
            className="shell__pillButton"
            disabled={!markdownViewState.markdown}
            onClick={handleCopyMarkdown}
            type="button"
          >
            {copyFeedback}
          </button>
          <button
            className="shell__pillButton shell__pillButton--muted"
            onClick={() => void runMarkdownCommand({ action: 'refresh', force: true })}
            type="button"
          >
            Refresh
          </button>
          <button
            className="shell__pillButton shell__pillButton--muted"
            onClick={() => void runMarkdownCommand({ action: 'close' })}
            type="button"
          >
            Close
          </button>
        </div>

        <section className="markdownSurface__body">
          {markdownViewState.status === 'ready' ? (
            <pre className="markdownSurface__content">{markdownViewState.markdown}</pre>
          ) : (
            <div className="markdownSurface__empty">{getMarkdownStatusText(markdownViewState)}</div>
          )}
        </section>
      </section>
    </main>
  );
};

const McpSurface = (): JSX.Element => {
  const mcpViewState = useMcpViewState();
  const mcpPresence = useMcpPresence(mcpViewState);

  const runMcpCommand = async (command: McpViewCommand): Promise<void> => {
    await window.agentBrowser.executeMcpView(command);
  };

  return (
    <main className="mcpSurface">
      <section className="mcpSurface__panel">
        <header className="mcpSurface__header">
          <div className="mcpSurface__eyebrow">MCP Diagnostics</div>
          <button
            aria-label="Close MCP diagnostics"
            className="mcpSurface__iconButton"
            onClick={() => void runMcpCommand({ action: 'close' })}
            type="button"
          >
            <ChromeIcon className="shell__icon" name="close" />
          </button>
        </header>

        <section className="mcpSurface__hero">
          <div className="mcpSurface__heroHeading">
            <span
              aria-hidden="true"
              className={`shell__statusDot shell__statusDot--${mcpViewState.indicator}`}
            />
            <div>
              <div className="mcpSurface__title">MCP Status</div>
              <div className="mcpSurface__subtitle">{mcpViewState.statusLabel}</div>
            </div>
          </div>

          <div className={`mcpSurface__badge mcpSurface__badge--${mcpViewState.indicator}`}>
            {getMcpIndicatorLabel(mcpViewState)}
          </div>
        </section>

        <div className="mcpSurface__actions">
          <button
            className="shell__pillButton shell__pillButton--muted"
            onClick={() => void runMcpCommand({ action: 'refresh' })}
            type="button"
          >
            Refresh Status
          </button>
          <button className="shell__pillButton" onClick={() => void runMcpCommand({ action: 'selfTest' })} type="button">
            Run Self-Test
          </button>
          <button
            className="shell__pillButton shell__pillButton--muted"
            onClick={() => void runMcpCommand({ action: 'close' })}
            type="button"
          >
            Close
          </button>
        </div>

        <div className="mcpSurface__body">
          <section className="mcpSurface__section">
            <div className="mcpSurface__sectionTitle">Connection</div>
            <dl className="mcpSurface__metaList">
              <div className="mcpSurface__metaRow">
                <dt>Transport</dt>
                <dd>{mcpViewState.transportUrl || 'Waiting for server startup'}</dd>
              </div>
              <div className="mcpSurface__metaRow">
                <dt>Host / Port</dt>
                <dd>
                  {mcpViewState.host || '127.0.0.1'}
                  {mcpViewState.port ? `:${mcpViewState.port}` : ''}
                </dd>
              </div>
              <div className="mcpSurface__metaRow">
                <dt>Auth</dt>
                <dd>{getMcpAuthLabel(mcpViewState)}</dd>
              </div>
              <div className="mcpSurface__metaRow">
                <dt>Manifest</dt>
                <dd>{mcpViewState.registrationFile || 'Waiting for registration file'}</dd>
              </div>
            </dl>
          </section>

          <section className="mcpSurface__section">
            <div className="mcpSurface__sectionHeader">
              <div className="mcpSurface__sectionTitle">Tools</div>
              <div className="mcpSurface__sectionMeta">{mcpViewState.tools.length} exposed</div>
            </div>
            <div className="mcpSurface__toolList">
              {mcpViewState.tools.map((tool) => (
                <span className="mcpSurface__toolPill" key={tool}>
                  {tool}
                </span>
              ))}
            </div>
          </section>

          <section className="mcpSurface__section">
            <div className="mcpSurface__sectionHeader">
              <div className="mcpSurface__sectionTitle">Live Activity</div>
              <div className="mcpSurface__sectionMeta">
                {mcpViewState.activeToolCalls} active tool{mcpViewState.activeToolCalls === 1 ? '' : 's'}
              </div>
            </div>
            <div className="mcpSurface__activitySummary">
              {mcpPresence.message ?? 'No active agent workflow.'}
            </div>
            <div className="mcpSurface__debugGrid">
              <div className="mcpSurface__debugChip">
                Busy since: {formatTimestamp(mcpViewState.busySince)}
              </div>
              <div className="mcpSurface__debugChip">
                Last busy: {formatTimestamp(mcpViewState.lastBusyAt)}
              </div>
              <div className="mcpSurface__debugChip">
                Annotation: {mcpViewState.agentActivity?.annotationId ?? 'None'}
              </div>
            </div>
          </section>

          <section className="mcpSurface__section">
            <div className="mcpSurface__sectionHeader">
              <div className="mcpSurface__sectionTitle">Activity</div>
              <div className="mcpSurface__sectionMeta">
                {mcpViewState.requestCount.toLocaleString()} requests handled
              </div>
            </div>
            <div className="mcpSurface__activitySummary">
              Last request: {formatTimestamp(mcpViewState.lastRequestAt)}
            </div>
            <div className="mcpSurface__requestList">
              {mcpViewState.recentRequests.length > 0 ? (
                mcpViewState.recentRequests.map((entry) => (
                  <article className="mcpSurface__requestItem" key={`${entry.at}-${entry.method}-${entry.detail}`}>
                    <div className="mcpSurface__requestHeader">
                      <span className="mcpSurface__requestMethod">{entry.method}</span>
                      <span className={`mcpSurface__requestOutcome mcpSurface__requestOutcome--${entry.outcome}`}>
                        {entry.outcome}
                      </span>
                    </div>
                    <div className="mcpSurface__requestDetail">{entry.detail}</div>
                    <div className="mcpSurface__requestTime">{formatTimestamp(entry.at)}</div>
                  </article>
                ))
              ) : (
                <div className="mcpSurface__empty">No MCP requests have been recorded yet.</div>
              )}
            </div>
          </section>

          <section className="mcpSurface__section">
            <div className="mcpSurface__sectionHeader">
              <div className="mcpSurface__sectionTitle">Debug</div>
              <div className="mcpSurface__sectionMeta">
                Last checked {formatTimestamp(mcpViewState.lastSelfTest.checkedAt)}
              </div>
            </div>
            <div className="mcpSurface__debugRow">{getMcpSelfTestLabel(mcpViewState)}</div>
            <div className="mcpSurface__debugGrid">
              <div className="mcpSurface__debugChip">
                Health: {mcpViewState.lastSelfTest.healthOk === null ? 'Pending' : mcpViewState.lastSelfTest.healthOk ? 'OK' : 'Fail'}
              </div>
              <div className="mcpSurface__debugChip">
                Initialize: {mcpViewState.lastSelfTest.initializeOk === null ? 'Pending' : mcpViewState.lastSelfTest.initializeOk ? 'OK' : 'Fail'}
              </div>
              <div className="mcpSurface__debugChip">
                Tools: {mcpViewState.lastSelfTest.toolsListOk === null ? 'Pending' : mcpViewState.lastSelfTest.toolsListOk ? 'OK' : 'Fail'}
              </div>
            </div>
            {mcpViewState.lastError ? (
              <div className="mcpSurface__error">{mcpViewState.lastError}</div>
            ) : null}
            <div className="mcpSurface__activitySummary">
              Updated {formatTimestamp(mcpViewState.lastUpdatedAt)}
            </div>
          </section>
        </div>
      </section>
    </main>
  );
};

const ProjectSurface = ({
  chromeAppearanceState,
  sessionState,
}: {
  chromeAppearanceState: ChromeAppearanceState;
  sessionState: SessionViewState;
}): JSX.Element => {
  const hasProject = chromeAppearanceState.projectRoot.trim().length > 0;
  const projectActionLabel =
    sessionState.role === 'project-session' ? 'Open Another Project' : 'Open Project';
  const [chromeColorDraft, setChromeColorDraft] = useState(chromeAppearanceState.chromeColor);
  const [accentColorDraft, setAccentColorDraft] = useState(chromeAppearanceState.accentColor);
  const [projectIconPathDraft, setProjectIconPathDraft] = useState(
    chromeAppearanceState.projectIconPath,
  );
  const [projectIconPickerError, setProjectIconPickerError] = useState<string | null>(null);
  const chromeColorError = getHexColorDraftError('Chrome color', chromeColorDraft);
  const accentColorError = getHexColorDraftError('Accent color', accentColorDraft);
  const hasDraftErrors = Boolean(chromeColorError || accentColorError || projectIconPickerError);
  const effectiveChromeColor = getColorPickerValue(
    chromeColorDraft,
    chromeAppearanceState.chromeColor,
  );
  const effectiveAccentColor = getColorPickerValue(
    accentColorDraft,
    chromeAppearanceState.accentColor,
  );
  const previewTheme = getChromeAppearanceThemeTokens({
    chromeColor: effectiveChromeColor,
    accentColor: effectiveAccentColor,
  });
  const previewFallbackIconColor = resolveDefaultDockIconColor(effectiveChromeColor);
  const previewFallbackIconLabel =
    effectiveChromeColor === DEFAULT_CHROME_COLOR ? 'Default black icon' : 'Chrome color icon';
  const previewIconLayout = getDockIconLayoutMetrics(72);
  const previewTileStyle = {
    width: `${previewIconLayout.tileSize}px`,
    height: `${previewIconLayout.tileSize}px`,
    borderRadius: `${previewIconLayout.tileRadius}px`,
    backgroundColor: previewFallbackIconColor,
    left: `${previewIconLayout.tileX}px`,
    top: `${previewIconLayout.tileY}px`,
  } satisfies CSSProperties;
  const previewTileLightStyle = {
    height: `${previewIconLayout.topLightHeight}px`,
  } satisfies CSSProperties;
  const previewTileHighlightStyle = {
    inset: `${previewIconLayout.highlightInset}px`,
    borderRadius: `${Math.max(0, previewIconLayout.tileRadius - previewIconLayout.highlightInset)}px`,
    boxShadow: `inset 0 0 0 ${previewIconLayout.highlightWidth}px rgba(255, 255, 255, 0.18)`,
  } satisfies CSSProperties;
  const previewArtworkStyle = {
    width: `${previewIconLayout.artMaxSize}px`,
    height: `${previewIconLayout.artMaxSize}px`,
    borderRadius: `${getDockIconArtMaskRadius(previewIconLayout.artMaxSize)}px`,
  } satisfies CSSProperties;
  const draftProjectIconPreviewSrc = projectIconSrc(
    resolveDraftProjectIconPath(
      chromeAppearanceState.projectRoot,
      projectIconPathDraft,
      chromeAppearanceState.projectIconPath,
      chromeAppearanceState.resolvedProjectIconPath,
    ),
  );
  const previewStyle = {
    backgroundColor: effectiveChromeColor,
    color: previewTheme.chromeText,
  } satisfies CSSProperties;

  useEffect(() => {
    setChromeColorDraft(chromeAppearanceState.chromeColor);
    setAccentColorDraft(chromeAppearanceState.accentColor);
    setProjectIconPathDraft(chromeAppearanceState.projectIconPath);
    setProjectIconPickerError(null);
  }, [
    chromeAppearanceState.chromeColor,
    chromeAppearanceState.accentColor,
    chromeAppearanceState.projectIconPath,
    chromeAppearanceState.projectRoot,
  ]);

  const runChromeAppearanceCommand = async (command: ChromeAppearanceCommand): Promise<void> => {
    await window.agentBrowser.executeChromeAppearance(command);
  };

  const handleSave = async (): Promise<void> => {
    if (!hasProject || hasDraftErrors) {
      return;
    }

    await runChromeAppearanceCommand({
      action: 'set',
      chromeColor: normalizeHexColorDraft(chromeColorDraft),
      accentColor: normalizeHexColorDraft(accentColorDraft),
      projectIconPath: projectIconPathDraft.trim(),
    });
  };

  const handleReset = async (): Promise<void> => {
    if (!hasProject) {
      return;
    }

    await runChromeAppearanceCommand({ action: 'reset' });
  };

  const handleBrowseProjectIcon = async (): Promise<void> => {
    if (!hasProject) {
      return;
    }

    try {
      const selectedProjectIconPath = await window.agentBrowser.browseProjectIcon();
      if (selectedProjectIconPath === null) {
        return;
      }

      setProjectIconPathDraft(selectedProjectIconPath);
      setProjectIconPickerError(null);
    } catch (error) {
      setProjectIconPickerError(
        error instanceof Error ? error.message : 'Could not choose a project icon.',
      );
    }
  };

  const handleClearProjectIcon = (): void => {
    setProjectIconPathDraft('');
    setProjectIconPickerError(null);
  };

  return (
    <main className="projectSurface">
      <section className="projectSurface__panel">
        <header className="projectSurface__header">
          <div className="projectSurface__eyebrow">Project Style</div>
          <button
            aria-label="Close project style"
            className="projectSurface__iconButton"
            onClick={() => void runChromeAppearanceCommand({ action: 'close' })}
            type="button"
          >
            <ChromeIcon className="shell__icon" name="close" />
          </button>
        </header>

        <section className="projectSurface__hero">
          <div>
            <div className="projectSurface__title">Style this project and keep it distinct.</div>
            <div className="projectSurface__subtitle">
              Choose a project folder, then Loop Browser will read and write
              <code> .loop-browser.json </code>
              there and use that file to control the chrome.
            </div>
          </div>
          <div className="projectSurface__heroMeta">
            <div
              className="projectSurface__swatch"
              style={{ backgroundColor: effectiveChromeColor }}
            />
            <div
              className="projectSurface__swatch projectSurface__swatch--accent"
              style={{ backgroundColor: effectiveAccentColor }}
            />
          </div>
        </section>

        <div className="projectSurface__body">
          <section className="projectSurface__section">
            <div className="projectSurface__sectionHeader">
              <div className="projectSurface__sectionTitle">Project</div>
              <button
                className="shell__pillButton shell__pillButton--muted"
                onClick={() => void runChromeAppearanceCommand({ action: 'selectProject' })}
                type="button"
              >
                {projectActionLabel}
              </button>
            </div>
            {hasProject ? (
              <>
                <div className="projectSurface__metaCard">
                  <div className="projectSurface__metaLabel">Project root</div>
                  <div className="projectSurface__metaValue">{chromeAppearanceState.projectRoot}</div>
                </div>
                <div className="projectSurface__metaCard">
                  <div className="projectSurface__metaLabel">Config file</div>
                  <div className="projectSurface__metaValue">{chromeAppearanceState.configPath}</div>
                </div>
                <div className="projectSurface__metaCard">
                  <div className="projectSurface__metaLabel">Dock icon</div>
                  <div className="projectSurface__metaValue">
                    {getDockIconStatusLabel(chromeAppearanceState)}
                  </div>
                </div>
                <div className="projectSurface__sectionMeta">
                  Relative icon paths resolve from this project folder.
                </div>
                {sessionState.role === 'project-session' ? (
                  <div className="projectSurface__sectionMeta">
                    Use Open Another Project to spawn a separate session window without changing
                    this project.
                  </div>
                ) : null}
              </>
            ) : (
              <div className="projectSurface__empty">
                Open a project folder first. Loop Browser will create or update
                <code> .loop-browser.json </code>
                inside that folder, and that file will control the app chrome.
              </div>
            )}
            {chromeAppearanceState.lastError ? (
              <div className="projectSurface__error">{chromeAppearanceState.lastError}</div>
            ) : null}
            {!chromeAppearanceState.lastError && chromeAppearanceState.dockIconStatus === 'applied' ? (
              <div className="projectSurface__sectionMeta">
                {getDockIconStatusLabel(chromeAppearanceState)}
              </div>
            ) : null}
          </section>

          <section className="projectSurface__section">
            <div className="projectSurface__sectionHeader">
              <div className="projectSurface__sectionTitle">Appearance</div>
              <div className="projectSurface__sectionMeta">Use picker or hex in #RRGGBB</div>
            </div>

            <label className="projectSurface__field">
              <span className="projectSurface__fieldLabel">Chrome color</span>
              <div className="projectSurface__colorField">
                <input
                  aria-label="Choose chrome color"
                  className="projectSurface__colorPicker"
                  disabled={!hasProject}
                  onChange={(event) => setChromeColorDraft(event.target.value.toUpperCase())}
                  type="color"
                  value={getColorPickerValue(chromeColorDraft, chromeAppearanceState.chromeColor)}
                />
                <input
                  aria-invalid={chromeColorError !== null}
                  className="projectSurface__input projectSurface__input--hex"
                  disabled={!hasProject}
                  onBlur={() => {
                    if (chromeColorError === null) {
                      setChromeColorDraft(normalizeHexColorDraft(chromeColorDraft));
                    }
                  }}
                  onChange={(event) => {
                    setChromeColorDraft(event.target.value.toUpperCase());
                  }}
                  placeholder="#FAFBFD"
                  spellCheck={false}
                  type="text"
                  value={chromeColorDraft}
                />
              </div>
              {chromeColorError ? (
                <div className="projectSurface__fieldError">{chromeColorError}</div>
              ) : null}
            </label>

            <label className="projectSurface__field">
              <span className="projectSurface__fieldLabel">Accent color</span>
              <div className="projectSurface__colorField">
                <input
                  aria-label="Choose accent color"
                  className="projectSurface__colorPicker"
                  disabled={!hasProject}
                  onChange={(event) => setAccentColorDraft(event.target.value.toUpperCase())}
                  type="color"
                  value={getColorPickerValue(accentColorDraft, chromeAppearanceState.accentColor)}
                />
                <input
                  aria-invalid={accentColorError !== null}
                  className="projectSurface__input projectSurface__input--hex"
                  disabled={!hasProject}
                  onBlur={() => {
                    if (accentColorError === null) {
                      setAccentColorDraft(normalizeHexColorDraft(accentColorDraft));
                    }
                  }}
                  onChange={(event) => {
                    setAccentColorDraft(event.target.value.toUpperCase());
                  }}
                  placeholder="#0A84FF"
                  spellCheck={false}
                  type="text"
                  value={accentColorDraft}
                />
              </div>
              {accentColorError ? (
                <div className="projectSurface__fieldError">{accentColorError}</div>
              ) : null}
            </label>

            <div className="projectSurface__field">
              <span className="projectSurface__fieldLabel">Project icon path</span>
              <div className="projectSurface__iconPickerRow">
                <div className="projectSurface__iconPickerPath">
                  {projectIconPathDraft || 'No icon selected yet'}
                </div>
                <div className="projectSurface__iconPickerActions">
                  <button
                    className="shell__pillButton shell__pillButton--muted"
                    disabled={!hasProject}
                    onClick={() => void handleBrowseProjectIcon()}
                    type="button"
                  >
                    Choose Icon
                  </button>
                  <button
                    className="shell__pillButton shell__pillButton--muted"
                    disabled={!hasProject || !projectIconPathDraft}
                    onClick={handleClearProjectIcon}
                    type="button"
                  >
                    Clear
                  </button>
                </div>
              </div>
              <div className="projectSurface__sectionMeta">
                Only files inside the selected project folder are allowed, and Loop Browser stores
                the icon as a relative path in <code>.loop-browser.json</code>.
              </div>
              {projectIconPickerError ? (
                <div className="projectSurface__fieldError">{projectIconPickerError}</div>
              ) : null}
            </div>

            <div className="projectSurface__actions">
              <button
                className="shell__pillButton"
                disabled={!hasProject || hasDraftErrors}
                onClick={() => void handleSave()}
                type="button"
              >
                Save Style
              </button>
              <button
                className="shell__pillButton shell__pillButton--muted"
                disabled={!hasProject}
                onClick={() => void handleReset()}
                type="button"
              >
                Reset
              </button>
              <button
                className="shell__pillButton shell__pillButton--muted"
                onClick={() => void runChromeAppearanceCommand({ action: 'close' })}
                type="button"
              >
                Close
              </button>
            </div>
          </section>

          <section className="projectSurface__section">
            <div className="projectSurface__sectionHeader">
              <div className="projectSurface__sectionTitle">Live preview</div>
              <div className="projectSurface__sectionMeta">Draft preview before save</div>
            </div>

            <div className="projectSurface__preview" style={previewStyle}>
              <div
                className="projectSurface__previewBar"
                style={{ backgroundColor: previewTheme.previewBarBg }}
              >
                <div
                  className="projectSurface__previewPill"
                  style={{ backgroundColor: previewTheme.previewPillBg }}
                />
                <div
                  className="projectSurface__previewTitle"
                  style={{ color: previewTheme.previewBarFg }}
                >
                  Loop Browser
                </div>
                <div
                  className="projectSurface__previewAccent"
                  style={{ backgroundColor: previewTheme.accentStrongBg }}
                />
              </div>
              <div className="projectSurface__previewBody">
                <div className="projectSurface__previewIconCanvas">
                  <div className="projectSurface__previewIconTile" style={previewTileStyle}>
                    <div className="projectSurface__previewIconTopLight" style={previewTileLightStyle} />
                    <div
                      className="projectSurface__previewIconHighlight"
                      style={previewTileHighlightStyle}
                    />
                    {draftProjectIconPreviewSrc ? (
                      <img
                        alt=""
                        className="projectSurface__previewIconArtwork"
                        src={draftProjectIconPreviewSrc}
                        style={previewArtworkStyle}
                      />
                    ) : null}
                  </div>
                </div>
                <div className="projectSurface__previewCopy">
                  <div
                    className="projectSurface__previewHeading"
                    style={{ color: previewTheme.chromeText }}
                  >
                    Project session
                  </div>
                  <div
                    className="projectSurface__previewMeta"
                    style={{ color: previewTheme.chromeMuted }}
                  >
                    {hasProject
                      ? projectIconPathDraft || previewFallbackIconLabel
                      : 'Choose a project folder to enable config-backed styling'}
                  </div>
                </div>
              </div>
            </div>
          </section>
        </div>
      </section>
    </main>
  );
};

const FeedbackSurface = (): JSX.Element => {
  const feedbackState = useFeedbackState();
  const navigationState = useNavigationState();
  const [summaryDraft, setSummaryDraft] = useState('');
  const [noteDraft, setNoteDraft] = useState('');
  const [replyDraft, setReplyDraft] = useState('');

  const currentPageAnnotations = feedbackState.annotations.filter(
    (annotation) => annotation.url === navigationState.url,
  );
  const activeAnnotation =
    feedbackState.annotations.find((annotation) => annotation.id === feedbackState.activeAnnotationId) ??
    currentPageAnnotations[0] ??
    feedbackState.annotations[0] ??
    null;
  const openAnnotationCount = feedbackState.annotations.filter(
    (annotation) =>
      annotation.status === 'open' ||
      annotation.status === 'acknowledged' ||
      annotation.status === 'in_progress',
  ).length;

  useEffect(() => {
    setSummaryDraft(feedbackState.draft.summary);
    setNoteDraft(feedbackState.draft.note);
  }, [feedbackState.draft.summary, feedbackState.draft.note, feedbackState.draft.selection]);

  useEffect(() => {
    setReplyDraft('');
  }, [feedbackState.activeAnnotationId]);

  const runFeedbackCommand = async (command: FeedbackCommand): Promise<void> => {
    await window.agentBrowser.executeFeedback(command);
  };

  const handleDraftSubmit = async (): Promise<void> => {
    await runFeedbackCommand({
      action: 'updateDraft',
      summary: summaryDraft,
      note: noteDraft,
    });
    await runFeedbackCommand({ action: 'submitDraft' });
  };

  const handleReplySubmit = async (): Promise<void> => {
    if (!activeAnnotation || !replyDraft.trim()) {
      return;
    }

    await runFeedbackCommand({
      action: 'reply',
      annotationId: activeAnnotation.id,
      body: replyDraft,
      author: 'human',
    });
    setReplyDraft('');
  };

  const handleCopyAnnotation = (): void => {
    if (!activeAnnotation) {
      return;
    }

    window.agentBrowser.copyText(JSON.stringify(activeAnnotation, null, 2));
  };

  return (
    <main className="feedbackSurface">
      <section className="feedbackSurface__panel">
        <header className="feedbackSurface__header">
          <div className="feedbackSurface__eyebrow">Selector Feedback Loop</div>
          <button
            aria-label="Close feedback view"
            className="feedbackSurface__iconButton"
            onClick={() => void runFeedbackCommand({ action: 'close' })}
            type="button"
          >
            <ChromeIcon className="shell__icon" name="close" />
          </button>
        </header>

        <section className="feedbackSurface__hero">
          <div>
            <div className="feedbackSurface__title">Human notes, agent replies, one loop.</div>
            <div className="feedbackSurface__subtitle">
              Pick an element, describe the issue, and let the agent acknowledge or resolve it
              from the same thread.
            </div>
          </div>
          <div className="feedbackSurface__heroMeta">
            <span className="feedbackSurface__heroCount">{openAnnotationCount}</span>
            <span>open items</span>
          </div>
        </section>

        <div className="feedbackSurface__body">
          <section className="feedbackSurface__section">
            <div className="feedbackSurface__sectionHeader">
              <div className="feedbackSurface__sectionTitle">Current draft</div>
              <div className="feedbackSurface__sectionMeta">
                {feedbackState.draft.selection ? 'Live from picker' : 'Waiting for selection'}
              </div>
            </div>

            {feedbackState.draft.selection ? (
              <>
                <div className="feedbackSurface__selectionCard">
                  <div className="feedbackSurface__selectionTitle">
                    {getSelectionHeading(feedbackState.draft.selection)}
                  </div>
                  <div className="feedbackSurface__selectionMeta">
                    {getSelectionMeta(feedbackState.draft.selection)}
                  </div>
                </div>

                <label className="feedbackSurface__field">
                  <span className="feedbackSurface__fieldLabel">Summary</span>
                  <input
                    className="feedbackSurface__input"
                    onChange={(event) => {
                      setSummaryDraft(event.target.value);
                      void runFeedbackCommand({
                        action: 'updateDraft',
                        summary: event.target.value,
                      });
                    }}
                    placeholder="What should the agent notice here?"
                    type="text"
                    value={summaryDraft}
                  />
                </label>

                <div className="feedbackSurface__fieldRow">
                  <label className="feedbackSurface__field">
                    <span className="feedbackSurface__fieldLabel">Kind</span>
                    <select
                      className="feedbackSurface__select"
                      onChange={(event) =>
                        void runFeedbackCommand({
                          action: 'updateDraft',
                          kind: event.target.value as FeedbackKind,
                        })
                      }
                      value={feedbackState.draft.kind}
                    >
                      <option value="bug">Bug</option>
                      <option value="change">Change</option>
                      <option value="question">Question</option>
                      <option value="praise">Praise</option>
                    </select>
                  </label>

                  <label className="feedbackSurface__field">
                    <span className="feedbackSurface__fieldLabel">Priority</span>
                    <select
                      className="feedbackSurface__select"
                      onChange={(event) =>
                        void runFeedbackCommand({
                          action: 'updateDraft',
                          priority: event.target.value as FeedbackPriority,
                        })
                      }
                      value={feedbackState.draft.priority}
                    >
                      <option value="low">Low</option>
                      <option value="medium">Medium</option>
                      <option value="high">High</option>
                      <option value="critical">Critical</option>
                    </select>
                  </label>
                </div>

                <label className="feedbackSurface__field">
                  <span className="feedbackSurface__fieldLabel">Context for the agent</span>
                  <textarea
                    className="feedbackSurface__textarea"
                    onChange={(event) => {
                      setNoteDraft(event.target.value);
                      void runFeedbackCommand({
                        action: 'updateDraft',
                        note: event.target.value,
                      });
                    }}
                    placeholder="Describe the problem, intent, or expected behavior."
                    rows={4}
                    value={noteDraft}
                  />
                </label>

                <div className="feedbackSurface__actions">
                  <button className="shell__pillButton" onClick={() => void handleDraftSubmit()} type="button">
                    Save Annotation
                  </button>
                  <button
                    className="shell__pillButton shell__pillButton--muted"
                    onClick={() => void runFeedbackCommand({ action: 'clearDraft' })}
                    type="button"
                  >
                    Clear Draft
                  </button>
                </div>
              </>
            ) : (
              <div className="feedbackSurface__empty">
                Arm pick mode from the top bar, click any element, and this composer will preload
                the selector context for you.
              </div>
            )}
          </section>

          <section className="feedbackSurface__section">
            <div className="feedbackSurface__sectionHeader">
              <div className="feedbackSurface__sectionTitle">Annotations</div>
              <div className="feedbackSurface__sectionMeta">
                {currentPageAnnotations.length} on this page
              </div>
            </div>

            <div className="feedbackSurface__annotationList">
              {currentPageAnnotations.length > 0 ? (
                currentPageAnnotations.map((annotation) => (
                  <button
                    className={`feedbackSurface__annotationCard${
                      activeAnnotation?.id === annotation.id
                        ? ' feedbackSurface__annotationCard--active'
                        : ''
                    }`}
                    key={annotation.id}
                    onClick={() =>
                      void runFeedbackCommand({
                        action: 'selectAnnotation',
                        annotationId: annotation.id,
                      })
                    }
                    type="button"
                  >
                    <div className="feedbackSurface__annotationHeader">
                      <span className="feedbackSurface__annotationTitle">{annotation.summary}</span>
                      <span
                        className={`shell__feedbackStatus shell__feedbackStatus--${getFeedbackStatusTone(
                          annotation.status,
                        )}`}
                      >
                        {getFeedbackStatusLabel(annotation.status)}
                      </span>
                    </div>
                    <div className="feedbackSurface__annotationMeta">
                      {getFeedbackKindLabel(annotation.kind)} • {getFeedbackPriorityLabel(annotation.priority)} •{' '}
                      {formatTimestamp(annotation.updatedAt)}
                    </div>
                    <div className="feedbackSurface__annotationMeta">
                      {getSelectionHeading(annotation.selection)}
                    </div>
                  </button>
                ))
              ) : (
                <div className="feedbackSurface__empty">
                  No saved annotations for this page yet.
                </div>
              )}
            </div>
          </section>

          <section className="feedbackSurface__section">
            <div className="feedbackSurface__sectionHeader">
              <div className="feedbackSurface__sectionTitle">Thread</div>
              <div className="feedbackSurface__sectionMeta">
                {activeAnnotation ? 'Shared with the agent' : 'Select an annotation'}
              </div>
            </div>

            {activeAnnotation ? (
              <>
                <div className="feedbackSurface__threadHero">
                  <div className="feedbackSurface__threadTitle">{activeAnnotation.summary}</div>
                  <div className="feedbackSurface__threadMeta">
                    {activeAnnotation.pageTitle} • {formatTimestamp(activeAnnotation.createdAt)}
                  </div>
                  <div className="feedbackSurface__statusRow">
                    {(['open', 'acknowledged', 'in_progress', 'resolved', 'dismissed'] as const).map(
                      (status) => (
                        <button
                          className={`shell__pillButton${
                            activeAnnotation.status === status
                              ? ` shell__pillButton--statusActive shell__pillButton--status-${getFeedbackStatusTone(status)}`
                              : ' shell__pillButton--muted'
                          }`}
                          key={status}
                          onClick={() =>
                            void runFeedbackCommand({
                              action: 'setStatus',
                              annotationId: activeAnnotation.id,
                              status,
                            })
                          }
                          type="button"
                        >
                          {getFeedbackStatusLabel(status)}
                        </button>
                      ),
                    )}
                  </div>
                </div>

                <div className="feedbackSurface__threadList">
                  {activeAnnotation.note ? (
                    <article className="feedbackSurface__threadItem">
                      <div className="feedbackSurface__threadAuthor">Human note</div>
                      <div className="feedbackSurface__threadBody">{activeAnnotation.note}</div>
                    </article>
                  ) : null}
                  {activeAnnotation.replies.map((reply) => (
                    <article className="feedbackSurface__threadItem" key={reply.id}>
                      <div className="feedbackSurface__threadAuthor">
                        {reply.author === 'agent'
                          ? 'Agent reply'
                          : reply.author === 'system'
                            ? 'System event'
                            : 'Human reply'}
                      </div>
                      <div className="feedbackSurface__threadBody">{reply.body}</div>
                      <div className="feedbackSurface__annotationMeta">
                        {formatTimestamp(reply.createdAt)}
                      </div>
                    </article>
                  ))}
                </div>

                <label className="feedbackSurface__field">
                  <span className="feedbackSurface__fieldLabel">Add reply</span>
                  <textarea
                    className="feedbackSurface__textarea"
                    onChange={(event) => setReplyDraft(event.target.value)}
                    placeholder="What should the agent know next?"
                    rows={3}
                    value={replyDraft}
                  />
                </label>

                <div className="feedbackSurface__actions">
                  <button
                    className="shell__pillButton"
                    disabled={!replyDraft.trim()}
                    onClick={() => void handleReplySubmit()}
                    type="button"
                  >
                    Post Reply
                  </button>
                  <button
                    className="shell__pillButton shell__pillButton--muted"
                    onClick={handleCopyAnnotation}
                    type="button"
                  >
                    Copy JSON
                  </button>
                </div>
              </>
            ) : (
              <div className="feedbackSurface__empty">
                Saved annotations will show their conversation thread here so the human and agent
                stay in sync.
              </div>
            )}
          </section>
        </div>
      </section>
    </main>
  );
};

export const App = (): JSX.Element => {
  const surfaceMode = getSurfaceMode();
  const chromeAppearanceState = useChromeAppearanceState();
  const sessionState = useSessionState();

  useEffect(() => {
    const cssVariables = getChromeAppearanceCssVariables(chromeAppearanceState);
    for (const [key, value] of Object.entries(cssVariables)) {
      document.documentElement.style.setProperty(key, value);
    }
  }, [chromeAppearanceState]);

  if (surfaceMode === 'feedback') {
    return <FeedbackSurface />;
  }

  if (surfaceMode === 'markdown') {
    return <MarkdownSurface />;
  }

  if (surfaceMode === 'mcp') {
    return <McpSurface />;
  }

  if (surfaceMode === 'project') {
    return (
      <ProjectSurface
        chromeAppearanceState={chromeAppearanceState}
        sessionState={sessionState}
      />
    );
  }

  if (surfaceMode === 'launcher') {
    return <LauncherSurface sessionState={sessionState} />;
  }

  return <ChromeSurface chromeAppearanceState={chromeAppearanceState} sessionState={sessionState} />;
};
