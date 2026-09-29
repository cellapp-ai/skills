# Contributing

Cellapp's public repository contains the CLI, shared client validation, public HTTP contract and Agent Skill. Keep server implementation, infrastructure configuration, credentials and production operations material out of contributions.

Run `npm ci`, `npm run typecheck`, `npm test`, `npm run build`, `npm run check:skill` and `npm run check:boundary` before opening a pull request. Changes to the public HTTP contract must describe compatibility with released clients. Do not include secret values in tests or examples.

Follow [AGENTS.md](AGENTS.md) for module ownership, compatibility and the design, confirmation, development, testing, archive and commit process. Standalone contributions keep their final design and validation in the contribution record. When used as a submodule, publish the client commit before updating the parent repository pointer; do not discard local work during submodule updates.
