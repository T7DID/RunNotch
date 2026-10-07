# Contributing to RunNotch

RunNotch welcomes focused bug fixes, progress detectors, accessibility improvements, tests, and platform integrations.

## Set up

```powershell
npm.cmd install
npm.cmd test
npm.cmd start
```

In another terminal:

```powershell
node cli/runnotch.mjs --name "Demo" -- node examples/demo-task.mjs
```

## Before opening a pull request

```powershell
npm.cmd test
npm.cmd run check
npm.cmd audit --omit=dev
```

Keep changes small and explain the user-visible outcome. Add a test when changing event validation, progress detection, secret masking, retention, or command lifecycle behavior.

## Design rules

- Preserve the glance-first hierarchy: ring, short status, contextual card, full settings.
- Hover behavior must have keyboard-focus parity.
- Never communicate status through color alone.
- Respect reduced motion.
- Keep commands, logs, IDs, and paths copyable and readable.
- Do not add cloud accounts, analytics, or telemetry without a separate public design discussion.
- Confirm process termination; do not add confirmation dialogs to reversible preferences.

## Security-sensitive changes

Changes to command execution, process termination, IPC authorization, secret masking, preload exposure, or data retention require tests and a short threat-model note in the pull request.

Do not put real secrets in tests, screenshots, issues, or logs. Use synthetic examples.
