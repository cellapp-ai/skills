import { createHash } from 'node:crypto';
export type DataColumn = { name: string; type: 'text' | 'uuid' | 'bigint' | 'boolean' | 'timestamptz' | 'jsonb'; nullable?: boolean };
export type DataIndex = { columns: string[]; unique?: boolean };
export type DataMode = 'none' | 'all-admitted-users' | 'own-rows';
export type DataPolicies = { select?: DataMode; insert?: DataMode; update?: DataMode; delete?: DataMode; ownerColumn?: string };
export type DataTable = { name: string; columns: DataColumn[]; primaryKey: string[]; indexes?: DataIndex[]; policies: DataPolicies };
export type DataManifest = { version: number; allowDestructive?: boolean; tables: DataTable[] };

const identifier = /^[a-z][a-z0-9_]{0,62}$/;
const columnTypes = new Set(['text', 'uuid', 'bigint', 'boolean', 'timestamptz', 'jsonb']);
const modes = new Set(['none', 'all-admitted-users', 'own-rows']);
const systemColumns = new Set(['ctid', 'tableoid', 'xmin', 'cmin', 'xmax', 'cmax']);
function object(value: unknown, keys: string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Expected an object in data manifest');
  const result = value as Record<string, unknown>;
  if (Object.keys(result).some(key => !keys.includes(key))) throw new Error('Unsupported field in data manifest');
  return result;
}
function name(value: unknown): string {
  if (typeof value !== 'string' || !identifier.test(value)) throw new Error('Invalid data identifier');
  return value;
}
function names(value: unknown, max: number): string[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > max) throw new Error('Invalid data column list');
  const result = value.map(name);
  if (new Set(result).size !== result.length) throw new Error('Duplicate data column');
  return result;
}
function mode(value: unknown): DataMode | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || !modes.has(value)) throw new Error('Invalid data policy');
  return value as DataMode;
}
export function parseDataManifest(input: unknown): DataManifest {
  const root = object(input, ['version', 'allowDestructive', 'tables']);
  if (!Number.isSafeInteger(root.version) || (root.version as number) < 1 || (root.version as number) > 1_000_000) throw new Error('Invalid data manifest version');
  if (root.allowDestructive !== undefined && typeof root.allowDestructive !== 'boolean') throw new Error('Invalid destructive-change flag');
  if (!Array.isArray(root.tables) || root.tables.length > 20) throw new Error('Invalid data table list');
  const tables = root.tables.map(value => {
    const table = object(value, ['name', 'columns', 'primaryKey', 'indexes', 'policies']);
    const tableName = name(table.name);
    if (tableName === 'rpc') throw new Error('Reserved data table name: rpc');
    if (!Array.isArray(table.columns) || table.columns.length < 1 || table.columns.length > 30) throw new Error('Invalid data columns');
    const columns = table.columns.map(value => {
      const column = object(value, ['name', 'type', 'nullable']);
      if (typeof column.type !== 'string' || !columnTypes.has(column.type) || (column.nullable !== undefined && typeof column.nullable !== 'boolean')) throw new Error('Unsupported data column');
      const columnName = name(column.name);
      if (systemColumns.has(columnName)) throw new Error(`Reserved PostgreSQL system column: ${columnName}`);
      return {name: columnName, type: column.type as DataColumn['type'], ...(column.nullable === undefined ? {} : {nullable: column.nullable})};
    });
    const columnNames = new Set(columns.map(column => column.name));
    if (columnNames.size !== columns.length) throw new Error('Duplicate data column');
    const primaryKey = names(table.primaryKey, 3);
    if (primaryKey.some(key => !columnNames.has(key) || columns.find(column => column.name === key)?.nullable)) throw new Error('Invalid primary key');
    if (table.indexes !== undefined && (!Array.isArray(table.indexes) || table.indexes.length > 10)) throw new Error('Invalid data indexes');
    const indexes = (table.indexes as unknown[] | undefined)?.map(value => {
      const index = object(value, ['columns', 'unique']);
      const indexColumns = names(index.columns, 3);
      if (indexColumns.some(column => !columnNames.has(column)) || (index.unique !== undefined && typeof index.unique !== 'boolean')) throw new Error('Invalid data index');
      return {columns: indexColumns, ...(index.unique === undefined ? {} : {unique: index.unique})};
    });
    const policies = object(table.policies, ['select', 'insert', 'update', 'delete', 'ownerColumn']);
    const parsedPolicies: DataPolicies = {select: mode(policies.select), insert: mode(policies.insert), update: mode(policies.update), delete: mode(policies.delete)};
    const ownRows = Object.values(parsedPolicies).includes('own-rows');
    if (ownRows) {
      if (typeof policies.ownerColumn !== 'string') throw new Error('own-rows requires an owner column');
      const ownerColumn = name(policies.ownerColumn);
      const column = columns.find(column => column.name === ownerColumn);
      if (!column || column.type !== 'text' || column.nullable) throw new Error('own-rows requires a non-null text owner column');
      parsedPolicies.ownerColumn = ownerColumn;
    } else if (policies.ownerColumn !== undefined) throw new Error('ownerColumn requires own-rows');
    return {name: tableName, columns, primaryKey, ...(indexes === undefined ? {} : {indexes}), policies: parsedPolicies};
  });
  if (new Set(tables.map(table => table.name)).size !== tables.length) throw new Error('Duplicate data table');
  const relations = new Set(tables.map(table => table.name));
  for (const table of tables) {
    for (const position of table.indexes?.keys() ?? []) {
      const digest = createHash('sha256').update(`${table.name}:${position}`).digest('hex').slice(0, 8);
      const indexName = `i_${table.name.slice(0, 40)}_${digest}`;
      if (relations.has(indexName)) throw new Error(`Generated index name conflicts with table or index: ${indexName}`);
      relations.add(indexName);
    }
  }
  return {version: root.version as number, ...(root.allowDestructive === undefined ? {} : {allowDestructive: root.allowDestructive as boolean}), tables};
}
