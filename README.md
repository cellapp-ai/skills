# Cellapp CLI and Agent Skill

Cellapp publishes static HTML applications from a local project. The CLI builds and uploads only the chosen static output directory. The Agent Skill guides an AI agent through the same process. The default control origin is `https://cellapp.ai`; use `--origin` or `CELLAPP_ORIGIN` for another service.

## Ask an Agent to deploy

Open the [Cellapp deployment guide](https://cellapp.ai/deploy), copy its one-request prompt, and paste it into the AI coding tool working on your project. The Agent reads the [machine-readable instructions](https://cellapp.ai/deploy/AGENTS.md), runs the published client on demand, builds your static frontend, and publishes it. You only need to approve the device authorization in your browser when prompted. The Agent should give you the published URL and any remaining access step.

For Agent tools that support Skills, you can also install the [Cellapp deployment Skill](skills/cellapp-deploy/SKILL.md) with `npx skills add cellapp-ai/skills`. The Skill gives the Agent additional guidance for application tables and recovery. No separate CLI installation is needed for this flow.

## Manual install

Requires Node.js 22.12 or later. To use the CLI yourself, install the published Cellapp package:

```sh
npm install -g @cellapp/cli
cellapp --help
```

If global installation is unavailable, run the CLI without installing it globally: `npm exec --yes --package=@cellapp/cli@latest -- cellapp --help`. Use the same prefix for `deploy` and other commands.

Contributors can use `npm ci`, `npm run build`, and `npm run cli -- --help` from this repository.

The CLI checks for a newer stable npm release on its first run each local day. If one is available, it prints an upgrade hint to stderr. To upgrade, run `npm install -g @cellapp/cli@latest`. The check sends no credentials or project data, times out after two seconds, and does not stop a command when offline. Its last-attempt date is stored in `~/.config/cellapp/update-check.json` (or under `--config-dir`).

## Deploy

```sh
cellapp login
cellapp deploy --project /absolute/project --output dist --build 'npm run build'
cellapp apps
```

Plain HTML directories do not need `--build`. Use `--spa` only if the site has client-side routes. The CLI reads the platform's default stable application API version before building and pins its canonical `major.minor` identifier in every output HTML page. `--api-version 1.1` and `--api-version 261022` select the same fixed contract; an explicit selection is saved in `cellapp.json`. The date and canonical aliases, support status, and rollback behavior are documented in the [API version guide](https://cellapp.ai/deploy/api-versions.md) and [changelog](https://cellapp.ai/deploy/api-changelog.md). An older static release restores its embedded API version when republished. For prebuilt HTML, remove a conflicting version marker or select its existing version explicitly before deploying. The first deployment returns a `{app-slug}-{user-slug}.<apps-domain>` URL and an access key once; keep the key private. Add `--namespace <user-slug> --slug <app-slug>` on first deployment to choose it. The user slug must have at least three lowercase characters, digits or hyphens; reserved platform names are unavailable, and the combined host label must fit 63 characters. The owner console can change both slugs later; old addresses remain bound to the original application. Display names may repeat. Visitors first sign in with Cellapp. Restricted applications then require owner approval or access-key redemption; public applications admit any signed-in user. Rotating a key stops new redemptions and preserves existing user grants. `cellapp.json` stores the app association and pending deployment metadata without secrets. Credentials are stored in `~/.config/cellapp/` with private file permissions.

## Application data

Cellapp hosts each application's managed PostgreSQL tables separately from platform data. A linked project can define a non-secret `cellapp.data.json` manifest with tables and `none`, `all-admitted-users`, or `own-rows` policies. Start with [the runnable notes demo](skills/cellapp-deploy/examples/notes/README.md), which includes a buildable frontend, manifest, and CRUD page:

```sh
cellapp data status --project /absolute/project
cellapp data plan --project /absolute/project
cellapp data apply --project /absolute/project
cellapp data verify --project /absolute/project
```

Table changes are versioned and applied separately from static deployments. Dropping a table or column requires `allowDestructive: true` in the manifest and `--allow-destructive` after reviewing the plan. The frontend uses `@cellapp/sdk` for `currentUser()` and the documented table select, insert, update, delete, equality filter, order, page range, and write-return operations. The SDK uses the pinned API version and same-origin visitor session. Supabase Auth, Realtime, Storage, RPC, custom servers, and direct PostgreSQL access are not supported. The publishable table identifier never authorizes access; Cellapp checks login, admission, table grants, and row policies on every data request.

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

The [public HTTP v3 contract](contracts/http-v3.json) describes the current CLI paths and responses. Login uses `/auth/device` and `/auth/device/poll`; logout revokes `/auth/credentials/current`; Bearer management uses `/api/control/v1/*`. These paths work with the selected HTTPS control origin. The [v2](contracts/http-v2.json) root paths remain available for older CLI clients, and [v1](contracts/http-v1.json) records the earlier static-deploy contract. App-host `/_cellapp/*`, including `/_cellapp/db/{table}`, uses visitor access checks, separate from the CLI credential. The CLI and Skill are MIT licensed; see [LICENSE](LICENSE). Contributions follow [CONTRIBUTING.md](CONTRIBUTING.md), and security reports follow [SECURITY.md](SECURITY.md).
