# Human-Agent Collaboration Guide

This document is the source of truth for how humans and agents should work together inside Agent Browser. If the product, prompt habits, or ad hoc workflows drift, this guide wins.

## Why this exists

Agent Browser is not just a shell that loads pages. It is a shared workspace where:

- a human points at the exact part of the UI that matters
- the app turns that into structured context
- the agent reads the same context, makes the change, and reports back in-thread

The goal is to remove ambiguity, not add another comment system.

## Core rules

1. The annotation is the unit of work.
   A picked element plus its summary, note, status, and replies is the shared record for a task.

2. Humans point at concrete UI.
   When possible, feedback should start from a picker selection instead of a free-form message.

3. Agents work in the same loop.
   Agents should read feedback state, reply on the annotation they are acting on, and update status as work progresses.

4. Status must reflect reality.
   `open`, `acknowledged`, `in_progress`, `resolved`, and `dismissed` are not decoration. They are the current contract between human and agent.

5. Use the narrowest tool that matches the job.
   Screenshot requests should use screenshot tools. Markdown extraction should be used for copy and structure, not as a substitute for page state or visual proof.

## Standard workflow

1. The human navigates to the page or fixture they want to discuss.
2. The human enables pick mode with the crosshair button or `View > Toggle Pick Mode`.
3. The human clicks the element they care about.
4. Agent Browser opens the `Feedback Loop` and starts a live draft from that selection.
5. The human writes a short summary, adds a note, chooses kind and priority, then saves the annotation.
6. The agent reads the annotation through the app UI or the local MCP server.
7. The agent inspects the page, code, or artifacts needed to act on the request.
8. The agent replies in the annotation thread with what it changed or what it needs next.
9. The agent updates the status as the work moves from `open` to `acknowledged`, `in_progress`, or `resolved`.
10. The human reviews the result in the page itself, not just the code diff.

## Login-gated apps

If the app under discussion has a login screen, set up the project before starting the normal feedback loop:

1. Open the `Project Style` panel.
2. Set `Default URL` to the local app origin and click `Save Startup`.
3. Enter the repo-local `Agent login email or username` and `Agent login password`, then click `Save Login`.
4. Navigate to the login page for that same origin.
5. Click `Use Agent Login` to fill the visible username/password fields without submitting the form.

The saved credentials live in `.loop-browser.local.json` in the project root and are intended to stay repo-local. The shareable `.loop-browser.json` file should keep only the non-secret project settings like `startup.defaultUrl`.

## Human workflow

- Use picker-driven feedback whenever the request is about a specific element, section, or layout issue.
- Keep summaries short and scannable. The note field can carry nuance.
- Use priority to indicate urgency, not volume.
- Review the result in the running app after the agent reports back.
- Re-open with a new annotation if the next issue is materially different from the first one.

## Agent workflow

- Start from `feedback.getState` or `feedback.list` when the task originates in the app.
- Treat the selected element descriptor as the primary context anchor.
- Reply on the same annotation instead of moving status silently.
- Keep replies brief and concrete: what changed, what was verified, what remains.
- Move status to `acknowledged` when the work is understood, `in_progress` while making the change, and `resolved` only after verification.
- If the work cannot or should not be done, explain why and use `dismissed` only when the annotation should leave the active queue.

## UI surfaces and what they are for

### Pick mode

- UI entry points: crosshair button, `View > Toggle Pick Mode`
- Purpose: capture a precise DOM-backed selection
- Output: selector metadata, role hints, accessible name, text snippet, box metrics, and HTML excerpt

### Feedback Loop

- UI entry point: `Feedback Loop`
- Purpose: keep the human note, agent reply, and lifecycle status in one shared thread
- Best use: bug reports, change requests, questions about a specific element, and confirmation that a fix landed

### View as MD

- UI entry point: `View as MD`
- Purpose: extract the current page into trusted Markdown for copy, summarization, or structure-aware inspection
- Not for: screenshot-only tasks or visual confirmation

### MCP Status

- UI entry point: `MCP Status`
- Purpose: show whether the local tool server is healthy and what tools are exposed
- Best use: confirm the app is reachable before asking an external agent client to act on the current session

## MCP tool contract

The app exposes a local MCP server on `127.0.0.1` while it is running. The collaboration loop depends on these tool groups:

- `browser.*`
  Browser-level state such as tabs and window sizing.
- `picker.*`
  Picker overlay control and retrieval of the last picked descriptor.
- `feedback.*`
  Shared annotation state, thread replies, and lifecycle updates.
- `page.viewAsMarkdown`
  Structured copy of the current page.
- `page.screenshot`
  Visual capture of the current page, a selected element, or the full app window.
- `artifacts.*`
  Resolution and lifecycle of saved screenshots.

Current feedback tools:

- `feedback.getState`
- `feedback.list`
- `feedback.create`
- `feedback.reply`
- `feedback.setStatus`

## Status definitions

- `open`
  New item that still needs agent attention.
- `acknowledged`
  The agent has read the note and agrees on the task.
- `in_progress`
  The agent is actively working on it.
- `resolved`
  The requested change was made and verified.
- `dismissed`
  The item is intentionally closed without a code or content change.

## What “good” looks like

A strong feedback loop in Agent Browser has these properties:

- The human can point instead of describing geometry in prose.
- The agent can recover the same context from tools without guessing.
- The thread shows what changed and why.
- The status queue tells the truth at a glance.
- The final verification happens in the running page, not only in source files.

## Current limitations

- Feedback state is currently session-memory only. If the app restarts or crashes, unsaved context is lost.
- Annotation snapshots preserve the original picked element metadata and do not auto-refresh after the page changes.
- Local fixture edits may require a reload or a fresh navigation in the current tab to reflect source changes immediately.

## Default operating mode

Unless there is a better reason not to, the expected way to collaborate in Agent Browser is:

1. pick
2. annotate
3. reply
4. change
5. verify
6. resolve
