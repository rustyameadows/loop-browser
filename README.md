# Agent Browser

Agent Browser is the bootstrap monorepo for the macOS Electron browser shell described in [agent-browser-plan.md](agent-browser-plan.md). The first push includes a working Electron desktop shell, a shared protocol package for IPC typing, and GitHub Actions that package unsigned macOS development artifacts.

## Workspace Layout

- `apps/desktop`: Electron main process, trusted React chrome, and the embedded page view.
- `packages/protocol`: shared navigation command and navigation state types plus guard helpers.

## Local Setup

1. Install dependencies with `npm install`.
2. Start the desktop app with `npm run dev`.
3. Run checks with `npm run lint`, `npm run typecheck`, and `npm run test`.
4. Build the unpackaged app with `npm run build`.
5. Produce a macOS zip artifact locally with `npm run package:mac`.

The desktop shell opens a checked-in `file://` fixture on first launch. Replace the address with any `https://`, `http://`, or `file://` target to exercise the page view. In-app popups are denied; plain `http/https` popup attempts are opened externally.

## CI Builds

The repo ships with `.github/workflows/push.yml`. On pull requests and on pushes to `main`, GitHub Actions installs dependencies, lints, typechecks, tests, packages the macOS app, and uploads the artifact as `agent-browser-macos-<commit-sha>`.

After the first successful push to `main`, make `main` the default branch in GitHub and enable branch protection so the Actions job stays green before merges.
