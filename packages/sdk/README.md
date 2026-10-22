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
