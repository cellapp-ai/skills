# Cellapp CLI and Agent Skill

Cellapp publishes static HTML applications from a local project. The CLI builds and uploads only the chosen static output directory. The Agent Skill guides an AI agent through the same process. A Cellapp control service URL is required; the Skill does not supply one.

## Install

Requires Node.js 22.12 or later. Install the CLI from the published Cellapp package when available:

```sh
npm install -g @cellapp/cli
cellapp --help
```

Install the Agent Skill separately from this public GitHub repository:

```sh
npx skills add cellapp-ai/skills
```

The installable Skill lives at [`skills/cellapp-deploy/SKILL.md`](skills/cellapp-deploy/SKILL.md). Installing the Skill does not install the CLI. Until the first package release, contributors can use `npm ci`, `npm run build`, and `npm run cli -- --help` from this repository.

## Deploy

```sh
cellapp login --origin https://control.example
cellapp deploy --project /absolute/project --output dist --build 'npm run build' --origin https://control.example
cellapp apps --origin https://control.example
```

Plain HTML directories do not need `--build`. Use `--spa` only if the site has client-side routes. The first deployment returns the app URL and its share key; keep the share key private. `cellapp.json` stores the app association and pending deployment metadata without secrets. Credentials are stored in `~/.config/cellapp/` with private file permissions.

An existing `ohmyapp.json` and matching `~/.config/ohmyapp/` credential are copied safely on first use. The old files remain for recovery. `OHMYAPP_ORIGIN` and the `ohmyapp` command alias are supported during the transition; use `CELLAPP_ORIGIN` and `cellapp` for new setups.

The service hosts static content only. Frontend code and bundled values are readable by authorized visitors; never include private API credentials. Browser local data is not synchronized between devices.

## Development

```sh
npm ci
npm run typecheck
npm test
npm run build
npm run check:skill
npm run check:boundary
npm pack --dry-run --json
```

The [public HTTP contract](contracts/http-v1.json) describes the CLI and server boundary. The CLI and Skill are MIT licensed; see [LICENSE](LICENSE). Contributions follow [CONTRIBUTING.md](CONTRIBUTING.md), and security reports follow [SECURITY.md](SECURITY.md).
