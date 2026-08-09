export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };
export type UnknownRecord = Record<string, unknown>;

export type EntityId = string | number;

export interface EntityReferenceObject {
  id?: string | undefined;
  name?: string | undefined;
  parent_name?: string | undefined;
  type?: string | number | undefined;
}

export type EntityReference = string | EntityReferenceObject;

export interface NamedEntity extends UnknownRecord {
  id: EntityId;
  name: string;
  path?: string;
  parentName?: string;
  parentId?: EntityId;
  type?: number;
  hidden?: boolean;
}

export interface Account extends NamedEntity {
  type: number;
  category?: number;
  currency: string;
  balance?: string | number;
  subAccounts?: Account[];
}

export interface Category extends NamedEntity {
  type: number;
  parentId: EntityId;
  subCategories?: Category[];
}

export interface Tag extends NamedEntity {
  groupId?: EntityId;
  groupName?: string;
}

export type TagGroup = NamedEntity;

export interface TransactionPicture extends UnknownRecord {
  pictureId: EntityId;
}

export interface GeoLocation extends UnknownRecord {
  latitude?: number;
  longitude?: number;
}

export interface RawTransaction extends UnknownRecord {
  id: EntityId;
  type: number;
  categoryId?: EntityId;
  category?: Category | null;
  time: number;
  utcOffset: number;
  sourceAccountId: EntityId;
  sourceAccount?: Account | null;
  destinationAccountId?: EntityId;
  destinationAccount?: Account | null;
  sourceAmount: string | number;
  destinationAmount?: string | number | null;
  hideAmount?: boolean;
  tagIds?: EntityId[];
  tags?: Tag[];
  pictures?: TransactionPicture[];
  comment?: string;
  geoLocation?: GeoLocation | null;
  editable?: boolean;
}

export type QueryValue = string | number | boolean | readonly (string | number | boolean)[] | UnknownRecord | null | undefined;
export type QueryParams = Record<string, QueryValue>;

export interface ApiClient {
  config: EzBookkeepingConfig;
  get<T>(path: string, query?: QueryParams, options?: { timeoutMs?: number }): Promise<T>;
  post<T>(path: string, body: UnknownRecord, options?: { timeoutMs?: number }): Promise<T>;
}

export interface AuditWriter {
  lastError?: string | null;
  ensureWritable?(): Promise<void>;
  write(event: UnknownRecord): Promise<string | null>;
}

export type WriteProfile = 'read' | 'standard' | 'extended' | 'admin';
export type McpTransport = 'stdio' | 'http';

export interface EzBookkeepingConfig {
  baseUrl: string;
  apiToken: string;
  timezone: string;
  timezoneOffset: number;
  timeoutMs: number;
}

export interface McpConfig {
  name: string;
  version: string;
  transport: McpTransport;
  host: string;
  port: number;
  httpAllowedHosts?: string[] | undefined;
  httpBearerToken: string;
  allowUnauthenticatedHttp: boolean;
  writeProfile: WriteProfile;
  confirmationSecret: string;
  confirmationTtlSeconds: number;
  batchUpdateLimit: number;
  auditLogPath: string;
}

export interface AppConfig {
  ezbookkeeping: EzBookkeepingConfig;
  mcp: McpConfig;
}

export interface ServiceConfig {
  writeProfile: WriteProfile;
  batchUpdateLimit: number;
}
