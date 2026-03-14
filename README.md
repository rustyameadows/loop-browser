# Agent Browser

Agent Browser is the bootstrap monorepo for the macOS Electron browser shell described in [agent-browser-plan.md](agent-browser-plan.md). The first push includes a working Electron desktop shell, a shared protocol package for IPC typing, and GitHub Actions that package unsigned macOS development artifacts.

## Workspace Layout

- `apps/desktop`: Electron main process, trusted React chrome, and the embedded page view.
- `packages/protocol`: shared navigation command and navigation state types plus guard helpers.
- `packages/selector`: element descriptor normalization and selector generation for DOM pick mode.

## Local Setup

1. Install dependencies with `npm install`.
2. Start the desktop app with `npm run dev`.
3. Run checks with `npm run lint`, `npm run typecheck`, and `npm run test`.
4. Run the end-to-end MCP smoke with `npm run smoke:mcp`.
5. Build the unpackaged app with `npm run build`.
6. Produce a macOS zip artifact locally with `npm run package:mac`.

The desktop shell opens a checked-in `file://` fixture on first launch. Replace the address with any `https://`, `http://`, or `file://` target to exercise the page view. In-app popups are denied; plain `http/https` popup attempts are opened externally.

The chrome also includes a DOM pick mode. Use the crosshair button or `View > Toggle Pick Mode`, then click any page element to capture a structured descriptor. The selected descriptor stays in the trusted chrome until you clear it, and the JSON can be copied directly from the inspector strip.

The top toolbar now also includes `View as MD`. That button opens a dedicated trusted Markdown panel beside the page view, snapshots the active page DOM in the main process, converts it with Defuddle, and exposes the raw Markdown plus page metadata. Use the panel actions to copy or refresh the extracted Markdown for the current page.

The toolbar also includes `MCP Status`, a live red/yellow/green indicator for the local MCP server. That button opens a dedicated diagnostics panel with the current transport URL, registration manifest path, exposed tools, recent request activity, and a built-in self-test against `/health`, `initialize`, and `tools/list`.

While the app is running, the main process also starts a localhost JSON-RPC tool server at `127.0.0.1`. The current registration manifest is written to `~/Library/Application Support/Agent Browser/mcp-registration.json` on macOS and includes the URL plus bearer token header needed by local tool clients. The current tool set includes `browser.listTabs`, `page.navigate`, `picker.enable`, `picker.disable`, `picker.lastSelection`, and `page.viewAsMarkdown`.

For deterministic MCP verification, use `npm run smoke:mcp` for the full local flow, or `npm run smoke:mcp:dev` / `npm run smoke:mcp:packaged` after `npm run build`. The smoke harness launches the app with isolated `AGENT_BROWSER_USER_DATA_DIR`, `AGENT_BROWSER_TOOL_SERVER_PORT`, and `AGENT_BROWSER_START_URL` overrides so it never reuses your normal profile.

## CI Builds

The repo ships with `.github/workflows/push.yml`. On pull requests and on pushes to `main`, GitHub Actions installs dependencies, lints, typechecks, tests, packages the macOS app, and uploads the artifact as `agent-browser-macos-<commit-sha>`.

After the first successful push to `main`, make `main` the default branch in GitHub and enable branch protection so the Actions job stays green before merges.
