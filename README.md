# Loop Browser

Loop Browser is a native macOS workspace app for human-and-agent workflows. It opens a local web
project, lets you arrange multiple live `WKWebView` viewports on an infinite canvas, and exposes a
local MCP server so external agents can inspect the current workspace and act on it.

Instead of treating a browser as a throwaway preview window, Loop Browser keeps project settings,
live routes, viewport layout, and local agent actions in one native workspace.

## What You Can Do

- Open a local project folder and restore its saved workspace state.
- Spawn, move, resize, reload, and close multiple live viewports on the canvas.
- Save project appearance, default startup URL, and an optional project icon in
  `.loop-browser.json`.
- Save repo-local agent login credentials in `.loop-browser.local.json`.
- Use `Use Agent Login` on matching-origin login pages without auto-submitting the form.
- Inspect the action log and current workspace state while MCP clients interact with the app.

## Opening A Project

On first launch, use `Open Project` and choose the root folder for the local site or app you want
to work on.

If the selected project has a `.loop-browser.json` file with `startup.defaultUrl`, Loop Browser
opens an initial viewport for that URL when the workspace is empty. A checked-in deterministic
fixture for native UI testing lives under
`apps/native-macos/TestFixtures/interactive-project`.

## Project Startup And Login

Loop Browser supports two project-level files for startup and login behavior:

- `.loop-browser.json`
  Checked in. Use this for shareable project settings like chrome colors, icon path, and the
  default startup URL.
- `.loop-browser.local.json`
  Repo-local. Use this for the actual agent login username and password. The app auto-adds this
  file to `.gitignore` when you save a login through the UI.

Example `.loop-browser.json`:

```json
{
  "version": 1,
  "chrome": {
    "chromeColor": "#FAFBFD",
    "accentColor": "#0A84FF",
    "projectIconPath": null
  },
  "startup": {
    "defaultUrl": "http://127.0.0.1:3000",
    "server": {
      "command": "bin/dev",
      "readyUrl": "http://127.0.0.1:3000"
    }
  }
}
```

Example `.loop-browser.local.json`:

```json
{
  "version": 1,
  "server": {
    "environment": {
      "PORT": "3000"
    }
  },
  "agentLogin": {
    "username": "dev@example.com",
    "password": "password123"
  }
}
```

In `Project Settings`:

- Set `Default URL`, optional colors, and optional project icon path, then click `Save Project Settings`.
- Set `Server Command`, optional `Working Directory`, and optional `Ready URL`, then click `Save Project Settings`.
- Enter `Agent login email or username` and `Agent login password`, then click `Save Login`.
- On matching login pages for that saved `Default URL` origin, `Use Agent Login` fills the visible
  login form without submitting it.

In the inspector `Project` card:

- Click `Start Server` to run the configured local command for the current project.
- Click `Stop` or `Restart` to manage the current project server without leaving the app.
- Watch the server status and recent output in the same card.

Legacy env-based login is still supported through `agentLogin.usernameEnv` and
`agentLogin.passwordEnv` in `.loop-browser.json`, but repo-local saved login is the preferred
workflow.

## Project Server Examples

Rails app:

```json
{
  "version": 1,
  "chrome": {
    "chromeColor": "#FAFBFD",
    "accentColor": "#0A84FF",
    "projectIconPath": null
  },
  "startup": {
    "defaultUrl": "http://127.0.0.1:3000",
    "server": {
      "command": "bin/dev",
      "readyUrl": "http://127.0.0.1:3000"
    }
  }
}
```

Static site:

```json
{
  "version": 1,
  "chrome": {
    "chromeColor": "#FAFBFD",
    "accentColor": "#0A84FF",
    "projectIconPath": null
  },
  "startup": {
    "defaultUrl": "http://127.0.0.1:3000/interactive-fixture.html",
    "server": {
      "command": "/usr/bin/python3 -m http.server 3000",
      "readyUrl": "http://127.0.0.1:3000"
    }
  }
}
```

Use `.loop-browser.local.json` for repo-local environment values or secrets that should not be
checked in. If `readyUrl` is omitted, Loop Browser falls back to `startup.defaultUrl` when
checking whether the server is live.

## MCP Integration

While the app is running, it starts a localhost JSON-RPC MCP server at `127.0.0.1`. On macOS, the
registration manifest is written to:

`~/Library/Application Support/Loop Browser Native/mcp-registration.json`

That manifest includes the local transport URL and bearer token header needed by tool clients.

The current MCP tools include:

- `session.list`
- `session.getCurrent`
- `workspace.get_state`
- `browser.listTabs`
- `browser.getWindowState`
- `page.navigate`
- `page.reload`
- `chrome.getAppearance`
- `chrome.setAppearance`
- `create_viewport`
- `create_viewports`
- `update_viewport_route`
- `update_viewport_size`
- `close_viewport`
- `refresh_viewport`
- `refresh_all_viewports`
- `edit_project_files`

The server also exposes a small read-only resource catalog for discovery:

- `loop-browser:///sessions`
- `loop-browser:///session/{sessionId}/summary`
- `loop-browser:///session/{sessionId}/workspace`

## Project Notes

- [Human-Agent Collaboration Guide](docs/human-agent-collaboration.md)
- [Native app spec](docs/mac-canvas-app-spec.md)
- [Native implementation plan](docs/mac-canvas-app-implementation-plan.md)

## Workspace Layout

- `apps/native-macos`: native app sources, Xcode project, tests, support package, and fixtures
- `scripts`: native packaging and UI stress helpers
- `docs`: product, architecture, and collaboration documentation

## CI

GitHub Actions runs native support-package tests, native app tests, and macOS packaging on pushes
to `main` and on pull requests.

## Build And Test

1. Run the Swift package tests for shared native support code.

```sh
swift test --package-path apps/native-macos/LoopBrowserNativeSupport
```

2. Run the app, unit, and UI tests.

```sh
HOME=/tmp xcodebuild \
  -project apps/native-macos/LoopBrowserNative.xcodeproj \
  -scheme LoopBrowserNative \
  -destination "platform=macOS,arch=arm64" \
  CODE_SIGN_IDENTITY="-" \
  CODE_SIGNING_ALLOWED=YES \
  test
```

3. Run optional native UI stress helpers.

```sh
./scripts/test-native-ui-stress.sh
./scripts/run-native-stress-tests.sh
```

4. Produce the packaged macOS app in `output/`.

```sh
./scripts/package-native-mac.sh
```

This writes:

- `output/Loop Browser.app`
- `output/Loop Browser-macOS.zip`

The `output/` directory is local build and test output and is not intended to be checked into
source control.
