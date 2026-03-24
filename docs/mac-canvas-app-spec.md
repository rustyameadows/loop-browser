# Loop Browser Native macOS Canvas App Spec

Status: Draft v0  
Last updated: March 21, 2026

## Document purpose

Define the v0 scope, system behavior, and UX requirements for a native macOS app that lets a user
work inside a local web project with:

- an infinite Canvas
- multiple live local web Viewports
- an embedded Codex Session
- Codex-driven file edits and viewport refresh

This spec is for a local-first product. The primary workflow is working on the user's own site or
app running locally.

## Product definition

Loop Browser is a native macOS design and implementation workspace for web projects. It allows the
user to spatially arrange many live views of the same local app, direct Codex from inside the app,
and see code changes reflected in those views.

The app is responsible for:

- Project context
- Canvas state
- Viewport lifecycle
- local app connection
- Codex Session UI
- execution of Codex-triggered workspace actions
- refresh and update behavior after file edits

Codex is responsible for:

- interpreting user intent
- editing local project files
- issuing structured workspace actions
- explaining changes in conversation
- helping the user inspect and iterate on the local app

v0 requires ChatGPT account authentication before project-level Codex actions are available.
Authentication is a product requirement in this spec. The exact implementation details depend on
the ChatGPT/OpenAI integration surface available when the native app is built.

## v0 outcome

A user can:

- sign in with their ChatGPT account
- open a local Project
- start a Codex Session inside that Project
- ask Codex to open multiple views of their local app
- ask Codex to make code changes in the local Project
- watch the Codex conversation and tool activity in app
- see live Viewports refresh after Codex edits files

## Core user flow

1. User signs in.
2. User opens a local Project.
3. App connects to the local app target.
4. User creates a Codex Session.
5. User asks Codex to open useful views of the app.
6. Codex spawns live Viewports on the Canvas.
7. User asks Codex for a code change.
8. Codex edits local files.
9. App refreshes affected live views.
10. User continues iterating in the same Session and workspace.

---

## 1. System scope

### In scope for v0

- ChatGPT account authentication
- local Project creation and opening
- Project bound to a local app target
- one workspace window per Project
- infinite Canvas with many live web Viewports
- embedded Codex conversation panel
- local Codex Session creation
- Codex file editing inside the Project
- Codex ability to spawn Viewports
- automatic refresh after edits
- persistent Project state

### Out of scope for v0

- general browsing
- collaboration or multi-user editing
- cloud-hosted Project sync
- visual diff history
- full devtools replacement
- advanced auth or state emulation frameworks
- publish or deploy workflows
- plugin ecosystem
- arbitrary non-web Project support

---

## 2. Current Loop Browser behaviors to preserve

The current Loop Browser app already establishes several behaviors that v0 must preserve because
they provide strong Project identity and local workflow support:

- Project settings are rooted in `.loop-browser.json` at the Project root.
- repo-local credentials live in `.loop-browser.local.json`, stay gitignored, and are not merged
  into shareable Project config.
- `startup.defaultUrl` defines both the Project startup target and the origin scope for the
  `Use Agent Login` affordance.
- optional checked-in server startup lives alongside other shareable project settings, while
  repo-local server environment overrides stay in `.loop-browser.local.json`.
- theme state includes chrome color, accent color, and an optional Project icon.
- `Use Agent Login` remains a controlled fill action for visible login forms on matching-origin
  pages and does not auto-submit the form.
- each Project remains isolated in its own workspace window rather than switching many Projects
  inside a single shared window.

---

## 3. Primary UX model

### Mental model

The product is a Project workspace, not a browser window.

The user is operating inside a local app Project and building a spatial working surface of:

- routes
- breakpoints
- modes
- states
- implementation changes

### Defining UX principle

The Canvas is the product.

Everything else exists in support of the Canvas. Panels, sidebars, toolbars, drawers, popovers,
and modals should feel like layers over the workspace, not fixed layout columns that shrink or
constrain it. The user's main sense of place should always be the Canvas and the live Viewports on
it.

### UX primitives

The core primitives are:

- Project: the local working context
- Canvas: the primary spatial workspace
- Viewport: a live embedded web surface
- Session: the Codex conversation for that Project
- Action log: visible record of Codex tool activity
- Refresh cycle: app response to code edits and local app changes

---

## 4. Information architecture

### Top-level app structure

- Auth shell
- Active Project workspace

### Active Project workspace model

The active Project workspace is Canvas-first. The Canvas occupies the core product surface.
Supporting UI appears as overlaying surfaces that can be opened, collapsed, moved, or dismissed
without redefining the main layout around them.

There is no requirement in v0 for permanently dedicated UI regions for:

- Project switching
- saved Canvases
- fixed inspector columns

Those can exist later, but they should not define the primary shell.

### Workspace regions

#### Base layer

- infinite Canvas
- live Viewport nodes
- Canvas interactions including pan, zoom, select, move, and resize

#### Overlay UI surfaces

These sit over the Canvas rather than constraining it:

- Codex conversation panel
- tool activity panel
- file edit summaries
- transient dialogs and modals
- Project metadata surfaces
- Viewport controls as needed

#### Left sidebar or left tool surface

A collapsible left-side surface may contain:

- file tree for the local Project
- basic Project context
- optional lightweight navigation utilities

This should be collapsible by default or easy to collapse, and should behave as a Canvas-adjacent
tool surface rather than a permanently dominant structural column.

#### Optional top bar

A lightweight top control layer may contain:

- current Project name
- local target URL or environment status
- run or connected indicator
- new Viewport
- new Session
- refresh all

The top bar should remain compact and should not compete with the Canvas as the main spatial
surface.

---

## 5. Local Project model

A Project must contain at minimum:

- Project id
- Project name
- local root path
- local app target URL
- optional preferred dev server port
- saved Canvas state
- saved Viewport metadata
- Codex Session references or history
- last opened timestamp

### Project config expectations

The native app should preserve the current Project-rooted config model:

- `.loop-browser.json` for shareable Project settings such as theme colors, optional Project icon,
  `startup.defaultUrl`, and other non-secret persisted workspace settings
- `.loop-browser.local.json` for repo-local agent login credentials intended to remain gitignored

### Project assumptions

A v0 Project is tied to a locally available web app or site. The app does not need to boot the
local dev server in v0 if that adds too much complexity. It may assume the local target is already
running. If boot support is added, it should be treated as optional and separate from the core
Viewport flow.

---

## 6. Canvas spec

### Purpose

The Canvas is a persistent freeform workspace for comparing many simultaneous live views of the
same local app.

### Required behaviors

- pan freely in two dimensions
- zoom in and out
- render multiple simultaneous Viewports
- support overlap
- support selection
- support move by drag
- support resize by handles or edge drag
- preserve layout state
- maintain usability with at least 5 active Viewports

### Interaction rules

- selecting a Viewport brings it to active focus state
- dragging should not accidentally trigger page interaction
- there must be a clear distinction between interact with page and move Viewport affordances
- resize interactions must not tear down or recreate the web content unless unavoidable
- Viewport creation should place new nodes in readable positions near related nodes or in a simple
  grid

### Persistence

Canvas state must persist:

- Viewport positions
- Viewport sizes
- Viewport z-order if used
- Viewport route or URL assignment
- Viewport labels or metadata
- open or closed state as needed

---

## 7. Viewport spec

### Definition

A Viewport is a live embedded rendering of the local app at a given route and configuration.

### Required Viewport data model

- Viewport id
- Project id
- local URL or route
- display label
- x and y position
- width and height
- scale if needed
- mode metadata
- status
- last refreshed timestamp

### Required status states

- loading
- live
- refreshing
- error
- disconnected

### Required chrome

Each Viewport must expose:

- label
- route or URL
- close
- reload
- resize affordance
- drag affordance
- optional badges for mode or size

### Required behaviors

- independent navigation state
- manual reload
- independent move and resize
- persistence across Project reopen
- visible error state if load fails
- refresh after code changes when applicable

### Expected v0 supported variants

A Viewport may differ by:

- route or path
- screen size or dimensions
- light or dark mode
- query params
- local preview flags if supported by app conventions

v0 should not require a universal abstraction for arbitrary application state injection beyond
what can be expressed via URL, route, mode, query string, or simple local conventions.

---

## 8. Codex Session UX spec

### Purpose

The Codex panel is the user's command and iteration surface. The user must be able to direct
implementation and workspace changes without leaving the app.

### Required Session behaviors

- create Session from current Project
- attach Session to Project context
- display conversation history in app
- stream assistant output into the panel
- show when Codex is thinking, acting, or editing
- show tool activity and edit outcomes
- keep Session visible while user works on the Canvas

### Required message types

- user prompt
- Codex response
- action execution message
- file edit summary
- error message
- Refresh event summary

### UX rule

Codex activity must feel grounded in the Project. When it edits code or opens views, those changes
must appear visibly in the workspace, not only in text.

---

## 9. Codex action model

The app should expose a controlled tool layer rather than letting Codex directly manipulate UI
state.

### Required v0 actions

- `create_viewport`
- `create_viewports`
- `update_viewport_route`
- `update_viewport_size`
- `close_viewport`
- `refresh_viewport`
- `refresh_all_viewports`
- `edit_project_files`

### Action design principles

- every action must be structured and inspectable
- every action must produce visible feedback in app
- failed actions must render explicit errors
- actions must be scoped to the active Project

### Example action payload shapes

These are conceptual, not implementation-locked.

`create_viewport`

- route or URL
- width
- height
- label
- mode metadata

`create_viewports`

- array of Viewport definitions
- preferred layout hint optional

`edit_project_files`

- list of file operations
- patch summary
- touched files
- success or failure result

---

## 10. Code editing flow spec

### Purpose

v0 must support in-app implementation iteration. The user can ask for a UI change, Codex edits
files locally, and the workspace updates.

### Required behavior

- user asks Codex for a code change
- Codex edits files in the local Project
- app surfaces file edit activity in Session UI
- app detects or initiates view refresh
- updated result becomes visible in the affected Viewports

### User-visible sequence

1. User prompt: "Make the pricing cards more compact and tighten the headline spacing."
2. Codex replies with intent and begins editing.
3. Session panel shows active file edits.
4. Edit completes with summary of changed files.
5. Viewports enter refreshing state.
6. Updated UI appears.
7. User continues with next instruction.

### Required UX affordances

- visible editing files state
- visible file change summary
- visible Refresh state on impacted Viewports
- clear failure state if edit fails
- clear failure state if Refresh does not succeed

### Minimum edit transparency

After file edits, the app must display:

- files changed
- short summary of what changed
- success or failure state

v0 does not require a full diff viewer, though that could be added later.

---

## 11. Refresh behavior spec

### Purpose

Make code changes visibly reflect in the workspace with minimal ambiguity.

### Required Refresh modes

- manual Viewport refresh
- manual refresh all
- automatic refresh after Codex edit success

### Refresh rules

- after successful file edits, the app should refresh all relevant local Viewports
- if affected Viewports cannot be determined, refresh all Project Viewports
- refreshing should preserve Viewport position and size
- refreshing should preserve Canvas layout
- refreshing should not destroy the Codex Session state
- each Viewport should visibly indicate refreshing status

### Failure handling

If the local app fails to rebuild or render:

- Viewport should show error or disconnected state
- Session panel should report that Refresh failed or target became unavailable
- prior Canvas structure remains intact

---

## 12. Authentication spec

### Required behaviors

- sign in with ChatGPT account
- persist auth across relaunch
- allow logout
- invalidate Session cleanly
- prompt reauth on expired Session

### UX requirements

- auth should happen before Project-level Codex actions
- expired auth should not silently fail during a Codex request
- auth errors should be shown inline and be recoverable

---

## 13. Workspace behavior examples

### Example A: route setup

User asks:
"Open home, pricing, and checkout."

Expected behavior:

- Codex Session stays visible
- three live local Viewports appear on Canvas
- each is labeled and independently movable or resizable

### Example B: responsive setup

User asks:
"Open checkout in desktop and mobile."

Expected behavior:

- two Viewports appear for the same route
- each uses different dimensions
- both remain live and refresh after edits

### Example C: implementation iteration

User asks:
"Reduce the padding in the product grid cards and make titles semibold."

Expected behavior:

- Codex edits files in the local Project
- Session panel shows changed files
- existing product grid views refresh
- user sees updated result immediately

### Example D: multi-step iteration

User asks:
"Open the dashboard in light and dark mode, then make the sidebar more compact."

Expected behavior:

- two dashboard Viewports appear
- Codex edits relevant files
- both dashboard Viewports refresh
- conversation remains in one Project Session

---

## 14. Error handling spec

### Categories

- authentication failure
- Project path invalid
- local target unavailable
- Viewport load failure
- Codex Session failure
- file edit failure
- Refresh failure

### UX requirement

Every failure must be visible in either:

- Session panel
- Viewport state
- Project status UI

No silent failure for:

- Viewport creation
- file edits
- Refresh cycle
- auth loss

---

## 15. Acceptance criteria

### A. Authentication

- Given a logged-out user, when sign-in succeeds, then the app enters authenticated state and
  allows Project and Codex actions.
- Given an authenticated user, when the app relaunches, then auth persists unless invalidated.
- Given expired auth, when the user attempts a Codex action, then the app blocks the action and
  prompts for reauth.

### B. Local Project

- Given an authenticated user, when they create or open a local Project, then the Project loads
  into a persistent workspace.
- Given a valid local target URL, when the Project opens, then the app can spawn Viewports against
  that target.
- Given a reopened Project, then prior Canvas and Session state are restored.
- Given a Project configured with `.loop-browser.json` and `.loop-browser.local.json`, when the
  workspace loads, then shareable and repo-local settings are read from the correct file locations.

### C. Codex Session in app

- Given an open Project, when the user creates a Session, then a Codex conversation begins inside
  the app.
- Given an active Session, when the user sends prompts, then responses appear in the Session panel.
- Given Codex action execution, then the Session panel reflects that activity.

### D. Spawn multiple local views

- Given an active Project and Codex Session, when the user asks to open multiple views of their
  local app, then the app creates more than one live Viewport on the Canvas from that request.
- Each created Viewport must point to the local Project target.
- Each created Viewport must be independently movable and resizable.

### E. Code editing

- Given an active Project and Codex Session, when the user asks for a code change, then Codex edits
  files within the local Project.
- After a successful edit, the app surfaces the changed files and a summary in the Session UI.
- Failed edits must produce a visible error state.

### F. Refresh after edits

- Given a successful Codex edit, when the edit completes, then affected Viewports refresh
  automatically or all Project Viewports refresh if affected scope is unknown.
- After refresh, the Viewport remains in its same Canvas position and size.
- If refresh fails, then the Viewport or Session UI displays a visible failure state.

### G. Conversation continuity

- Given Viewport creation and file editing actions, when those actions complete, then the Codex
  conversation remains visible and continuous in the app.
- Given a reopened Project, when prior Session history exists, then that history is accessible in
  the workspace.

### H. Agent Login behavior

- Given a Project with `startup.defaultUrl` configured, when the user visits a matching-origin page
  with a visible login form, then the app may show `Use Agent Login`.
- Given repo-local credentials in `.loop-browser.local.json`, when the user activates
  `Use Agent Login`, then the app fills username and password without auto-submitting the form.
- Given a non-matching origin or missing login form, then the app does not silently offer a broken
  login fill action.

### I. Minimum Viewport count

- The app must support at least 5 simultaneous live Viewports in one Project while preserving
  independent navigation and basic usability.

---

## 16. v0 launch bar

v0 is complete when a signed-in user can open a local Project, create a Codex Session in app, ask
Codex to open multiple live views of their local app, ask Codex to make code changes, and see
those views refresh after the edits while the Codex conversation remains visible in the same
workspace.

## 17. Implementation posture

The product should be built as a native macOS workspace app with:

- native Project and Canvas shell
- embedded live web views
- embedded Codex Session surface
- controlled tool or action bridge between Codex and app state
- local file edit and Refresh orchestration

This keeps the product centered on spatial work, live implementation feedback, and local Project
control rather than general browsing.
