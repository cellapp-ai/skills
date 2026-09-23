import { createHash } from 'node:crypto';
import { ensure } from './errors.js';

export interface Entry { path: string; size: number; sha256: string }
export interface Limits { files: number; fileBytes: number; deploymentBytes: number }
export const sha256 = (data: string | Buffer) => createHash('sha256').update(data).digest('hex');

export function validPath(path: unknown): asserts path is string {
  ensure(typeof path === 'string' && path.length > 0 && path.length <= 512, 400, 'invalid_path', 'Invalid artifact path');
  ensure(!/[\\\x00-\x1f\x7f%?#]/.test(path) && !path.startsWith('/'), 400, 'invalid_path', 'Unsafe artifact path');
  const parts = path.split('/');
  ensure(parts.every(p => p && p !== '.' && p !== '..'), 400, 'invalid_path', 'Unsafe artifact path');
  ensure(!parts.some(p => /^(?:\.|_hosting$|node_modules$|credentials(?:\.|$)|id_rsa$|id_ed25519$)/i.test(p)) && !/\.(pem|key|p12|pfx)$/i.test(path), 400, 'sensitive_path', 'Reserved or sensitive artifact path');
}

export function manifest(input: unknown, limits: Limits): Entry[] {
  ensure(Array.isArray(input) && input.length > 0 && input.length <= limits.files, 413, 'file_limit', 'Too many files or empty artifact');
  const seen = new Set<string>();
  let total = 0;
  const files = input.map((item: unknown) => {
    ensure(item && typeof item === 'object', 400, 'invalid_manifest', 'Invalid manifest entry');
    const e = item as Record<string, unknown>;
    ensure(Object.keys(e).every(k => ['path', 'size', 'sha256'].includes(k)), 400, 'invalid_manifest', 'Only regular files are supported');
    validPath(e.path);
    ensure(!seen.has(e.path), 400, 'duplicate_path', 'Duplicate artifact path'); seen.add(e.path);
    ensure(typeof e.size === 'number' && Number.isSafeInteger(e.size) && e.size >= 0 && e.size <= limits.fileBytes, 413, 'file_limit', 'File too large');
    ensure(typeof e.sha256 === 'string' && /^[a-f0-9]{64}$/.test(e.sha256), 400, 'invalid_digest', 'Invalid SHA-256');
    total += e.size;
    return {path: e.path, size: e.size, sha256: e.sha256};
  });
  ensure(seen.has('index.html'), 400, 'static_export_required', 'A static index.html is required');
  ensure(total <= limits.deploymentBytes, 413, 'deployment_limit', 'Deployment too large');
  return files.sort((a, b) => Buffer.compare(Buffer.from(a.path), Buffer.from(b.path)));
}
