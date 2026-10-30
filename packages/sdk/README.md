# @cellapp/sdk

Browser client for Cellapp hosted static apps. The Cellapp CLI writes a fixed API contract into each published HTML entrypoint; initialize the SDK on that page:

```ts
import {createCellappClient} from '@cellapp/sdk';

const cellapp = createCellappClient();
const user = await cellapp.currentUser();
const {data, error} = await cellapp.from('notes').select('id,body').order('id').range(0, 49);
if (error) throw error;
```

The client uses the current app origin and same-origin visitor session. Public app APIs are `/_cellapp/me` and `/_cellapp/db/{table}`. The SDK maps its internal `supabase-js@2.117.3` table requests to the latter; app code should not call `/rest/v1`. It supports the documented table CRUD subset; the Cellapp service does not provide Supabase Auth, Storage, Realtime, Functions, RPC, or direct database access. Table definitions and policies are managed through the Cellapp CLI. See the [API version guide](https://cellapp.ai/deploy/api-versions.md) and [changelog](https://cellapp.ai/deploy/api-changelog.md).

Application API `1.2` adds OpenAI-shaped model paths under the same-origin base URL `/_cellapp/v1`. `GET /models` combines the current visitor's authorized provider connections. The SDK opens its model picker when this browser has no selected model; the selection is stored only in this browser. A model call still sends the selected model ID so Cellapp can route it:

```ts
const model = await cellapp.models.current();
console.log(model.provider, model.name);
// To let the visitor change their browser-local default later:
// await cellapp.models.select();

const answer = await cellapp.chat({
  messages: [{role: 'user', content: 'Summarize these notes'}],
});
console.log(answer.choices[0]?.message.content);

for await (const chunk of cellapp.streamChat({
  messages: [{role: 'user', content: 'Explain the result'}],
})) console.log(chunk.choices[0]?.delta.content);
```

Both methods require a page stamped with API `1.2`; an older page receives `unsupported_api_version`. Applications can also call `POST /_cellapp/v1/chat/completions` directly with an OpenAI-style `{model,messages}` body. Provider API keys never reach application code. Authorization is per provider connection, so application code can call any model on each authorized connection; the SDK picker is a convenience, not an access boundary. `CellappAPIError.code` distinguishes missing authorization, unsupported capabilities, provider failures and interrupted streams. A stream that ends without `[DONE]` throws even if earlier chunks arrived. The future Responses path is `/responses` (plural) and is not available yet.
