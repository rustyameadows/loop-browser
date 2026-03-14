import { useEffect, useRef, useState, type FormEvent, type JSX, type SVGProps } from 'react';
import {
  createEmptyMcpViewState,
  createEmptyMarkdownViewState,
  createEmptyNavigationState,
  createEmptyPickerState,
  type ElementDescriptor,
  type McpViewCommand,
  type McpViewState,
  type MarkdownViewCommand,
  type MarkdownViewState,
  type NavigationCommand,
  type NavigationState,
  type PickerCommand,
  type PickerState,
} from '@agent-browser/protocol';

const emptyState = createEmptyNavigationState();
const emptyPickerState = createEmptyPickerState();
const emptyMarkdownState = createEmptyMarkdownViewState();
const emptyMcpState = createEmptyMcpViewState();
const stubTabs = ['Agent Chat', 'Inspector'];

type SurfaceMode = 'chrome' | 'markdown' | 'mcp';

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

  return 'chrome';
};

const getActiveTabLabel = (state: NavigationState): string => {
  if (state.title && state.title !== 'Agent Browser') {
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
  const summaryParts = [selection.selector];
  if (selection.textSnippet) {
    summaryParts.push(selection.textSnippet);
  }

  return summaryParts.join(' | ');
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

const ChromeSurface = (): JSX.Element => {
  const navigationState = useNavigationState();
  const pickerState = usePickerState();
  const markdownViewState = useMarkdownViewState();
  const mcpViewState = useMcpViewState();
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
  const diagnosticLabel = navigationState.lastError ?? getQuietStatus(navigationState);
  const locationIcon = getLocationIcon(navigationState.url);
  const selection = pickerState.lastSelection;
  const inspectorHeading = pickerState.enabled
    ? 'Pick mode is active'
    : selection
      ? getSelectionHeading(selection)
      : 'DOM picker ready';
  const inspectorMeta = pickerState.enabled
    ? 'Click any element in the page, or press Esc to cancel.'
    : selection
      ? getSelectionMeta(selection)
      : 'Use the crosshair button or View > Toggle Pick Mode.';

  return (
    <main className="shell">
      <section className="shell__panel">
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
              AB
            </div>
          </div>
        </div>

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
              aria-label={`MCP status: ${mcpViewState.statusLabel}`}
              aria-pressed={mcpViewState.isOpen}
              className={`shell__pillButton shell__pillButton--mcp${
                mcpViewState.isOpen ? ' shell__pillButton--mcpActive' : ''
              }`}
              onClick={() =>
                void runMcpCommand({
                  action: mcpViewState.isOpen ? 'close' : 'open',
                })
              }
              title={mcpViewState.statusLabel}
              type="button"
            >
              <span
                aria-hidden="true"
                className={`shell__statusDot shell__statusDot--${mcpViewState.indicator}`}
              />
              <span>MCP Status</span>
            </button>
            <button aria-label="Load address" className="shell__goButton" type="submit">
              <ChromeIcon className="shell__icon" name="arrowUpRight" />
            </button>
          </div>
        </form>

        <div
          className={`shell__diagnostic${
            navigationState.lastError ? ' shell__diagnostic--error' : ''
          }`}
        >
          {diagnosticLabel}
        </div>

        <div
          className={`shell__selectionBar${
            pickerState.enabled ? ' shell__selectionBar--armed' : ''
          }${selection ? ' shell__selectionBar--filled' : ''}`}
        >
          <div className="shell__selectionCopy">
            <div className="shell__selectionTitle">{inspectorHeading}</div>
            <div className="shell__selectionMeta">{inspectorMeta}</div>
          </div>

          <div className="shell__selectionActions">
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

export const App = (): JSX.Element => {
  const surfaceMode = getSurfaceMode();

  if (surfaceMode === 'markdown') {
    return <MarkdownSurface />;
  }

  if (surfaceMode === 'mcp') {
    return <McpSurface />;
  }

  return <ChromeSurface />;
};
