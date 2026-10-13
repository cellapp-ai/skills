# Cellapp CLI and Agent Skill

Cellapp publishes static HTML applications from a local project. The CLI builds and uploads only the chosen static output directory. The Agent Skill guides an AI agent through the same process. The default control origin is `https://console.cellapp.ai`; use `--origin` or `CELLAPP_ORIGIN` for another service.

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
cellapp login
cellapp deploy --project /absolute/project --output dist --build 'npm run build'
cellapp apps
```

Plain HTML directories do not need `--build`. Use `--spa` only if the site has client-side routes. The first deployment returns the stable app-ID URL and an access key once; keep the key private. Add `--namespace <handle> --slug <alias>` on first deployment for a readable `@namespace/alias` reference; the owner console provides its share link. Handles and aliases are immutable in this release, while display names may repeat. Visitors first sign in with Cellapp. Restricted applications then require owner approval or access-key redemption; public applications admit any signed-in user. Rotating a key stops new redemptions and preserves existing user grants. `cellapp.json` stores the app association and pending deployment metadata without secrets. Credentials are stored in `~/.config/cellapp/` with private file permissions.

## Application data

Cellapp hosts each application's managed PostgreSQL tables separately from platform data. A linked project can define a non-secret `cellapp.data.json` manifest with tables and `none`, `all-admitted-users`, or `own-rows` policies. Start with [the runnable notes demo](skills/cellapp-deploy/examples/notes/README.md), which includes a buildable frontend, manifest, and CRUD page:

```sh
cellapp data status --project /absolute/project
cellapp data plan --project /absolute/project
cellapp data apply --project /absolute/project
cellapp data verify --project /absolute/project
```

Table changes are versioned and applied separately from static deployments. Dropping a table or column requires `allowDestructive: true` in the manifest and `--allow-destructive` after reviewing the plan. The frontend can use `@supabase/supabase-js@2.117.3` with its own origin and the non-secret `cellapp-public` identifier for table select, insert, update, delete, equality filter, order, page range, and write-return. `/_cellapp/me` returns a stable application-scoped user ID. Supabase Auth, Realtime, Storage, RPC, custom servers, and direct PostgreSQL access are not supported. The publishable identifier never authorizes access; Cellapp checks login, admission, table grants, and row policies on every data request.

An existing `ohmyapp.json` and matching `~/.config/ohmyapp/` credential are copied safely on first use. The old files remain for recovery. `OHMYAPP_ORIGIN` and the `ohmyapp` command alias are supported during the transition; use `CELLAPP_ORIGIN` and `cellapp` for new setups.

The service hosts static content only. Frontend code and bundled values are readable by authorized visitors; never include private API credentials. Browser local-only data is not synchronized between devices; managed table data is.

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

The [public HTTP v2 contract](contracts/http-v2.json) describes the CLI, application access, and data boundary. [v1](contracts/http-v1.json) remains for older static-deploy clients. The CLI and Skill are MIT licensed; see [LICENSE](LICENSE). Contributions follow [CONTRIBUTING.md](CONTRIBUTING.md), and security reports follow [SECURITY.md](SECURITY.md).
