import { useEffect, useState, type FormEvent, type JSX } from 'react';
import {
  createEmptyNavigationState,
  type NavigationCommand,
  type NavigationState,
} from '@agent-browser/protocol';

const emptyState = createEmptyNavigationState();

export const App = (): JSX.Element => {
  const [navigationState, setNavigationState] = useState<NavigationState>(emptyState);
  const [draftUrl, setDraftUrl] = useState('');
  const [isEditingAddress, setIsEditingAddress] = useState(false);

  useEffect(() => {
    let isMounted = true;

    const syncInitialState = async (): Promise<void> => {
      const initialState = await window.agentBrowser.getState();
      if (!isMounted) {
        return;
      }

      setNavigationState(initialState);
      setDraftUrl(initialState.url);
    };

    void syncInitialState();

    const unsubscribe = window.agentBrowser.subscribe((nextState) => {
      if (!isMounted) {
        return;
      }

      setNavigationState(nextState);
      if (!isEditingAddress) {
        setDraftUrl(nextState.url);
      }
    });

    return () => {
      isMounted = false;
      unsubscribe();
    };
  }, [isEditingAddress]);

  const runCommand = async (command: NavigationCommand): Promise<void> => {
    const nextState = await window.agentBrowser.execute(command);
    setNavigationState(nextState);
    if (command.action === 'navigate') {
      setDraftUrl(nextState.url);
      setIsEditingAddress(false);
    }
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    await runCommand({ action: 'navigate', target: draftUrl });
  };

  return (
    <main className="shell">
      <section className="shell__panel">
        <div className="shell__eyebrow">Trusted Chrome View</div>
        <form className="shell__controls" onSubmit={(event) => void handleSubmit(event)}>
          <div className="shell__buttons">
            <button
              className="shell__button"
              disabled={!navigationState.canGoBack}
              onClick={() => void runCommand({ action: 'back' })}
              type="button"
            >
              Back
            </button>
            <button
              className="shell__button"
              disabled={!navigationState.canGoForward}
              onClick={() => void runCommand({ action: 'forward' })}
              type="button"
            >
              Forward
            </button>
            <button
              className="shell__button"
              onClick={() => void runCommand({ action: navigationState.isLoading ? 'stop' : 'reload' })}
              type="button"
            >
              {navigationState.isLoading ? 'Stop' : 'Reload'}
            </button>
          </div>

          <label className="shell__address">
            <span className="shell__addressLabel">Address</span>
            <input
              autoCapitalize="off"
              autoCorrect="off"
              className="shell__input"
              onBlur={() => setIsEditingAddress(false)}
              onChange={(event) => setDraftUrl(event.target.value)}
              onFocus={() => setIsEditingAddress(true)}
              placeholder="https://example.com or file:///path/to/page.html"
              spellCheck={false}
              type="text"
              value={draftUrl}
            />
          </label>

          <button className="shell__launch" type="submit">
            Load
          </button>
        </form>

        <div className="shell__meta">
          <div>
            <div className="shell__metaLabel">Page Title</div>
            <div className="shell__metaValue">{navigationState.title}</div>
          </div>
          <div>
            <div className="shell__metaLabel">State</div>
            <div className="shell__metaValue">
              {navigationState.isLoading ? 'Loading' : 'Idle'}
            </div>
          </div>
        </div>

        {navigationState.lastError ? (
          <div className="shell__error" role="alert">
            {navigationState.lastError}
          </div>
        ) : (
          <div className="shell__hint">
            The app opens a local fixture on first launch. Popups from remote pages are denied in-app and
            plain http/https popups open in the default browser.
          </div>
        )}
      </section>
    </main>
  );
};
