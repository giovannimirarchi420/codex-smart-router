# Repository Guidelines

## Project Structure & Module Organization

- `src/` contains the router, classifier, proxy, audit, dashboard, and model-catalog modules.
- `bin/codex-smart.mjs` is the executable CLI entry point.
- `test/` contains Node’s built-in test suites; `test/app-server.integration.test.mjs` covers App Server integration.
- `assets/route-schema.json` defines the validated classifier decision schema.
- `README.md` and `PUBLIC_DOCUMENTATION.md` describe user-facing behavior and architecture.

Keep routing and classification logic in focused `src/` modules, and update the schema and tests when the decision contract changes.

## Build, Test, and Development Commands

Run these commands from the repository root:

```bash
npm install                  # Install dependencies
npm test                     # Run the focused unit suites
npm run check                # Validate JavaScript syntax
npm run test:integration     # Run the Codex App Server integration test
```

The integration test requires a working Codex App Server environment. Use `node bin/codex-smart.mjs route "..."` for a local routing smoke test after installation.

## Coding Style & Naming Conventions

Use modern JavaScript ES modules with Node.js 20 or newer. Match the existing style: two-space indentation, semicolons, single-quoted strings where practical, and descriptive `camelCase` identifiers. Name test files after the module or behavior under test (for example, `router.test.mjs`). Keep CLI-facing behavior explicit and avoid adding heuristic routing fallbacks that bypass schema validation.

## Testing Guidelines

Tests use Node’s built-in `node:test` runner and should be deterministic and focused. Add or update tests for every change to routing, classification, proxy protocol handling, audit records, or dashboard calculations. Run `npm test` and `npm run check`; run `npm run test:integration` when changing App Server behavior.

## Commit & Pull Request Guidelines

No Git history is available in this checkout, so no existing commit convention can be verified. Use concise imperative commit subjects, such as `Add dashboard cost coverage` or `Fix route schema validation`.

Pull requests should explain the behavior change, include focused tests, document configuration or compatibility impacts, and link the relevant issue when one exists. Remove secrets and private prompts from logs, screenshots, and examples.

## Security & Configuration Tips

Do not commit API keys, Codex credentials, audit logs, or prompt content. Preserve the proxy’s loopback binding and per-process bearer-token protection. Document any new environment variables in `README.md`.
