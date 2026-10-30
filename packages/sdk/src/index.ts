import {createClient} from '@supabase/supabase-js';

const versionPattern = /^[1-9][0-9]*\.[0-9]+$/;
const tablePattern = /^[a-z][a-z0-9_]{0,62}$/;

export interface AppUser {id: string; access: 'admitted'}
export interface ModelMessage {role: 'system' | 'user' | 'assistant'; content: string}
export interface ModelTool {type: 'function'; function: {name: string; description?: string; parameters: Record<string, unknown>}}
export interface CellappModel {id: string; name: string; provider: string}
export interface ModelChatOptions {model?: string; messages: ModelMessage[]; tools?: ModelTool[]; max_tokens?: number; max_completion_tokens?: number; temperature?: number; top_p?: number; signal?: AbortSignal}
export interface ModelChatResult {choices: {message: {content?: string | null; tool_calls?: unknown[]}}[]; usage?: {prompt_tokens?: number; completion_tokens?: number}}
export interface ModelStreamChunk {choices: {delta: {content?: string | null; tool_calls?: unknown[]}}[]; usage?: {prompt_tokens?: number; completion_tokens?: number}}

export class CellappAPIError extends Error {
  constructor(readonly status: number, readonly code: string, message: string, readonly details: unknown = null) {
    super(message);
    this.name = 'CellappAPIError';
  }
}

function pageVersion(): string {
  if (typeof document === 'undefined') throw new Error('Cellapp SDK requires a browser page');
  const markers = document.querySelectorAll('meta[name="cellapp-api-version"]');
  if (markers.length !== 1) throw new Error('Expected one Cellapp API version marker in the page');
  const version = markers[0]?.getAttribute('content') ?? '';
  if (!versionPattern.test(version)) throw new Error('Invalid Cellapp API version marker');
  return version;
}

function appOrigin(): string {
  if (typeof location === 'undefined' || location.protocol !== 'https:') throw new Error('Cellapp SDK requires an HTTPS application origin');
  return location.origin;
}

async function responseError(response: Response): Promise<CellappAPIError> {
  let value: unknown;
  try { value = await response.json(); } catch { /* A gateway may return a non-JSON failure. */ }
  const envelope = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  const error = envelope.error && typeof envelope.error === 'object' ? envelope.error as Record<string, unknown> : envelope;
  return new CellappAPIError(response.status, typeof error.code === 'string' ? error.code : typeof error.error === 'string' ? error.error : 'invalid_response',
    typeof error.message === 'string' ? error.message : `Cellapp request failed (${response.status})`, error.details ?? null);
}

function modelVersion(version: string): void {
  if (version !== '1.2') throw new CellappAPIError(400, 'unsupported_api_version', 'Model calls require Cellapp application API version 1.2');
}

const modelIDPattern = /^cellapp:[a-f0-9]{32}:.{1,256}$/;

async function modelSelection(models: CellappModel[], authorizeUrl?: string): Promise<CellappModel> {
  if (typeof document === 'undefined') throw new Error('Model selection requires a browser page');
  return new Promise((resolve, reject) => {
    const dialog = document.createElement('dialog');
    dialog.setAttribute('aria-label', 'Choose a model for this application');
    const title = document.createElement('h2');
    title.textContent = 'Choose a model';
    const explanation = document.createElement('p');
    explanation.textContent = 'This application can call any model on an authorized provider connection. Your default choice stays in this browser.';
    dialog.append(title, explanation);
    const select = document.createElement('select');
    select.setAttribute('aria-label', 'Model');
    for (const model of models) {
      const option = document.createElement('option');
      option.value = model.id;
      option.textContent = `${model.provider} · ${model.name}`;
      select.append(option);
    }
    if (models.length) dialog.append(select);
    if (authorizeUrl) {
      const link = document.createElement('a');
      link.href = authorizeUrl;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      link.textContent = models.length ? 'Authorize another provider' : 'Authorize a model provider';
      dialog.append(link);
      const refresh = document.createElement('button');
      refresh.type = 'button';
      refresh.textContent = 'Refresh models';
      refresh.addEventListener('click', () => { dialog.close(); dialog.remove(); reject(new CellappAPIError(0, 'model_selection_refresh', 'Refresh model list')); });
      dialog.append(refresh);
    }
    const choose = document.createElement('button');
    choose.type = 'button';
    choose.textContent = 'Use this model';
    choose.disabled = models.length === 0;
    choose.addEventListener('click', () => {
      const selected = models.find(model => model.id === select.value);
      if (selected) { dialog.close(); dialog.remove(); resolve(selected); }
    });
    const cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.textContent = 'Cancel';
    cancel.addEventListener('click', () => { dialog.close(); dialog.remove(); reject(new CellappAPIError(0, 'model_selection_cancelled', 'Model selection was cancelled')); });
    dialog.addEventListener('cancel', event => { event.preventDefault(); cancel.click(); });
    dialog.append(choose, cancel);
    document.body.append(dialog);
    dialog.showModal();
  });
}

function modelUsage(value: unknown): ModelChatResult['usage'] {
  if (value === undefined || value === null) return undefined;
  if (!value || typeof value !== 'object') throw new CellappAPIError(502, 'invalid_response', 'Invalid model usage');
  const record = value as Record<string, unknown>;
  for (const tokens of [record.prompt_tokens, record.completion_tokens]) {
    if (tokens !== undefined && (!Number.isSafeInteger(tokens) || typeof tokens !== 'number' || tokens < 0)) {
      throw new CellappAPIError(502, 'invalid_response', 'Invalid model usage');
    }
  }
  return {prompt_tokens: record.prompt_tokens as number | undefined, completion_tokens: record.completion_tokens as number | undefined};
}

function modelResult(value: unknown): ModelChatResult {
  if (!value || typeof value !== 'object' || !('choices' in value) || !Array.isArray(value.choices) || value.choices.length === 0) {
    throw new CellappAPIError(502, 'invalid_response', 'Invalid model response');
  }
  const choices = value.choices.map((choice: unknown) => {
    if (!choice || typeof choice !== 'object' || !('message' in choice) || !choice.message || typeof choice.message !== 'object') {
      throw new CellappAPIError(502, 'invalid_response', 'Invalid model response');
    }
    const message = choice.message as Record<string, unknown>;
    if (message.content !== undefined && message.content !== null && typeof message.content !== 'string' ||
      message.tool_calls !== undefined && !Array.isArray(message.tool_calls)) {
      throw new CellappAPIError(502, 'invalid_response', 'Invalid model response');
    }
    return {message: {content: message.content as string | null | undefined, tool_calls: message.tool_calls as unknown[] | undefined}};
  });
  return {choices, usage: modelUsage('usage' in value ? value.usage : undefined)};
}

function modelChunk(value: unknown): ModelStreamChunk {
  if (!value || typeof value !== 'object' || !('choices' in value) || !Array.isArray(value.choices)) {
    throw new CellappAPIError(502, 'model_invalid_stream', 'Invalid model stream event');
  }
  const choices = value.choices.map((choice: unknown) => {
    if (!choice || typeof choice !== 'object' || !('delta' in choice) || !choice.delta || typeof choice.delta !== 'object') {
      throw new CellappAPIError(502, 'model_invalid_stream', 'Invalid model stream event');
    }
    const delta = choice.delta as Record<string, unknown>;
    if (delta.content !== undefined && delta.content !== null && typeof delta.content !== 'string' ||
      delta.tool_calls !== undefined && !Array.isArray(delta.tool_calls)) {
      throw new CellappAPIError(502, 'model_invalid_stream', 'Invalid model stream event');
    }
    return {delta: {content: delta.content as string | null | undefined, tool_calls: delta.tool_calls as unknown[] | undefined}};
  });
  return {choices, usage: modelUsage('usage' in value ? value.usage : undefined)};
}

export function createCellappClient() {
  const apiVersion = pageVersion();
  const origin = appOrigin();
  const versionedFetch: typeof fetch = (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input), origin);
    if (url.origin !== origin) throw new Error('Cellapp SDK request escaped the application origin');
    if (url.pathname.startsWith('/rest/v1/')) url.pathname = `/_cellapp/db/${url.pathname.slice('/rest/v1/'.length)}`;
    if (url.pathname !== '/_cellapp/me' && !url.pathname.startsWith('/_cellapp/db/')) throw new Error('Unsupported Cellapp SDK endpoint');
    url.searchParams.set('v', apiVersion);
    if (input instanceof Request) return fetch(new Request(url, input), {...init, credentials: 'same-origin'});
    return fetch(url, {...init, credentials: 'same-origin'});
  };
  const tables = createClient(origin, 'cellapp-public', {
    auth: {autoRefreshToken: false, persistSession: false, detectSessionInUrl: false},
    global: {fetch: versionedFetch},
  });
  const modelStorageKey = 'cellapp:model:v1';
  let memoryModel = '';
  let cachedCatalog: {models: CellappModel[]; authorizeUrl?: string; at: number} | null = null;
  const listModels = async (refresh = false): Promise<{models: CellappModel[]; authorizeUrl?: string}> => {
    modelVersion(apiVersion);
    if (!refresh && cachedCatalog && Date.now() - cachedCatalog.at < 30_000) return cachedCatalog;
    const response = await fetch(`${origin}/_cellapp/v1/models`, {credentials: 'same-origin', cache: 'no-store'});
    if (!response.ok) throw await responseError(response);
    let value: unknown;
    try { value = await response.json(); } catch { throw new CellappAPIError(502, 'invalid_response', 'Invalid model list'); }
    if (!value || typeof value !== 'object' || !('object' in value) || value.object !== 'list' || !('data' in value) || !Array.isArray(value.data)) {
      throw new CellappAPIError(502, 'invalid_response', 'Invalid model list');
    }
    const models = value.data.map((entry: unknown): CellappModel => {
      if (!entry || typeof entry !== 'object' || !('id' in entry) || typeof entry.id !== 'string' || !modelIDPattern.test(entry.id) ||
        !('owned_by' in entry) || typeof entry.owned_by !== 'string') throw new CellappAPIError(502, 'invalid_response', 'Invalid model list');
      return {id: entry.id, name: entry.id.split(':').slice(2).join(':'), provider: entry.owned_by};
    });
    const link = response.headers.get('Link') ?? '';
    const authorizeUrl = /^<([^>]+)>; rel="cellapp-authorize"$/.exec(link)?.[1];
    cachedCatalog = {models, authorizeUrl, at: Date.now()};
    return cachedCatalog;
  };
  const currentModel = async (forceSelection = false, refreshCatalog = false): Promise<CellappModel> => {
    let models: CellappModel[] = [];
    let authorizeUrl: string | undefined;
    try { ({models, authorizeUrl} = await listModels(refreshCatalog)); }
    catch (error) {
      if (!(error instanceof CellappAPIError) || error.code !== 'model_authorization_required') throw error;
      const details = error.details;
      if (details && typeof details === 'object' && 'authorizeUrl' in details && typeof details.authorizeUrl === 'string') authorizeUrl = details.authorizeUrl;
    }
    let saved = memoryModel;
    try { saved ||= localStorage.getItem(modelStorageKey) ?? ''; } catch { /* Private storage can be unavailable. */ }
    const selected = models.find(model => model.id === saved);
    if (selected && !forceSelection) return selected;
    let choice: CellappModel;
    try { choice = await modelSelection(models, authorizeUrl); }
    catch (error) {
      if (error instanceof CellappAPIError && error.code === 'model_selection_refresh') return currentModel(forceSelection, true);
      throw error;
    }
    memoryModel = choice.id;
    try { localStorage.setItem(modelStorageKey, choice.id); } catch { /* Keep the in-memory choice. */ }
    return choice;
  };
  const modelFetch = async (options: ModelChatOptions, stream: boolean) => {
    modelVersion(apiVersion);
    if (!Array.isArray(options.messages) || options.messages.length === 0) {
      throw new Error('Provide at least one message');
    }
    const model = options.model ?? (await currentModel()).id;
    if (!modelIDPattern.test(model)) throw new Error('Choose a valid Cellapp model');
    return fetch(`${origin}/_cellapp/v1/chat/completions`, {
      method: 'POST', credentials: 'same-origin', cache: 'no-store', signal: options.signal,
      headers: {'Content-Type': 'application/json', Accept: stream ? 'text/event-stream' : 'application/json'},
      body: JSON.stringify({model, messages: options.messages, tools: options.tools, max_tokens: options.max_tokens,
        max_completion_tokens: options.max_completion_tokens, temperature: options.temperature, top_p: options.top_p, stream}),
    });
  };
  return {
    apiVersion,
    models: {list: async () => (await listModels()).models, current: () => currentModel(), select: () => currentModel(true)},
    async currentUser(): Promise<AppUser> {
      const response = await versionedFetch(`${origin}/_cellapp/me`);
      if (!response.ok) throw await responseError(response);
      let value: unknown;
      try { value = await response.json(); } catch { throw new CellappAPIError(502, 'invalid_response', 'Invalid application identity response'); }
      if (!value || typeof value !== 'object' || typeof (value as Record<string, unknown>).id !== 'string' ||
        (value as Record<string, unknown>).access !== 'admitted') {
        throw new CellappAPIError(502, 'invalid_response', 'Invalid application identity response');
      }
      return {id: (value as {id: string}).id, access: 'admitted'};
    },
    from(table: string) {
      if (!tablePattern.test(table) || table.startsWith('_cellapp_') || table === 'rpc') throw new Error('Unsupported application table name');
      return tables.from(table);
    },
    async chat(options: ModelChatOptions): Promise<ModelChatResult> {
      const response = await modelFetch(options, false);
      if (!response.ok) throw await responseError(response);
      let value: unknown;
      try { value = await response.json(); } catch { throw new CellappAPIError(502, 'invalid_response', 'Invalid model response'); }
      return modelResult(value);
    },
    async *streamChat(options: ModelChatOptions): AsyncGenerator<ModelStreamChunk> {
      const response = await modelFetch(options, true);
      if (!response.ok) throw await responseError(response);
      if (!response.body) throw new CellappAPIError(502, 'model_invalid_stream', 'Model stream is unavailable');
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let received = 0;
      let done = false;
      try {
        while (!done) {
          const next = await reader.read();
          if (next.done) break;
          received += next.value.byteLength;
          if (received > 4 << 20) throw new CellappAPIError(502, 'model_invalid_stream', 'Model stream exceeds limit');
          buffer += decoder.decode(next.value, {stream: true}).replaceAll('\r\n', '\n');
          let boundary: number;
          while ((boundary = buffer.indexOf('\n\n')) >= 0) {
            const event = buffer.slice(0, boundary);
            buffer = buffer.slice(boundary + 2);
            const line = event.split('\n').find(line => line.startsWith('data: '));
            if (!line) continue;
            const data = line.slice(6);
            if (event.startsWith('event: error')) {
              let code = 'model_stream_interrupted';
              try { const parsed: unknown = JSON.parse(data); if (parsed && typeof parsed === 'object' && 'error' in parsed && typeof parsed.error === 'string') code = parsed.error; } catch { /* Keep the stable fallback code. */ }
              throw new CellappAPIError(502, code, 'Model stream was interrupted');
            }
            if (data === '[DONE]') { done = true; break; }
            let value: unknown;
            try { value = JSON.parse(data); } catch { throw new CellappAPIError(502, 'model_invalid_stream', 'Invalid model stream event'); }
            yield modelChunk(value);
          }
        }
        if (!done) throw new CellappAPIError(502, 'model_stream_interrupted', 'Model stream ended before completion');
      } finally { await reader.cancel().catch(() => {}); }
    },
  };
}
