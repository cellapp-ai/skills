# Public client contract

`http-v1.json` lists every control API operation used by the Cellapp CLI, its successful status and required response keys, and the error envelope/codes. It is versioned independently of the server deployment. `local-state-v1.json` describes the project file written as `cellapp.json`; legacy `ohmyapp.json` has the same fields and is copied on first use.

The CLI keeps deployment credentials in a private file under `~/.config/cellapp/`, named by the first 24 hexadecimal characters of SHA-256 of the HTTPS control origin. The legacy directory is `~/.config/ohmyapp/`. The credential JSON contains `token`, `expiresIn` and `origin`; only the token is sent as a Bearer credential. Migration copies the old file with mode `0600` and retains the old file for recovery until explicit logout, which revokes and removes both copies. New and legacy project files with different origin or different application IDs are treated as a conflict.

Control origin precedence is `--origin`, `cellapp.json`, `CELLAPP_ORIGIN`, `ohmyapp.json`, then `OHMYAPP_ORIGIN`. The `ohmyapp` command alias and `OHMYAPP_ORIGIN` are transitional. Existing subcommands and JSON output fields remain available after the rename. Binding an owner-owned Supabase project uses `GET`/`PUT`/`DELETE /apps/{app}/data` and does not store keys in `cellapp.json`.
