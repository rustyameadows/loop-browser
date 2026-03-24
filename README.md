# Loop Browser

Loop Browser is a desktop browser shell for human-and-agent workflows. It gives you a real page view, trusted app chrome, a local MCP server, and built-in tools for picking elements, leaving feedback, extracting Markdown, and capturing screenshots.

Instead of treating the browser like a black box, Loop Browser keeps the page, your notes, and the local tool surface in one place.

## What You Can Do

- Open `https://`, `http://`, or `file://` pages inside the app.
- Use Pick Mode to inspect a page element and keep a structured descriptor in the chrome.
- Open `Feedback Loop` to leave comments tied to the exact element you selected.
- Open `View as MD` to convert the current page into Markdown and copy the result.
- Open `MCP Status` to inspect the local tool server, registration details, and recent request activity.
- Capture screenshots of the page, an element, or the full app window through MCP tools.

## First Launch

The app opens a checked-in local fixture on first launch, so you can verify navigation before wiring it into anything else. From there, replace the address with any page you want to inspect.

Plain web popups are opened externally instead of spawning in-app popup windows.

## Project Startup And Login

Loop Browser supports two project-level files for startup and login behavior:

- `.loop-browser.json`
  Checked in. Use this for shareable project settings like chrome colors, icon path, and the default startup URL.
- `.loop-browser.local.json`
  Repo-local. Use this for the actual agent login username and password. The app auto-adds this file to `.gitignore` when you save a login through the UI.

Example `.loop-browser.json`:

```json
{
  "version": 1,
  "startup": {
    "defaultUrl": "http://127.0.0.1:3000"
  }
}
```

Example `.loop-browser.local.json`:

```json
{
  "version": 1,
  "agentLogin": {
    "username": "dev@example.com",
    "password": "password123"
  }
}
```

In the Project panel:

- Set `Default URL`, then click `Save Startup`.
- Enter `Agent login email or username` and `Agent login password`, then click `Save Login`.
- On matching login pages for that saved `Default URL` origin, the `Use Agent Login` button fills the visible login form without submitting it.

Startup URL precedence is:

1. `AGENT_BROWSER_START_URL`
2. `startup.defaultUrl` from `.loop-browser.json`
3. the built-in local fixture

Legacy env-based login is still supported through `agentLogin.usernameEnv` and `agentLogin.passwordEnv` in `.loop-browser.json`, but repo-local saved login is now the preferred path.

## MCP Integration

While the app is running, it starts a localhost JSON-RPC MCP server at `127.0.0.1`. On macOS, the registration manifest is written to:

`~/Library/Application Support/Loop Browser/mcp-registration.json`

That manifest includes the local transport URL and bearer token header needed by tool clients.

The current MCP tool set includes:

- `browser.listTabs`
- `browser.getWindowState`
- `browser.resizeWindow`
- `page.navigate`
- `page.reload`
- `picker.enable`
- `picker.disable`
- `picker.lastSelection`
- `feedback.getState`
- `feedback.list`
- `feedback.create`
- `feedback.reply`
- `feedback.progress`
- `feedback.setStatus`
- `page.viewAsMarkdown`
- `page.screenshot`
- `artifacts.get`
- `artifacts.list`
- `artifacts.delete`

The server also exposes a read-only MCP resource catalog for Codex-style discovery:

- `loop-browser:///sessions`
- `loop-browser:///session/{sessionId}/summary`
- `loop-browser:///session/{sessionId}/tabs`
- `loop-browser:///session/{sessionId}/window`
- `loop-browser:///session/{sessionId}/picker/selection`
- `loop-browser:///session/{sessionId}/feedback`
- `loop-browser:///session/{sessionId}/page/markdown`
- `loop-browser:///session/{sessionId}/artifacts`

Phase 1 of the resource surface is intentionally read-only. It does not expose prompts, SSE streams, subscriptions, or list-changed notifications yet.

Screenshot results are artifact-backed. The tool server stores them under the app data directory and returns metadata plus an `artifactId`, which you can resolve later through `artifacts.get`.

## Project Notes

- [Human-Agent Collaboration Guide](docs/human-agent-collaboration.md)
- [Original product plan](agent-browser-plan.md)

## Workspace Layout

- `apps/desktop`: Electron app, trusted React chrome, and embedded page view.
- `packages/protocol`: shared command/state types and guards.
- `packages/selector`: DOM selector normalization and Playwright-style locator helpers.
- `scripts/mcp-smoke.mjs`: local MCP smoke harness for dev and packaged verification.

## CI

GitHub Actions installs dependencies, lints, typechecks, tests, builds the app, runs the MCP smoke checks, and packages a macOS artifact on pushes to `main` and on pull requests.

## Build Steps

1. Install dependencies.

```sh
npm install
```

2. Start the app in development mode.

```sh
npm run dev
```

3. Run the standard checks.

```sh
npm run lint
npm run typecheck
npm run test
```

4. Build the packaged desktop app.

```sh
npm run build
```

5. Verify MCP behavior.

Full flow:

```sh
npm run smoke:mcp
```

Or run them separately after `npm run build`:

```sh
npm run smoke:mcp:dev
npm run smoke:mcp:packaged
```

The smoke harness launches the app with isolated `AGENT_BROWSER_USER_DATA_DIR`, `AGENT_BROWSER_TOOL_SERVER_PORT`, and `AGENT_BROWSER_START_URL` overrides so it does not reuse your normal profile.

6. Produce the native macOS app in `output/`.

```sh
npm run package:mac
```

This writes:

- `output/Loop Browser.app`
- `output/Loop Browser-macOS.zip`

The `output/` directory is local build and test output and is not intended to be checked into source control.

The package step builds the native app artifact only. Run the native stress tests separately when you want to validate interaction behavior.

If you need the Electron package instead, run:

```sh
npm run package:desktop:mac
```

7. If the packaged smoke test fails on full-window screenshots on macOS, grant Screen Recording permission to `Loop Browser.app` and rerun the smoke test.
