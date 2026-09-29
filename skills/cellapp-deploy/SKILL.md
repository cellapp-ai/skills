---
name: cellapp-deploy
description: Publish or update a static HTML site or frontend tool on Cellapp using local builds, device authorization, and an app-specific share key. Use when the user asks to deploy to Cellapp; does not host backends or synchronize app data.
---

# Deploy a static application

Use the installed `cellapp` CLI. Installing this Skill does not install the CLI; if it is unavailable, tell the user to install the Cellapp CLI using the public repository README. Do not substitute another hosting provider or invent a control URL. The control origin comes from the user's configuration, `CELLAPP_ORIGIN`, or an existing `cellapp.json`. Existing `ohmyapp.json` and `OHMYAPP_ORIGIN` are supported during migration.

Inspect the project's existing build command and static output directory. Reuse `cellapp.json` for updates. For a plain HTML directory, omit the build command. If the output directory or build command is ambiguous, ask only for the missing setting. A backend, SSR server, secret-dependent API, or database cannot be deployed with this skill; explain the static-export requirement before attempting publication.

Run `cellapp deploy --project <project> --output <output-directory> --build <existing-build-command> --origin <control-origin>`, omitting `--build` for plain HTML. Add `--spa` only when client-side page routing requires index fallback. Quote all paths and commands for the shell in use. Run user project builds under the agent's normal execution permissions.

The CLI starts device authorization automatically when no credential exists. Show the user the verification link and matching code, and keep the command running while they approve in a browser. Do not request account passwords or copy the deployment token into the conversation. Authorization denial/expiry stops the flow; let the user initiate another attempt.

Only report deployment success after the CLI returns `status: published`. Return the application URL and the initial app-specific share key to the requesting owner. For updates, report that the existing share key remains valid. Never put a key into a URL, repository, issue, or unrelated message. The key grants access to the application; it grants no management permissions.

On a transient upload/network error, retry the same deploy command once: saved pending metadata reuses the deployment operation. Stop after another failure and report the specific error. A version conflict requires refreshing the intended version before starting a new deployment; do not silently overwrite a concurrent update. For quota errors explain the configured limit and recovery action, without purchasing services or deleting apps automatically.

App management commands are `cellapp apps`, `cellapp reset-key <app-id>`, `cellapp delete <app-id>`, `cellapp login`, and `cellapp logout`. Resetting a key invalidates existing sessions. Use reset or delete only when requested; do not reset keys as an invisible retry strategy. If a first deployment's key is lost, explain that the owner can explicitly reset it.

Explain the relevant first-deployment limits briefly: frontend code and bundled values are readable by authorized visitors; never bundle private API credentials. Browser local data is not synchronized between devices. The service hosts static content only, with no user backend or offline Service Worker support.
