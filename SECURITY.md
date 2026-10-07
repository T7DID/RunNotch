# Security policy

## Reporting a vulnerability

Do not open a public issue for a vulnerability that could expose command output, credentials, local files, or process control.

Before public release, configure a private GitHub Security Advisory contact for the repository and place that address here. Until then, share the report privately with the repository owner.

Include:

- affected version and operating system;
- reproduction steps using synthetic data;
- expected and actual behavior;
- impact and any suggested mitigation.

Do not include real tokens, command output, personal paths, or private repository content.

## Security boundaries

RunNotch is a same-user local utility, not a sandbox.

- The CLI intentionally executes the command the user supplies with that user's permissions.
- Renderer pages have Node.js disabled, context isolation enabled, sandboxing enabled, and a restrictive Content Security Policy.
- Local event IPC binds only to `127.0.0.1` and requires a random token stored in the user's configuration directory.
- Stop actions can target only a PID already registered for a tracked run and require an explicit UI confirmation.
- Output storage is bounded and common secret shapes are masked before persistence.
- Secret detection is probabilistic. Users should not place secrets in command-line arguments.

Public release artifacts should be code-signed, accompanied by checksums, and built through a documented CI workflow.
