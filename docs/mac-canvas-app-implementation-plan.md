# Loop Browser Native macOS Implementation Plan

Status: Proposed implementation plan for v0  
Last updated: March 24, 2026

## Summary

This plan translates the native Canvas app spec into a buildable v0 roadmap for Loop Browser as a
local-first macOS workspace app.

The implementation is locked to:

- `SwiftUI` for the native app shell and high-level panel composition
- `AppKit` for the Canvas host, precise layout, viewport manipulation, and multi-window management
- `WKWebView` for live local Viewports
- one workspace window per Project

The repo already includes the core native scaffold:

- `apps/native-macos/LoopBrowserNative.xcodeproj`
- `apps/native-macos/LoopBrowserNative`
- `apps/native-macos/LoopBrowserNativeSupport`
- `apps/native-macos/LoopBrowserNativeTests`
- `apps/native-macos/LoopBrowserNativeUITests`

The work here extends that native codebase and preserves established product behavior. It should
not reintroduce any dependency on the removed legacy desktop stack.

The main preserved behaviors are:

- Project-rooted config in `.loop-browser.json`
- repo-local credentials in `.loop-browser.local.json`
- `startup.defaultUrl` as startup target plus login-origin scope
- theme identity through chrome color, accent color, and optional Project icon
- controlled `Use Agent Login` fill behavior
- Project isolation by workspace window

## Current-state findings from the existing repo

The current native app already establishes several behaviors that should remain source-of-truth
product behavior for v0:

- Project appearance is persisted through `.loop-browser.json`.
- repo-local agent credentials are persisted through `.loop-browser.local.json`.
- `startup.defaultUrl` is used for startup targeting and for the origin scope of `Use Agent Login`.
- theme state includes chrome color, accent color, Project icon path, and related UI theming.
- login fill is intentionally controlled, scoped to matching-origin pages, and does not auto-submit.
- session and Project lifecycles are already organized around Project-specific context rather than a
  general browsing model.

These behaviors are already represented in the current codebase through the project settings flow,
agent login flow, workspace state, viewport management, and local MCP action surface. Future work
should preserve their semantics even if implementation details change.

## Architecture decisions

### 1. App shell

- Use `SwiftUI` for app startup, auth shell, workspace chrome, overlay surfaces, and high-level
  panel composition.
- Use `NSWindow` and related AppKit window APIs to manage one Project workspace window per Project.
- Keep the shell Canvas-first. Supporting surfaces should overlay the Canvas instead of redefining
  the core workspace layout.

### 2. Canvas engine

- Build the Canvas as an AppKit-backed 2D surface with explicit support for pan, zoom, selection,
  drag, resize, overlap, and z-order.
- Treat each Viewport as a managed node with persistent frame, label, route, mode metadata, and
  load status.
- Separate move/resize affordances from page interaction so dragging a Viewport does not
  accidentally click into the page.

### 3. Viewport host manager

- Use `WKWebView` instances for all live local Viewports.
- Maintain independent navigation state per Viewport.
- Refresh Viewports in place so Canvas position, size, and node identity remain stable.
- Expose visible `loading`, `live`, `refreshing`, `error`, and `disconnected` states.

### 4. Codex Session surface

- Embed a Codex Session panel in the native app rather than treating the assistant as an external
  tool.
- Stream assistant output, Action log events, file edit summaries, errors, and Refresh events into
  the Session UI.
- Keep the Session visible and continuous while users inspect or manipulate the Canvas.

### 5. Controlled action bridge

- Introduce a structured workspace-action layer between Codex and native app state.
- Do not let Codex mutate native UI state directly.
- The v0 action layer must support:
  - `create_viewport`
  - `create_viewports`
  - `update_viewport_route`
  - `update_viewport_size`
  - `close_viewport`
  - `refresh_viewport`
  - `refresh_all_viewports`
  - `edit_project_files`
- Every action must be inspectable, Project-scoped, and visible in the Action log.

### 6. Settings and identity store

- Preserve the Project-rooted persistence model rather than inventing a new config system.
- `.loop-browser.json` remains the shareable file for startup target, theme, icon, and persisted
  workspace settings.
- `.loop-browser.local.json` remains the repo-local file for agent login username and password.
- The native app should preserve the current split between shareable config and repo-local secrets.

### 7. Agent login injector

- Mirror the current heuristics for finding visible username and password fields.
- Scope `Use Agent Login` to pages whose origin matches `startup.defaultUrl`.
- Keep login fill as a deliberate user action that fills the form without submitting it.
- Prefer repo-local credentials over legacy environment-variable fallback.

### 8. Refresh orchestration

- After successful file edits, refresh the affected Viewports when the scope is known.
- If the affected Viewports cannot be determined, refresh all Viewports in the active Project.
- Preserve Canvas layout, Session continuity, and Viewport identity during refresh.
- Surface failures clearly in the Viewport state and Session UI.

## Key app-facing interfaces and data types

The native app should define stable interfaces around the product primitives instead of letting
view controllers or SwiftUI views invent ad hoc state.

### Required types

`ProjectRecord`

- `id`
- `name`
- `rootPath`
- `targetURL`
- `preferredDevServerPort`
- `lastOpenedAt`
- `canvasState`
- `sessionRefs`

`CanvasState`

- `zoomScale`
- `contentOffset`
- `viewportOrder`
- persisted Viewport frames and metadata

`ViewportRecord`

- `id`
- `projectID`
- `label`
- `url`
- `route`
- `frame`
- `modeMetadata`
- `status`
- `lastRefreshedAt`

`ViewportStatus`

- `loading`
- `live`
- `refreshing`
- `error`
- `disconnected`

`CodexSessionRecord`

- `id`
- `projectID`
- `createdAt`
- `lastActivityAt`
- conversation history reference
- current assistant state

`CodexWorkspaceAction`

- action kind
- Project scope
- action payload
- execution status
- created timestamp
- visible result summary

`FileEditSummary`

- touched files
- short change summary
- success or failure state
- optional error message

`RefreshEventSummary`

- affected Viewport ids
- refresh trigger
- started timestamp
- completed timestamp
- success or failure state

### Project settings schema

The native app should preserve the current config shape rather than inventing a new model.

Expected shareable settings in `.loop-browser.json`:

- `version`
- `chrome.chromeColor`
- `chrome.accentColor`
- `chrome.projectIconPath`
- `startup.defaultUrl`
- optional `startup.server.command`
- optional `startup.server.workingDirectory`
- optional `startup.server.readyUrl`
- optional panel or workspace presentation preferences
- legacy env fallback names only if still supported during transition

Expected repo-local settings in `.loop-browser.local.json`:

- `version`
- `agentLogin.username`
- `agentLogin.password`
- optional `server.environment`

## Subsystem implementation plan

### Launcher and auth shell

- Build a lightweight launcher that handles ChatGPT auth state, relaunch persistence, logout, and
  expired-session recovery.
- Gate Project-level Codex actions on a valid authenticated state.
- Keep auth failures inline and recoverable.

### Project workspace window

- Open each Project in its own workspace window.
- Restore Project-specific Canvas, Viewports, settings, and Session references when reopening.
- Support opening another Project without retargeting the current Project window.

### Canvas engine

- Host the Canvas in AppKit for precise control over zoom, drag, resize, overlap, and focus.
- Keep overlay surfaces above the Canvas without shrinking the core workspace.
- Persist layout continuously enough that app relaunch restores the user's workspace.

### Viewport host manager

- Create and own one `WKWebView` per active Viewport.
- Track navigation state and load lifecycle per Viewport.
- Support route changes, reload, resize, and move without re-creating the Viewport unnecessarily.

### Codex panel and Action log

- Stream user prompts, assistant responses, tool activity, file edit summaries, and Refresh events.
- Keep actions grounded in the current Project and reflect their effects in the Canvas.
- Make failure states explicit instead of burying them in console output.

### File editing and refresh pipeline

- Accept `edit_project_files` output from Codex through the controlled action bridge.
- Apply edits only within the active Project root.
- Emit file change summaries to the Session UI.
- Trigger targeted refresh or fallback full-Project refresh after successful edits.

## Phased delivery

### Phase 0: native workspace bootstrap and settings parity

- Create the native macOS app scaffold.
- Set up one Project workspace window per Project.
- Implement Project selection and persisted workspace identity.
- Read and write `.loop-browser.json` and `.loop-browser.local.json` with current semantics.
- Preserve theme colors, Project icon path, and `startup.defaultUrl`.

Exit criteria:

- Native shell launches.
- A Project can be opened into its own window.
- Project settings parity is working from repo-backed config files.

### Phase 1: Canvas shell and multi-Viewport hosting

- Build the AppKit Canvas host.
- Add Viewport node creation, move, resize, overlap, and persistence.
- Embed `WKWebView` instances as live local Viewports.
- Support at least 5 simultaneous usable Viewports.

Exit criteria:

- Users can spatially arrange multiple live local Viewports on the Canvas.
- Reopening the Project restores the prior Canvas layout.

### Phase 2: embedded Codex Session and action bridge

- Add the in-app Codex Session surface.
- Stream assistant responses and Action log output.
- Implement the structured workspace-action layer for Viewport creation and Viewport updates.

Exit criteria:

- Users can create a Codex Session in app.
- Codex can open one or more Viewports through structured actions.

### Phase 3: local file editing orchestration and Refresh loop

- Integrate `edit_project_files` into the native action bridge.
- Surface file edit summaries in the Session panel.
- Implement automatic refresh of affected Viewports or all Viewports when scope is unknown.
- Preserve Canvas and Session continuity across edits and refreshes.

Exit criteria:

- Users can request code changes in app and see refreshed results in their Viewports.

### Phase 4: auth hardening, recovery flows, and v0 polish

- Harden auth persistence and reauth handling.
- Finalize error states for auth, unavailable targets, file edits, and refresh failures.
- Refine window restore behavior, Project reopen flows, and startup ergonomics.
- Close remaining v0 polish gaps around usability and visible status.

Exit criteria:

- The app satisfies the v0 launch bar in the spec and behaves reliably across relaunch and failure
  states.

## Test plan and validation scenarios

### Product-level scenarios

- Sign in with ChatGPT, relaunch, and confirm auth persists.
- Open a local Project and confirm its prior Canvas and Session state restore.
- Ask Codex to open multiple routes and confirm multiple live Viewports appear on the Canvas.
- Ask Codex to open route variants such as desktop and mobile and confirm independent Viewport
  sizing.
- Ask Codex for a code edit and confirm file edit summaries appear in the Session UI.
- Confirm successful edits trigger Refresh and preserve each Viewport's frame and Canvas placement.
- Confirm failed edits or failed refreshes produce visible error states.
- Confirm at least 5 active Viewports remain usable.

### Current product behavior scenarios

- Confirm `.loop-browser.json` remains the shareable Project settings source.
- Confirm `.loop-browser.local.json` remains the repo-local agent login store.
- Confirm `startup.defaultUrl` scopes the availability of `Use Agent Login`.
- Confirm `Use Agent Login` fills visible login fields without auto-submitting.
- Confirm Projects remain isolated by window.

### Documentation verification for this planning task

- Verify [docs/mac-canvas-app-spec.md](/Users/rustymeadows/dev/browser-loop/docs/mac-canvas-app-spec.md) exists and uses the core product vocabulary: `Project`, `Canvas`, `Viewport`, `Session`, `Action log`, and `Refresh cycle`.
- Verify [docs/mac-canvas-app-implementation-plan.md](/Users/rustymeadows/dev/browser-loop/docs/mac-canvas-app-implementation-plan.md) exists and includes the locked architecture, windowing model, required types, phased milestones, and environment-readiness notes.

## Local development environment readiness

Environment verification was performed locally on March 24, 2026.

### Commands run and observed results

| Command | Observed result |
| --- | --- |
| `sw_vers` | `macOS 26.3 (25D2125)` |
| `xcode-select -p` | `/Applications/Xcode.app/Contents/Developer` |
| `xcodebuild -version` | `Xcode 26.3` / `Build version 17C529` |
| `swift --version` | `Apple Swift version 6.2.4` |
| `git status --short` | clean working tree |

### Readiness summary

Ready:

- Full Xcode 26.3 is selected and `xcodebuild` is available.
- Swift 6.2.4 is installed.
- The repo working tree is clean.

### Immediate setup required before native implementation

- Re-run `swift test --package-path apps/native-macos/LoopBrowserNativeSupport` after support
  package changes.
- Re-run `xcodebuild test -project apps/native-macos/LoopBrowserNative.xcodeproj -scheme
  LoopBrowserNative -destination "platform=macOS,arch=arm64"` after native app or UI changes.
- Re-run `./scripts/package-native-mac.sh` after changes that affect the shipped app bundle.

## Assumptions

- The spec document lives at [docs/mac-canvas-app-spec.md](/Users/rustymeadows/dev/browser-loop/docs/mac-canvas-app-spec.md).
- The implementation plan lives at [docs/mac-canvas-app-implementation-plan.md](/Users/rustymeadows/dev/browser-loop/docs/mac-canvas-app-implementation-plan.md).
- v0 is locked to `SwiftUI + AppKit + WKWebView`.
- v0 uses one workspace window per Project.
- ChatGPT account auth is a product requirement, but the final auth implementation depends on the
  integration surface available at build time.
- Future implementation extends the existing native app and preserves current product behavior.
