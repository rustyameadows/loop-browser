# AGENTS

- When work references a GitHub issue for this repository, including forms like `#123`, `gh #123`, or a GitHub issue URL, use `gh` to fetch the issue details before planning or implementation.
- If `gh` is unavailable or unauthenticated, stop and tell the user instead of guessing or using web lookups.
- Do not claim a behavior works unless you directly verified that specific behavior through an appropriate test, smoke check, or manual check; if only part of it was verified, say exactly what was and was not verified.
- If you change the Electron app, renderer, preload, packaged assets, or any code that affects the shipped desktop app, you must rebuild before telling the user the app includes the change.
- If the user asks for a fresh macOS app, package a new `.app`/artifact with `npm run package:mac` before handing it off. Do not imply that source edits or passing tests mean the packaged app is current.
- In those cases, report exactly what you rebuilt, the output path, and the artifact timestamp you verified.
- For product and architecture context, see `agent-browser-plan.md`.
