---
name: cellapp-deploy
description: Develop, update and deploy a static Cellapp app from the user's project. Run the published client on demand, guide browser authorization, and optionally manage supported application tables.
---

# Develop and deploy a Cellapp application

[简体中文版](SKILL.zh-CN.md)

Use the official `cellapp` client for deployment and table operations. Newer client versions use `/auth/device` for browser-approved login and `/api/control/v1/*` for Bearer management; keep using CLI commands rather than constructing HTTP requests. Older root-path CLI requests remain supported during migration. The Agent obtains and runs it; the user installs only this Skill. The public [Agent deployment instructions](https://cellapp.ai/deploy/AGENTS.md) provide the short deployment path; this Skill covers data and recovery in more detail. Use a custom origin supplied by the user or environment when present; otherwise the client defaults to `https://cellapp.ai` and migrates exact `https://console.cellapp.ai` project associations. The retired origin requires fresh browser authorization and its old token is never copied. Preserve `ohmyapp.json` and `OHMYAPP_ORIGIN` compatibility. Do not invent another origin or store a credential in the project.

## Run the published client

Check Node.js is at least 22.12 and npm is available. In the project directory, verify the official published package with:

```sh
npm exec --yes --package=@cellapp/cli@latest -- cellapp --help
```

Use the same `npm exec --yes --package=@cellapp/cli@latest -- cellapp` prefix for deployment, data and recovery commands below. npm fetches and caches the official package on demand; do not install it globally or ask the user to run setup commands. If Node.js is missing or unsupported, package retrieval fails, or help verification fails, report that exact blocker and stop. Do not use `sudo`, disable TLS checks or implement the upload protocol yourself. Keep the client's upgrade hint separate from the deployment result.

## Inspect

Read `cellapp.json`, the existing build command, static output directory, and `cellapp.data.json` if present. Reuse the application association on updates. For plain HTML omit the build command. Ask only for an ambiguous output or build setting. Cellapp hosts static frontend code; do not deploy SSR, a custom server, private service key, direct PostgreSQL credential, or arbitrary SQL. Bundled frontend values are readable by admitted visitors.

## Develop the interface when needed

If the user asks you to develop or substantially redesign an app without UI direction, read the [user-app design guidance](https://cellapp.ai/deploy/app-design.md) and apply its suggestions without asking the user to opt in. Explicit user design instructions and established project conventions take precedence. Choose a framework and styling approach that fit the app; do not impose a Cellapp look or a particular library. If the guide is unavailable, continue with a coherent visual hierarchy, responsive layout, accessible controls, and a review of the built interface. A deploy-only request does not require redesigning an existing app.

## Choose an application reference

The display name may repeat. Every owner has one public user slug (`namespace` in the API and CLI), and application slugs are unique inside it. On the first deployment a new owner may choose `--namespace <user-slug>`; each new app may choose `--slug <app-slug>`. Both use lowercase ASCII letters, digits and hyphens and start with a letter. The user slug needs at least three characters, reserved names such as `accounts`, `cloud`, `login` and `app` are unavailable, and `{app-slug}-{user-slug}` must fit one 63-character DNS label. Without choices, Cellapp assigns a privacy-preserving user slug and an application slug derived from the display name, adding a suffix on collision. Existing owners must reuse their established user slug for CLI creation. The console can update either slug after creation. The returned URL uses `{app-slug}-{user-slug}.<apps-domain>`; prior addresses remain assigned to the original app. The `@user-slug/app-slug` share link redirects to the current host. Never treat a slug or display name as an authorization identity; app access and tables remain bound to the immutable app ID.

## Plan, apply, and verify tables

The versioned, non-secret [`cellapp.data.json`](examples/notes/cellapp.data.json) manifest defines tables, columns, primary keys, indexes and operation policies. Types: `text`, `uuid`, `bigint`, `boolean`, `timestamptz`, `jsonb`. Policy modes: `none` (default), `all-admitted-users`, `own-rows`. The `own-rows` mode needs a non-null text `ownerColumn`; reads and writes are checked against the signed application user ID. Every table needs a primary key. No SQL, function, trigger, database password or provider identity belongs in the manifest. Table names are scoped to the app: an app may define `users` without touching platform users or another app's `users`. This is ordinary app data, not the platform identity source. Keep names unique within one app; `rpc` is reserved for the unsupported PostgREST route, PostgreSQL system column names are unavailable, and generated index names must not collide with table names. Check these rules with `data plan` before applying.

A new project needs its first static deployment to create the application association in `cellapp.json`. Build and deploy the frontend once, then use the linked app and configured origin to apply the data manifest. Do not report the table-dependent page as ready until verification succeeds:

```sh
npm exec --yes --package=@cellapp/cli@latest -- cellapp data status --project <project>
npm exec --yes --package=@cellapp/cli@latest -- cellapp data plan --project <project>
npm exec --yes --package=@cellapp/cli@latest -- cellapp data apply --project <project>
npm exec --yes --package=@cellapp/cli@latest -- cellapp data verify --project <project>
```

The first manifest version is `1`; increase by exactly one. Inspect the plan and data version separately from the static release. Identical retries are safe; changed content at an applied version conflicts. For a table or column drop, set `allowDestructive: true` in the manifest and pass `--allow-destructive` to `data apply` after reviewing the plan and backup implications. After a timeout, run status and verify, then retry the same manifest if needed. Do not create a new version for a retry. Adding a non-null column to a populated table fails and rolls back; use a nullable column in this initial subset.

New tables and operations deny frontend access until granted. Apply with an owner credential. Verify an allowed operation and a denied cross-user or ungranted operation before handing out the app URL. Distinguish database-only tests from real browser and PostgREST acceptance. The application database is separate from control data and other apps; application code gets no database password.

## Connect the static frontend

Use `@supabase/supabase-js@2.117.3` for the declared table subset. Initialize `createClient(window.location.origin, 'cellapp-public', {auth: {autoRefreshToken: false, persistSession: false, detectSessionInUrl: false}})`. The publishable string is non-secret and grants nothing. Cellapp checks the logged-in user's host-only app session and admission on each request. Fetch `/_cellapp/me` with same-origin credentials for the stable app-scoped ID; never expose or derive a global Cellapp ID. See the [runnable notes demo](examples/notes/README.md), which includes its build, manifest, and browser CRUD page.

Use only `.from(table).select(columns)`, `.insert(values)`, `.update(values)`, `.delete()`, `.eq()`, `.order()`, `.range()` and `.select()` after a write for returned rows. Handle `{data,error}` and 401/403 states visibly. Supabase Auth, Realtime, Storage, RPC, Edge Functions, joins, arbitrary filters, direct database access, and custom application servers are outside this release. The gateway ignores client authorization/profile headers. A public app admits any signed-in Cellapp user, while tables still require policies. A restricted app requires owner approval or access-key redemption after login.

## Publish and report

Run `npm exec --yes --package=@cellapp/cli@latest -- cellapp deploy --project <project> --output <output-directory> --build <existing-build-command>` (optionally adding `--namespace` and `--slug` on the first deployment), omitting `--build` for plain HTML. Add `--spa` only for client-side routes. The client performs device authorization when needed; provide the verification link and code, keep the command running while the user approves in the browser, and never request account passwords. Do not treat a chat reply as approval. Report publication only after `status: published`. Report data version/verification and static release separately, then provide the app URL.

The first deployment returns an access key once. Give it only to the requesting owner; never put it in a URL, repository, issue or project state. Old keys can be redeemed only after platform login. `cellapp reset-key <app-id>` rotates future redemption; existing user grants remain active. Revoke an individual grant in the owner console. Use reset or delete only when requested. A lost initial key can be explicitly rotated.

On transient upload/network failure, retry the same deploy command once: pending project metadata reuses the operation. Stop after another failure and report the error. A release version conflict needs review. If creation reports `app_data_not_ready`, keep `cellapp.json`, inspect `cellapp data status --project <project>` and retry `cellapp data reconcile --project <project>` after the platform data service is healthy; then retry deploy. Do not switch slugs or delete the app to work around this error. For an app created by an older CLI without `cellapp.json`, run `cellapp link <app-id> --project <project> --output <output-directory>` using an ID verified in `cellapp apps`. The CLI keeps the initial access key only in its private credential directory until publication; never copy it into project files. For data errors use `data status` and `data verify`; do not claim a table-dependent frontend is ready while its data API is unready. Browser local-only state does not synchronize between devices; managed table data does.
