# Contributing

CellApp's public repository contains the CLI, shared client validation, public HTTP contract and Agent Skill. Keep server implementation, infrastructure configuration, credentials and production operations material out of contributions.

Run `npm ci`, `npm run typecheck`, `npm test`, `npm run build`, `npm run check:skill` and `npm run check:boundary` before opening a pull request. Changes to the public HTTP contract must describe compatibility with released clients. Do not include secret values in tests or examples.
