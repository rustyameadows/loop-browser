# Human-Agent Collaboration Guide

This document is the source of truth for how humans and agents should work together inside Loop
Browser. If the product, prompt habits, or ad hoc workflows drift, this guide wins.

## Why this exists

Loop Browser is not just a preview window. It is a shared native workspace where:

- a human opens the exact project that matters
- the app keeps the same canvas, viewport layout, and project settings visible
- the agent reads that workspace through the local MCP server, makes the change, and reports back

The goal is to remove ambiguity, not add another comment system.

## Core rules

1. The project is the unit of context.
   Start from the correct project root before discussing routes, layouts, or fixes.

2. Humans should keep the canvas concrete.
   Open the actual routes and viewport sizes that matter instead of describing them abstractly.

3. Agents work through the same workspace.
   Agents should inspect the active session and workspace state before making changes or opening
   new viewports.

4. Verification happens in the running app.
   The final check is the live viewport on the canvas, not just the code diff.

5. Use the narrowest tool that matches the job.
   Use workspace tools to inspect state, viewport tools to change routes and sizes, and file-edit
   tools only when a project change is actually needed.

## Standard workflow

1. The human opens the project folder in Loop Browser.
2. The human sets `Default URL`, any project identity details, and optional local server settings in `Project Settings`.
3. If the project needs a local dev server, the human clicks `Start Server` from the `Project` card and waits for it to become ready.
4. The human opens one or more viewports for the routes, sizes, or states that matter.
5. If the app is login-gated, the human saves repo-local credentials and uses `Use Agent Login`.
6. The agent connects through the local MCP server and reads the current session or workspace
   state.
7. The agent opens or updates viewports as needed, edits project files when needed, and refreshes
   affected viewports.
8. The human reviews the result directly on the canvas and checks the action log for what changed.

## Login-gated apps

If the app under discussion has a login screen, set up the project before starting the normal
workflow:

1. Open `Project Settings`.
2. Set `Default URL` to the local app origin and click `Save Project Settings`.
3. Enter the repo-local `Agent login email or username` and `Agent login password`, then click `Save Login`.
4. Navigate to the login page for that same origin.
5. Click `Use Agent Login` to fill the visible username/password fields without submitting the form.

The saved credentials live in `.loop-browser.local.json` in the project root and are intended to
stay repo-local. The shareable `.loop-browser.json` file should keep only the non-secret project
settings like `startup.defaultUrl` and any checked-in server command. Repo-local server
environment overrides should stay in `.loop-browser.local.json`.

## Human workflow

- Open the exact project and routes you want the agent to care about.
- Keep the canvas representative: use the real page states, viewport sizes, and routes that matter.
- Save login credentials repo-locally instead of putting secrets in shareable project config.
- Review the result in the running app after the agent reports back.
- Prefer specific instructions like route, viewport size, and expected outcome over vague visual
  descriptions.

## Agent workflow

- Start from `session.list`, `session.getCurrent`, or `workspace.get_state`.
- Treat the current project root, viewport set, and startup URL as the primary context anchors.
- Use `create_viewport` or `create_viewports` when the human needs more visual coverage.
- Use `edit_project_files` only for files inside the active project root.
- Use `refresh_viewport` or `refresh_all_viewports` after edits so verification stays in-app.
- Keep reports brief and concrete: what changed, what was verified, and what still needs attention.

## UI surfaces and what they are for

### Open Project

- UI entry point: `Open Project`
- Purpose: set the active local project root for the workspace
- Best use: start every session from the correct repo or app directory

### Project Settings

- UI entry point: `Project Settings`
- Purpose: manage `Default URL`, chrome colors, optional icon path, and repo-local login
- Best use: define the startup route and login behavior before opening multiple viewports

### Canvas

- UI entry points: canvas gestures, viewport headers, route field, `Add Viewport`
- Purpose: keep many live routes and sizes visible at once
- Best use: compare routes, responsive states, and post-edit refresh behavior without leaving the
  workspace

### Action Log

- UI entry point: inspector panel
- Purpose: show what the app and MCP clients changed, refreshed, or failed to do
- Best use: confirm which route changed, which viewport refreshed, and whether an MCP action
  succeeded

## MCP tool contract

The app exposes a local MCP server on `127.0.0.1` while it is running. The collaboration loop depends on these tool groups:

- `browser.*`
  Browser-level state such as tabs and window sizing.
- `session.*`
  Discovery of the active Loop Browser workspace session.
- `workspace.*`
  Current project root, viewport layout, and canvas state.
- `page.*`
  Route navigation and reload for existing viewports.
- `chrome.*`
  Read and update project appearance state.
- viewport actions
  `create_viewport`, `create_viewports`, `update_viewport_route`, `update_viewport_size`,
  `close_viewport`, `refresh_viewport`, and `refresh_all_viewports`.
- `edit_project_files`
  Apply project file edits inside the active project root.

The server also exposes read-only resources for session discovery and workspace inspection.

## What “good” looks like

A strong feedback loop in Loop Browser has these properties:

- The human and agent are working from the same project root and viewport set.
- The agent can recover enough context from MCP tools without guessing.
- Route changes, file edits, and refreshes are visible in the action log.
- The final verification happens in the running viewport, not only in source files.

## Current limitations

- The live integration surface today is the local MCP server; embedded assistant workflows are still
  phased work.
- Project changes still need explicit refresh actions when the app cannot infer a narrower scope.
- Local fixture edits may require a reload or a fresh navigation in the current viewport to reflect
  source changes immediately.

## Default operating mode

Unless there is a better reason not to, the expected way to collaborate in Loop Browser is:

1. open project
2. set startup and login
3. open viewports
4. inspect workspace
5. change
6. refresh
7. verify
