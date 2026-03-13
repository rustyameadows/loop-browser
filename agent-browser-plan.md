# macOS Electron Browser Shell with Agent UI, MCP Sidecar, and Playwright Runtime

## Executive summary

Building this as an Electron app is a pragmatic “max capability, fastest iteration” path for a macOS desktop browser shell that must load arbitrary web content, provide a DOM-picking UX, and double as an automation runtime. Electron gives you a full Chromium-based renderer, a mature process model, and deep control over webContents lifecycles and embedding (the same primitives you need to act like a real browser). Electron’s current embedding direction is to use `WebContentsView` + `BaseWindow` (with `BrowserView` deprecated since Electron v29). citeturn24view0turn10view0turn9view0

For automation, you can support **two Playwright modes**:

- **App-mode (launch)**: use Playwright’s experimental Electron automation (`_electron.launch`) to launch your app deterministically in CI and introspect the Electron main process (useful for test-only hooks and stable orchestration). citeturn12view0turn21view1turn12view1  
- **Page-mode (attach)**: enable Electron’s `--remote-debugging-port` and attach Playwright via `chromium.connectOverCDP()` to treat your running app’s Chromium instance as the automation target. This is particularly attractive when your “tabs” are `WebContentsView`s (not separate `BrowserWindow`s) and when you want agents to drive a persistent interactive instance. Note that CDP attachment is explicitly “lower fidelity” than the Playwright protocol connection, so you should treat it as a best-effort mode and design fallbacks. citeturn15search1turn15search4turn16view0

For multi-agent communication and tool invocation, implement an **MCP-like sidecar** as the broker and tool server. The MCP spec’s JSON-RPC lifecycle (initialize → initialized → operation), transports (stdio + Streamable HTTP), and security warnings (Origin validation, bind to localhost, authentication) map well to your needs. citeturn18view0turn18view1turn17view3

Finally, design for a future migration to a smaller native surface (e.g., WKWebView or Tauri) by keeping your agent protocol, page-action API, element descriptor schema, and artifact pipeline **renderer-agnostic**. `WKWebView` + message handlers can replace Electron IPC later, and Tauri’s capability-gated IPC model is a useful conceptual reference for hardening untrusted-content interactions. citeturn6search0turn6search5turn6search29turn6search1

## Architecture and recommended stack

### Versioning and platform constraints

As of **March 13, 2026**, Electron stable is in the **39.x** line (with Electron releases tracking Chromium closely). Electron’s support policy is to support the **latest three stable major versions**, and newer embedding APIs (`BaseWindow`, `WebContentsView`) are already mainstream while `BrowserView` is deprecated. citeturn1search0turn22view0turn24view0turn9view0

**Recommendation (ranges, not pins):**

- **Electron**: use a currently supported major (today: 39.x; keep headroom to move within the newest 3 majors). Prefer `WebContentsView`/`BaseWindow` (and avoid `BrowserView`). citeturn1search0turn22view0turn24view0turn10view0turn9view0
- **Node / TypeScript**: develop on an **Active LTS Node** for your toolchain (Node 24 is Active LTS as of late Feb 2026; Node schedules are evolving, but you generally want an LTS line for build reproducibility). citeturn1search6turn1search2  
  (Electron embeds its own Node version in the runtime; your dev/build Node is separate. Electron’s release docs explicitly discuss Node version support and upgrades. citeturn22view0)
- **UI stack**: TypeScript + React (renderer UI), with a lightweight state container (Zustand/Redux) and a strongly typed shared protocol package for IPC payloads.
- **Playwright**: use `@playwright/test` for CI and “agent-run tests,” but architect so “agent runtime” can use either `_electron.launch` or CDP attach depending on whether you control process launch. citeturn21view1turn12view0turn16view0

### High-level component graph

Use Electron’s multi-process model explicitly:

- **Main process**: owns window creation, tab lifecycles, security policy, and all privileged OS integration.
- **UI renderer** (trusted, local): the browser chrome (address bar, tabs) and the chat/agent panel.
- **Page renderers** (untrusted): one per tab (`WebContentsView`), with strict `webPreferences` and a minimal preload that implements DOM picking and a narrow “page bridge.” citeturn24view2turn6search3turn8view0turn9view0

Mermaid architecture diagram:

```mermaid
flowchart LR
  subgraph App["Electron App (macOS)"]
    subgraph Main["Main process"]
      TabMgr["Tab/Session Manager"]
      SecPol["Security Policy & Permission Gate"]
      Bridge["IPC Router (validated sender)"]
      CDPFlag["Remote Debug Port (dev/test only)"]
    end

    subgraph UI["UI Renderer (Trusted)"]
      Chrome["Browser Chrome (Tabs/URL bar)"]
      Chat["Chat/Agent Panel"]
      UiIPC["contextBridge API (safe wrapper)"]
    end

    subgraph Tabs["Page Tabs (Untrusted WebContentsView x N)"]
      Tab1["Tab WebContentsView"]
      TabN["..."]
      Picker["DOM Picker Preload (isolated world)"]
    end

    Main -->|creates/views| Tabs
    Main -->|creates| UI
    UI -->|invoke| UiIPC --> Bridge --> Main
    Picker -->|ipcRenderer (no global exposed)| Bridge

  end

  subgraph Sidecar["Agent Sidecar (MCP-like server)"]
    MCPServer["JSON-RPC Tool Server\n(Streamable HTTP + optional UDS/WebSocket)"]
    Router["Multi-agent Router\n(agentId → tabId)"]
    Automator["Playwright Driver\n(app-mode or CDP attach)"]
    Artifacts["Artifact Store\n(snapshots, traces, screenshots)"]
  end

  Chat <-->|events/commands| MCPServer
  MCPServer --> Router --> Automator
  Automator <-->|CDP| CDPFlag
  MCPServer --> Artifacts
  Main <-->|internal control channel| MCPServer
```

Key architectural principle: treat **web pages as hostile**. Your DOM picker and page-action primitives must not expand the attack surface of “untrusted page renderer → privileged main process.” Electron’s docs explicitly recommend isolation/sandboxing and validating IPC senders. citeturn6search3turn24view2turn5search30

## Browser shell implementation plan

### Windowing and embedding strategy

Use `BaseWindow` and add two kinds of views:

- a **UI `WebContentsView`** that loads your local React bundle
- one **page `WebContentsView` per tab**, each with its own `webPreferences` and (optionally) its own session partition for isolation (cookies/cache separation). citeturn9view0turn10view0turn24view2

This aligns with Electron’s current embedding direction; `BrowserView` is deprecated and `WebContentsView` is its replacement. citeturn24view0turn10view0

### Navigation behavior

Implement classic browser actions using `webContents`:

- load URL
- stop / reload
- back / forward
- navigation event listeners to update address bar, display load progress, and maintain history.

Electron’s `webContents` API provides these primitives; note that `goBack()/goForward()` are deprecated in favor of newer navigation APIs, which is an important maintenance detail for a “browser-like” shell. citeturn7view0

Popups/new windows: use `webContents.setWindowOpenHandler()` to either deny, open in a new tab, or open in an external browser. This is now the recommended approach; Electron removed the old `new-window` event and documents `setWindowOpenHandler()` as the main-process override point with final authority over window creation/security preferences. citeturn7view2turn24view1

### Local and custom URL support

You can support:

- `https://` and `http://` normally
- `file://` (local pages) with clear UX warnings (“local file access”) and conservative defaults
- optionally a **custom `app://` scheme** for your own UI assets (avoids `file://` quirks and lets you control origin/security characteristics)

Electron recommends `protocol.handle()` for custom protocols; it also documents scheme registration as “privileged” (standard/secure/fetch support) and highlights the security implications of path traversal—your handler must reject escapes like `../..`. citeturn11view0

### Suggested repository layout and core modules

A structure that keeps protocols and types centralized:

- `apps/desktop/` (Electron main + renderers)
- `apps/sidecar/` (MCP-like server + Playwright)
- `packages/protocol/` (shared JSON schemas + TS types)
- `packages/selector/` (selector generation + element descriptor normalization)
- `packages/testkit/` (Playwright harness + fixtures)

Recommended “8–12 components” (you can implement as React components + main-process services):

1. `WindowShell` (UI layout orchestration: bounds for views)
2. `TabStrip`
3. `AddressBar`
4. `NavigationControls`
5. `WebContentsViewHost` (manages tab view bounds and focus)
6. `AgentChatPanel`
7. `AgentSessionSwitcher` (agentId/appId routing UI)
8. `DomPickerToggle` (on/off, mode selection)
9. `ElementInspectorPanel` (shows selected element summary + “send to agent”)
10. `DownloadsAndPermissions` (UI surface for downloads, camera/mic prompts)
11. `Settings` (security prefs, debug/automation toggles)
12. `DevToolsControls` (dev-only toggles, remote debug/trace capture)

## Agent UI and DOM element selection design

### Secure preload & contextBridge patterns (two different trust zones)

You will likely want **two different preload strategies**:

- **UI renderer preload (trusted)**: expose a narrow, typed API via `contextBridge.exposeInMainWorld()` to call `ipcRenderer.invoke()` wrappers (never expose raw `ipcRenderer`). Electron explicitly documents that exposing `ipcRenderer` wholesale is a security footgun and, since Electron 29, it cannot be sent over `contextBridge` anyway—use safe wrapper functions. citeturn8view0turn5search3  
- **Page tab preload (untrusted)**: do **not** expose an API on `window` at all. Instead, the preload listens for main-process commands (via `ipcRenderer.on`) and emits selection events to the main process. This reduces the chance of a hostile page invoking privileged operations.

Additionally, Electron’s security guidance explicitly calls out validating the sender of IPC messages, because any frame can potentially send IPC under some conditions; you should enforce origin/frame checks on every privileged handler. citeturn5search30turn6search3

### DOM picker overlay UX

A robust “visual pick” system typically has:

- **Hover highlight**: on mousemove (with throttling), compute `elementFromPoint()`, draw an overlay box aligned with `getBoundingClientRect()`.
- **Click-to-select**: capture click in the preload, `preventDefault()` and `stopPropagation()` in “pick mode,” freeze selection.
- **Keyboard modifiers**:
  - `Alt` / `Option`: walk up parent chain (pick ancestor)
  - `Shift`: cycle through stacked elements at point (z-index conflicts)
  - `Esc`: exit pick mode

Because your target pages are arbitrary, expect hostile/odd CSS (transforms, iframes, shadow DOM). Start with “good enough for most DOM,” then iterate.

### Element descriptor payload schema

Your requested payload fields are well-chosen for tool use. A practical schema must also be **bounded** (token efficient) and **replayable** (agents should be able to re-identify the element later).

Use a structured payload, returned to the agent side as JSON, but keep large blobs optional and capped.

Example schema (conceptual):

- `selector`: a “best-effort stable selector” (Playwright-like priority: role/text/testid → id → robust CSS path)
- `xpath`: optional, best-effort (some agents prefer it)
- `tag`, `id`, `classList`
- `textSnippet`: trimmed visible text (e.g., 120 chars)
- `bbox`: `{ x, y, width, height }` in CSS pixels + `devicePixelRatio`
- `attributes`: whitelist common attributes (e.g., `name`, `type`, `href`, `aria-*`, `data-testid`)
- `outerHTMLExcerpt`: trimmed (e.g., 500–1,500 chars)
- `frame`: `{ url, isMainFrame }` and (optional) a frame path

Selector generation options:

- Use Playwright’s own locator heuristics as your mental model (“codegen prioritizes role, text, and test id locators,” and improves when ambiguous). citeturn5search0turn5search4  
- Or integrate a dedicated CSS selector generator (e.g., `@medv/finder`, which is designed to generate short, unique selectors). citeturn5search2

## MCP-like sidecar protocol and Playwright integration

### Why an MCP-like sidecar is a good fit

The MCP spec gives you:

- a well-defined **JSON-RPC lifecycle** (initialize → initialized → operate), including the rule that `initialize` must not be batched citeturn18view0  
- a standard “tools” surface with **structured results** and optional output schema validation (useful for returning element descriptors and page snapshots predictably) citeturn20view0turn20view2  
- standard transports:
  - **stdio**: simplest local subprocess transport (newline-delimited JSON-RPC; no embedded newlines) citeturn17view3turn3search1  
  - **Streamable HTTP**: multi-client server mode with explicit security requirements (Origin validation, bind to localhost, authentication) citeturn17view3turn18view1  
- an authorization model for HTTP-based transports built on OAuth 2.1 / protected resource metadata (for “remote” sidecar scenarios, even if “remote” is still on localhost). citeturn19search0turn19search2

Given your requirement for “many agents/apps concurrently,” Streamable HTTP (or a WebSocket/UDS custom transport) is the more natural fit than stdio, because stdio is inherently 1:1 between a parent process and a subprocess. citeturn17view3turn17view2

### Transport and deployment options comparison

| Option | Multi-client | Latency/overhead | Security boundary | Streaming | Best for |
|---|---:|---:|---|---|---|
| Electron IPC (`ipcRenderer.invoke`) | N/A (in-app) | Very low | Depends on sender validation; must treat pages as hostile citeturn5search3turn5search30 | Yes (events) | UI ↔ main process control plane |
| MCP stdio (newline-delimited JSON-RPC) | No (1 client) | Low | OS process boundary; stdout/stderr discipline required citeturn17view3turn3search1 | Limited (notifications) | Single-agent local tooling |
| MCP Streamable HTTP (localhost) | Yes | Medium | Must validate Origin + authenticate + bind to 127.0.0.1 citeturn17view3turn18view1 | Yes (SSE optional per request / server messages) citeturn17view3turn18view1 | Many agent clients, local desktop runtime |
| WebSocket JSON-RPC (custom transport) | Yes | Low | Requires your own Origin/auth rules | Yes (natural) | High-throughput local agent control |
| Unix domain socket JSON-RPC (custom) | Yes | Very low | Strong local-only boundary via filesystem permissions | Yes | A “local daemon” feel on macOS |
| gRPC (custom) | Yes | Medium | Strong typing + mTLS if remote; more complexity | Yes | If you want strict schemas and perf at scale |

A practical approach is:

- MVP: **Streamable HTTP on localhost** (matches MCP spec, supports many clients) citeturn17view3turn18view1  
- Perf upgrade: add UDS/WebSocket as an “advanced” transport while keeping the same JSON-RPC methods and schemas (MCP explicitly allows custom transports as long as you preserve JSON-RPC message format/lifecycle). citeturn3search1turn17view3

### Message types and routing model (MCP-like)

You can mirror MCP’s core and add a browser domain:

- Core lifecycle:
  - `initialize`, `notifications/initialized` citeturn18view0  
- Tool registry:
  - `tools/list`, `tools/call`, `notifications/tools/list_changed` citeturn20view1turn17view1  
- Cancellation and progress:
  - `notifications/cancelled` for long-running calls (snapshots, traces) citeturn19search1turn19search19  

Browser/tool methods (examples):

- `browser.createTab`, `browser.closeTab`, `browser.listTabs`
- `page.navigate`, `page.click`, `page.type`, `page.query`, `page.extract`, `page.snapshot`, `page.screenshot`
- `picker.enable`, `picker.disable`, `picker.lastSelection`
- `artifacts.get`, `artifacts.list`, `artifacts.delete`

**Identity and routing**: adopt an explicit tuple on every request:

- `clientId` (the MCP connection identity)
- `agentId` (logical agent identity within that client)
- `tabId` (the target browsing context)
- Optional `runId` / `traceId` for auditability

This is important because MCP’s own architecture emphasizes hosts managing multiple clients/servers while keeping boundaries clear; your sidecar is effectively a host that must avoid “identity confusion.” citeturn17view2turn19academia33

### Auth/token model

For a local desktop sidecar, you usually want security properties without OAuth ceremony:

1. **Local-only binding**: bind Streamable HTTP to `127.0.0.1` and reject requests whose `Origin` is not your app (or not on an allowlist). MCP’s transport spec explicitly calls out Origin validation and localhost binding to prevent DNS rebinding attacks. citeturn17view3turn18view1  
2. **Session bearer token**: on first launch, mint a random token (stored in the user’s app data directory) and require `Authorization: Bearer …` on every request (even on localhost). MCP’s authorization guidance for HTTP transports is OAuth-based for “protected servers,” but the same “bearer token in Authorization header” shape is consistent with the spec and avoids query-string leakage. citeturn19search2turn19search0turn19search8  
3. Remote option: if you ever expose the sidecar beyond localhost, implement the MCP authorization model (OAuth 2.1 resource server + protected resource metadata) rather than inventing your own. citeturn19search0turn19search2

### Token-efficient data handling (structured + artifacts)

MCP tools support:

- structured JSON results (`structuredContent`) with an optional output schema citeturn20view2turn17view1  
- base64-encoded images (but these can be huge) citeturn20view0  
- resource links to fetch additional content separately citeturn20view0

Recommendation:

- For small results (element descriptor, text extraction), return structured JSON directly.
- For large blobs (full DOM snapshot, screenshot, trace zip), return:
  - an `artifactId`
  - size metadata
  - a resource link (or a separate `artifacts.get` tool) that streams/returns bytes.

This keeps routine tool traffic small while still enabling “deep extraction when requested.”

### Playwright automation modes and deterministic hooks

#### App-mode (launch)

Use `_electron.launch` when you control process creation; Electron’s own testing docs show this pattern and emphasize that Playwright Electron support is based on Electron’s CDP capabilities. citeturn21view1turn12view0turn21view0

Key advantages:

- determinism (fresh profile, clean state)
- main-process introspection (`electronApp.evaluate(({app}) => …)`)
- stable CI operation

Caveat: Playwright warns about Electron specifics (supported Electron versions, and known issues like ensuring the `nodeCliInspect` fuse is not disabled). citeturn12view0turn4search7

#### Page-mode (attach via CDP)

Enable `--remote-debugging-port` (via CLI or `app.commandLine.appendSwitch('remote-debugging-port', 'PORT')`) and attach Playwright via `chromium.connectOverCDP('http://localhost:PORT')`. Electron documents the flag and the command-line APIs, and Playwright documents CDP attachment and explicitly notes its lower fidelity vs the Playwright protocol. citeturn15search1turn15search4turn16view0

This mode is especially useful for:

- long-lived interactive sessions (a user browsing while agents operate)
- controlling `WebContentsView` tabs that are not separate `BrowserWindow`s

Deterministic test hooks (recommended):

- In **test mode only** (env var like `E2E=1`), expose:
  - a “tab registry” endpoint in the sidecar: stable `tabId → { url, title, webContentsId }`
  - a debug command to force navigation complete waits
  - a stable selector policy setting (e.g., prefer `data-testid` if present)

Electron’s testing docs also mention building a “custom test driver” using Node IPC; that same concept maps to creating an explicit “control plane” for determinism rather than relying on brittle UI event timing. citeturn21view0

## Testing, CI/CD, security, and migration path

### Testing strategy

Layer tests so failures are diagnosable:

- **Unit tests** (pure TS): selector generation, payload normalization, schema validation.
- **Integration tests** (renderer + preload in a harness): DOM picker correctness on a local test page with tricky layouts (fixed/sticky, shadow DOM basic cases, iframes).
- **E2E tests (Playwright)**:
  - launch mode: `_electron.launch` to validate app boot + UI wiring citeturn21view1turn12view1  
  - attach mode: `connectOverCDP` to validate “agent driving a persistent instance” flows citeturn16view0turn15search1

For authoring selectors/tests, Playwright’s codegen “Pick locator” flow is a useful bootstrap even if you don’t use its output verbatim—it reflects Playwright’s stability heuristics. citeturn5search0turn5search4

### CI/CD and “push” workflow (dev artifacts)

A clean workflow split:

- On **push to main**: build unsigned dev artifacts + run tests + upload artifacts.
- On **tag (vX.Y.Z)** or manual workflow dispatch: build, sign, notarize, staple, and upload release artifacts.

Electron’s docs emphasize that macOS distribution typically requires both **code signing and notarization** to avoid OS warnings; the Electron ecosystem supports this with tools like Electron Forge and `@electron/notarize`. citeturn23view0turn23view1turn23view2

macOS notarization also typically implies hardened runtime and careful entitlements; `@electron/notarize` explicitly calls out hardened runtime and relevant entitlements. citeturn23view2turn23view1

### Security considerations (must-haves for arbitrary remote content)

Minimum baseline for page tabs:

- `nodeIntegration: false` (default false) citeturn24view2  
- `contextIsolation: true` (Electron recommends it; disabling it undermines security and interacts badly with sandboxing) citeturn6search3turn8view0  
- `sandbox: true` (default true since Electron 20; note it disables Node.js engine in the renderer) citeturn24view2turn6search3  
- Keep preloads minimal and do not expose privileged APIs to page JS.
- Validate IPC sender/frame/origin for every privileged action. citeturn5search30turn6search3
- Carefully gate window creation with `setWindowOpenHandler` and ensure child windows inherit safe webPreferences. citeturn7view2turn24view1

Also: avoid `<webview>` unless you have a strong reason. Electron’s security guidance notes that `<webview>` can be created by scripts running on your website and can expand your attack surface; using `WebContentsView` keeps embedding under main-process control. citeturn4search15turn24view0turn10view0

### Performance and memory tradeoffs

- Each tab as a separate `WebContentsView` is closer to “real browser” semantics, but it costs memory (multiple renderer processes and caches).
- `BaseWindow` requires explicit cleanup: Electron docs warn that `webContents` for `WebContentsView` are not destroyed automatically when a `BaseWindow` closes—if you don’t close them, you will leak memory. citeturn9view0
- CDP attach via `connectOverCDP` is lower fidelity (so some advanced Playwright features may not behave identically). Design your tool API to degrade gracefully and provide “capability flags” so agents know what’s available. citeturn16view0

### Migration path to WKWebView / Tauri later

If you later decide Electron is too heavy for production, keep your abstractions:

- “Browser runtime” interface (navigate/click/type/snapshot)
- element descriptor schema
- sidecar JSON-RPC method surface

Then you can swap renderers:

- **WKWebView**: a platform-native web view; for JS→native communication you typically use WebKit message handlers (e.g., `WKScriptMessageHandler`) and a content controller. citeturn24view3turn6search0  
- **Tauri**: emphasizes a capability-gated IPC layer and documents isolation concepts designed to defend against untrusted frontend content. Even if you don’t adopt Tauri, its model is a good reference for “untrusted UI calling privileged commands.” citeturn6search5turn6search29turn6search1

## Prioritized backlog

| Priority | Issue title | Outcome |
|---|---|---|
| P0 | Kickoff: Electron browser shell scaffold | App boots on macOS; `BaseWindow` + UI view; dev loop works |
| P0 | PUSH: GitHub Actions dev build artifacts | On push: build + test + upload artifacts |
| P0 | Tabs + navigation core | Load arbitrary URLs, back/forward/reload, handle `window.open` |
| P1 | WebContentsView tab isolation + session partitions | Per-tab isolation and stable tab registry |
| P1 | DOM Picker overlay + element descriptor schema | Click-to-select produces structured payload |
| P1 | Sidecar MVP (Streamable HTTP) + tool registry | Multi-client tool invocation works on localhost |
| P1 | Playwright attach/launch harness + deterministic hooks | CI launch tests + attach mode for persistent runtime |
| P2 | Artifact store + snapshots/screenshots | Efficient blob handling + retrieval |
| P2 | Multi-agent routing + concurrency controls | AgentId → tabId; per-tab locks; batching |
| P2 | Security hardening pass | Sender validation, permissions, CSP approach |
| P3 | Packaging + signing + notarization path | Release-grade mac build pipeline |
| P3 | Optional selector-generator integration | Better selectors, less flaky agent actions |
| P3 | Native migration spike | Evaluate WKWebView/Tauri parity, document gaps |

```markdown
# Issue: Kickoff — Starter Electron Browser Shell (macOS)

## Goal
Create a minimal Electron app that behaves like a “browser shell” foundation:
- A window with browser chrome (URL bar + back/forward/reload placeholders)
- A single embedded web content area
- Loads arbitrary remote URLs (https/http) and local URLs (file://) manually entered

## Scope
In scope:
- Electron main process bootstrap
- BaseWindow + WebContentsView embedding
- React UI renderer (basic layout)
- One tab (single WebContentsView) with navigation wiring
- Safe webPreferences baseline for the page view (nodeIntegration off, contextIsolation on, sandbox on)

Out of scope:
- Multi-tab UI
- Agent chat panel
- Sidecar/MCP
- Playwright

## Acceptance Criteria
- App launches on macOS (dev mode) and shows a URL input
- Entering a URL loads it in the content view
- Back/Forward/Reload buttons call into main process and act on the current webContents
- window.open is handled (deny or open externally; document current behavior)
- No raw ipcRenderer exposed to the page; UI uses contextBridge wrapper

## Implementation Notes
- Use BaseWindow + WebContentsView (avoid BrowserView)
- Create two views: uiView (loads local React bundle) and pageView (loads URLs)
- Use strict TypeScript and shared types for IPC payloads

## Tasks
- [ ] Initialize repo scaffold (Electron + TS + React)
- [ ] Implement BaseWindow creation and add uiView + pageView
- [ ] Wire URL bar submit → main process → pageView.webContents.loadURL()
- [ ] Implement reload/stop/back/forward plumbing
- [ ] Add navigation event listeners to update URL bar (best-effort)
- [ ] Add setWindowOpenHandler default behavior
- [ ] Document webPreferences used for pageView

## Definition of Done
- App runs locally with a simple dev script
- Basic navigation works reliably on 3+ test sites and a local file
- Minimal logging and no obvious security footguns (no nodeIntegration, no unsafe globals)
```

```markdown
# Issue: PUSH — GitHub Actions Workflow for Dev Builds + Artifacts

## Goal
On every push to main (and on PRs), run CI that:
- Installs deps
- Typechecks + lints
- Runs unit tests
- Builds a macOS dev artifact (unsigned is fine)
- Uploads artifacts for download (zip/dmg/app)

## Scope
In scope:
- GitHub Actions workflow(s)
- Caching strategy (node_modules/playwright browsers if needed)
- Artifact naming, retention, and build metadata (commit SHA)

Out of scope:
- Release signing/notarization (separate issue)
- Auto-updater

## Acceptance Criteria
- On push to main: workflow completes successfully on macOS runner
- Produces downloadable artifact(s) for the desktop app
- CI status required for merge (branch protection recommendation documented)
- Clear logs for build failures

## Implementation Notes
- Use a macOS GitHub-hosted runner
- Suggested steps:
  1) checkout
  2) setup-node (LTS)
  3) install deps
  4) lint/typecheck/test
  5) package/build (Electron Forge or electron-builder)
  6) upload-artifact
- Ensure secrets are not required for dev builds

## Tasks
- [ ] Add .github/workflows/push.yml
- [ ] Add caching (npm/yarn/pnpm) + optional Playwright browser cache
- [ ] Build command produces deterministic output path
- [ ] Upload artifact with commit SHA in name
- [ ] Add README section: “Where to download CI builds”

## Definition of Done
- A contributor can push a branch and retrieve a macOS build artifact from Actions
- Workflow runtime is reasonable and consistently under control
```

```markdown
# Issue: Tabs + Navigation Core (Multi-tab WebContentsView)

## Goal
Implement real browser-like multi-tab behavior (within a single window):
- Create/close/switch tabs
- Each tab is a WebContentsView
- Track per-tab URL/title/loading state
- Keyboard shortcuts: Cmd+L (focus URL), Cmd+T (new tab), Cmd+W (close tab), Cmd+[ / Cmd+] (back/forward)

## Acceptance Criteria
- At least 5 tabs can exist simultaneously and switch without visual glitches
- Closing the window closes/destroys tab webContents to avoid leaks
- setWindowOpenHandler opens links in a new tab (policy-driven)
- History/back-forward works per tab

## Tasks
- [ ] TabManager service in main process
- [ ] UI TabStrip + tab switching wiring
- [ ] Implement window.open policy: deny / external / new-tab
- [ ] Add keyboard shortcuts

## Notes
- Ensure BaseWindow closure explicitly closes tab webContents
```

```markdown
# Issue: Session Partitions + Storage Isolation per Tab/Agent

## Goal
Support isolated browsing contexts so:
- Tabs can share or isolate cookies/storage intentionally
- Agents can be assigned dedicated “profiles” without interfering with each other

## Acceptance Criteria
- Tab creation supports a partition mode:
  - shared default
  - per-tab ephemeral
  - per-agent persistent (persist:agent-<id>)
- UI can show which partition a tab is using (debug view)
- Custom protocol handlers (if any) remain functional under non-default sessions

## Tasks
- [ ] Partition strategy + mapping (tabId → partition)
- [ ] UI: debug indicator for partition
- [ ] Verify custom protocol registration works for non-default sessions
```

```markdown
# Issue: DOM Picker Overlay (Hover + Click) in Page Preload

## Goal
A user can visually pick an element on any loaded page and see a highlight box.
On click, capture a structured element descriptor.

## Acceptance Criteria
- Toggle “Pick Mode” from UI
- Hover highlights the element under cursor
- Click selects element and returns descriptor to UI
- Esc exits pick mode
- Works on at least: normal DOM, fixed headers, scrollable containers, basic iframes (main-frame only is acceptable for MVP)

## Tasks
- [ ] Implement picker state machine in page preload
- [ ] Overlay rendering (DOM element + injected CSS)
- [ ] Bounding box computation
- [ ] Serialize descriptor and send to main process
- [ ] UI displays descriptor summary
```

```markdown
# Issue: Element Descriptor Schema + Normalization

## Goal
Define and implement the canonical payload for selected DOM elements.
Make it token-efficient and stable across time.

## Acceptance Criteria
- Descriptor includes:
  - selector (primary)
  - xpath (optional)
  - tag, id, classList
  - textSnippet
  - bbox + devicePixelRatio
  - attributes (whitelist + aria/data-testid)
  - outerHTMLExcerpt (capped)
  - frame url metadata
- Payload size caps documented and enforced
- A “copy to clipboard” button copies JSON

## Tasks
- [ ] Define schema in shared package
- [ ] Implement normalization rules (trim, cap, whitelist)
- [ ] Add optional selector generator integration hook
```

```markdown
# Issue: Sidecar MVP — MCP-like Tool Server (Streamable HTTP on localhost)

## Goal
Implement a sidecar server that supports many concurrent agent clients.
Expose browser control tools and picker integration tools.

## Acceptance Criteria
- Server supports initialize → initialized lifecycle
- tools/list returns available tools
- tools/call supports at least:
  - browser.listTabs
  - browser.createTab
  - page.navigate
  - page.screenshot (returns artifact id)
  - picker.lastSelection
- Runs on localhost only by default
- Requires an Authorization bearer token (locally generated)

## Tasks
- [ ] Implement Streamable HTTP endpoint
- [ ] Implement auth + origin checks
- [ ] Tool registry + JSON schemas
- [ ] Connection/session management (clientId)
- [ ] Basic logging + structured errors
```

```markdown
# Issue: Multi-agent Routing + Concurrency Controls

## Goal
Allow many agents/apps to operate concurrently without stepping on each other:
- Route tool calls by agentId → tabId/profileId
- Serialize actions per tab (lock/queue)
- Permit parallelism across tabs

## Acceptance Criteria
- Concurrent tool calls on different tabs do not block each other
- Concurrent tool calls on the same tab are queued deterministically
- Cancellation support for long-running operations
- Batching support for multi-step actions when possible

## Tasks
- [ ] Agent registry + routing table
- [ ] Per-tab async queue with cancellation
- [ ] Add batch execution API (best-effort)
```

```markdown
# Issue: Playwright Harness — App-mode Launch Tests

## Goal
Add Playwright tests that launch Electron app in CI and validate:
- App boots
- UI loads
- A page can be navigated
- Screenshot can be captured

## Acceptance Criteria
- A Playwright test suite runs in CI on macOS
- Uses _electron.launch
- Produces screenshots/traces as artifacts on failure
- Documents how to run locally

## Tasks
- [ ] Add @playwright/test config
- [ ] Add smoke test: launch → open first window → basic assertions
- [ ] Add artifact capture on failure
```

```markdown
# Issue: Playwright Harness — Page-mode CDP Attach to Running App

## Goal
Support attaching Playwright to a user-running app instance:
- Enable remote-debugging-port in dev/test mode
- Sidecar can connect via connectOverCDP
- Map CDP pages/targets to tabIds deterministically

## Acceptance Criteria
- With app running in dev mode, the sidecar attaches and performs:
  - list tabs
  - navigate tab
  - click/type on a known test page
- Document limitations vs app-mode

## Tasks
- [ ] Dev/test flag to enable remote-debugging-port
- [ ] Sidecar Playwright CDP connector
- [ ] Tab mapping strategy (tab registry + stable IDs)
```

```markdown
# Issue: Artifact Store — Screenshots, Snapshots, Traces

## Goal
Store and retrieve large artifacts efficiently (avoid base64 in normal tool responses).

## Acceptance Criteria
- page.screenshot returns:
  - artifactId
  - mimeType
  - byteLength
- artifacts.get streams or returns bytes
- Artifacts have TTL cleanup
- Optional: snapshot artifact type (DOM or accessibility tree)

## Tasks
- [ ] Implement artifact directory management
- [ ] Implement get/list/delete tools
- [ ] Add TTL cleanup job
```

```markdown
# Issue: Security Hardening Pass (Remote Content Threat Model)

## Goal
Harden the app for arbitrary remote URLs:
- Ensure safe webPreferences
- Validate IPC senders
- Restrict window.open / popups
- Permission prompts are mediated intentionally

## Acceptance Criteria
- No nodeIntegration in page tabs
- contextIsolation enabled everywhere possible
- sandbox enabled for page tabs
- All privileged ipcMain handlers validate sender/frame/origin
- Document permission policy (camera/mic/notifications)

## Tasks
- [ ] Audit webPreferences for UI vs page tabs
- [ ] Implement ipcMain sender validation helpers
- [ ] Implement permissions policy controls
- [ ] Add a security checklist doc to repo
```

```markdown
# Issue: macOS Packaging + Optional Signing/Notarization Pipeline

## Goal
Produce distributable macOS builds:
- Dev builds: unsigned artifacts
- Release builds: signed + notarized (optional, gated by secrets)

## Acceptance Criteria
- Repo has a packaging command that outputs .app and/or .dmg
- Release workflow (manual or tag) can sign/notarize when secrets are configured
- Clear docs for required Apple credentials and GitHub secrets

## Tasks
- [ ] Add packaging config (Forge/electron-builder)
- [ ] Add release GH Actions workflow skeleton
- [ ] Document secrets + entitlements strategy
```

```markdown
# Issue: Optional Selector Generator Integration (“element-source” handoff)

## Goal
Improve selector stability by optionally integrating a selector generator library.
Allow pluggable selector strategies.

## Acceptance Criteria
- SelectorStrategy interface supports:
  - Playwright-like heuristics
  - External library strategy (optional)
- Config toggle in settings
- Emits selector confidence + fallback chain

## Tasks
- [ ] Define selector strategy interface
- [ ] Implement baseline strategy (id/testid/role/text)
- [ ] Add optional library integration behind a feature flag
```

```markdown
# Issue: Native Migration Spike — WKWebView / Tauri Feasibility

## Goal
Assess migration feasibility and document gaps:
- Which APIs map cleanly (navigate/click/type/snapshot)
- What breaks (multi-process isolation, extensions, devtools parity)
- Performance and security tradeoffs

## Acceptance Criteria
- A written comparison doc
- A minimal proof-of-concept wrapper (optional)
- Migration plan recommendations with risks

## Tasks
- [ ] Document “browser runtime interface” that must remain stable
- [ ] Outline WKWebView messaging + element picking approach
- [ ] Outline Tauri IPC + isolation/capability approach
```