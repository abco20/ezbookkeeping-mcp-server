import type {
  Account, ApiClient, AuditWriter, Category, EntityId, EntityReference, GeoLocation, NamedEntity,
  RawTransaction, ServiceConfig, Tag, TagGroup, UnknownRecord, WriteProfile
} from './types.js';
import type { ConfirmationSigner } from './lib/confirmation.js';
import type { AmountFilter } from './lib/amounts.js';
import type {
  AccountCreateInput, AccountPatchInput, CategoryCreateInput, CategoryPatchInput,
  TagCreateInput, TagPatchInput, TemplateCreateInput, TemplatePatchInput
} from './tools/schemas.js';

export type TransactionTypeName = 'balance_modification' | 'income' | 'expense' | 'transfer';

export interface TransactionSelector {
  start_time?: string | undefined;
  end_time?: string | undefined;
  type?: TransactionTypeName | undefined;
  categories?: EntityReference[] | undefined;
  accounts?: EntityReference[] | undefined;
  tags_any?: EntityReference[] | undefined;
  tags_all?: EntityReference[] | undefined;
  tags_none?: EntityReference[] | undefined;
  no_tags?: boolean | undefined;
  keyword?: string | undefined;
  ignore_case?: boolean | undefined;
  amount_filter?: AmountFilter | undefined;
  must_have_pictures?: boolean | undefined;
}

export interface TransactionSearchInput extends TransactionSelector {
  cursor?: string | undefined;
  limit?: number | undefined;
  with_pictures?: boolean | undefined;
}

export interface CreateTransactionInput {
  type: TransactionTypeName;
  category?: EntityReference | undefined;
  time?: string | undefined;
  utc_offset?: number | undefined;
  source_account: EntityReference;
  destination_account?: EntityReference | undefined;
  source_amount: string;
  destination_amount?: string | undefined;
  hide_amount?: boolean | undefined;
  tags?: EntityReference[] | undefined;
  comment?: string | undefined;
  geo_location?: GeoLocation | undefined;
  client_session_id?: string | undefined;
}

export interface TransactionPatch {
  type?: TransactionTypeName | undefined;
  category?: EntityReference | undefined;
  time?: string | undefined;
  utc_offset?: number | undefined;
  source_account?: EntityReference | undefined;
  destination_account?: EntityReference | undefined;
  source_amount?: string | undefined;
  destination_amount?: string | undefined;
  hide_amount?: boolean | undefined;
  tags_set?: EntityReference[] | undefined;
  tags_add?: EntityReference[] | undefined;
  tags_remove?: EntityReference[] | undefined;
  comment?: string | undefined;
  geo_location?: GeoLocation | null | undefined;
}

export interface NormalizedTransaction {
  id: string;
  revision: string;
  type: string;
  type_code: number;
  time: string;
  unix_time: number;
  utc_offset: number;
  category: { id: string; name?: string };
  source_account: { id: string; name?: string; currency?: string };
  destination_account: { id: string; name?: string; currency?: string } | null;
  source_amount: string;
  source_amount_minor: string;
  destination_amount: string | null;
  destination_amount_minor: string | null;
  hide_amount: boolean;
  tags: { id: string; name: string; group_id: string }[];
  tag_ids: string[];
  pictures?: RawTransaction['pictures'];
  comment: string;
  geo_location: GeoLocation | null;
  editable: boolean;
}

export interface TransactionSearchResult {
  total_count: number;
  next_cursor: string | null;
  transactions: NormalizedTransaction[];
}

export type BatchOperation =
  | { type: 'set_category'; category: EntityReference }
  | { type: 'add_tags' | 'remove_tags'; tags: EntityReference[] }
  | { type: 'clear_tags' }
  | { type: 'set_source_account' | 'set_destination_account'; account: EntityReference };

export type ResolvedBatchOperation =
  | { type: 'set_category'; categoryId: string; categoryType: number; categoryName: string; parentId: string; hidden: boolean }
  | { type: 'add_tags'; tagIds: string[]; tags: { id: string; name: string; hidden: boolean }[] }
  | { type: 'remove_tags'; tagIds: string[]; tags: { id: string; name: string }[] }
  | { type: 'clear_tags' }
  | { type: 'set_source_account' | 'set_destination_account'; accountId: string; accountName: string; currency: string; accountType: number; hidden: boolean; isDestinationAccount: boolean };

export interface BatchConfirmationPayload extends UnknownRecord {
  transaction_ids: string[];
  revisions: Record<string, string>;
  operation: ResolvedBatchOperation;
}

export interface DeleteTransactionPayload extends UnknownRecord {
  transaction_id: string;
  revision: string;
}

export interface TemplateEntity extends NamedEntity {
  templateType?: number;
  sourceAmount?: string | number;
  destinationAmount?: string | number | null;
  categoryId?: EntityId;
  sourceAccountId?: EntityId;
  destinationAccountId?: EntityId;
  tagIds?: EntityId[];
  hideAmount?: boolean;
  comment?: string;
  scheduledFrequencyType?: number;
  scheduledFrequency?: string;
  scheduledStartDate?: string;
  scheduledEndDate?: string | null;
  utcOffset?: number;
}

export interface ServiceDependencies {
  client: ApiClient;
  catalog: {
    invalidate(kind: 'accounts' | 'categories' | 'tagGroups' | 'tags' | 'templates'): void;
    accounts(options?: { refresh?: boolean }): Promise<Account[]>;
    categories(options?: { refresh?: boolean }): Promise<Category[]>;
    tags(options?: { refresh?: boolean }): Promise<Tag[]>;
    tagGroups(options?: { refresh?: boolean }): Promise<TagGroup[]>;
    templates(templateType?: number, options?: { refresh?: boolean }): Promise<NamedEntity[]>;
    resolveAccount(reference: EntityReference | null | undefined): Promise<Account>;
    resolveCategory(reference: EntityReference | null | undefined): Promise<Category>;
    resolveTag(reference: EntityReference | null | undefined): Promise<Tag>;
    resolveTagGroup(reference: EntityReference | null | undefined): Promise<TagGroup>;
    resolveTemplate(reference: EntityReference | null | undefined, templateType?: number): Promise<NamedEntity>;
  };
  signer: ConfirmationSigner;
  audit: AuditWriter;
  config: ServiceConfig;
}

export type ManageOperation = 'create' | 'update' | 'hide' | 'unhide' | 'move' | 'delete';

interface ConfirmationFields {
  mode?: 'preview' | 'apply' | undefined;
  confirmation_token?: string | undefined;
}

export interface ManageAccountInput extends ConfirmationFields {
  operation: ManageOperation;
  account?: AccountCreateInput | undefined;
  account_ref?: EntityReference | undefined;
  patch?: AccountPatchInput | undefined;
  orders?: { account: EntityReference; display_order: number }[] | undefined;
}

export interface ManageCategoryInput extends ConfirmationFields {
  operation: ManageOperation;
  category?: CategoryCreateInput | undefined;
  category_ref?: EntityReference | undefined;
  patch?: CategoryPatchInput | undefined;
  orders?: { category: EntityReference; display_order: number }[] | undefined;
}

export interface ManageTagGroupInput extends ConfirmationFields {
  operation: 'create' | 'update' | 'move' | 'delete';
  group?: { name: string } | undefined;
  group_ref?: EntityReference | undefined;
  patch?: { name?: string | undefined } | undefined;
  orders?: { group: EntityReference; display_order: number }[] | undefined;
}

export interface ManageTagInput extends ConfirmationFields {
  operation: ManageOperation;
  tag?: TagCreateInput | undefined;
  tag_ref?: EntityReference | undefined;
  patch?: TagPatchInput | undefined;
  orders?: { tag: EntityReference; display_order: number }[] | undefined;
}

export interface ManageTemplateInput extends ConfirmationFields {
  operation: ManageOperation;
  template_type?: 'normal' | 'schedule' | undefined;
  template?: TemplateCreateInput | undefined;
  template_ref?: EntityReference | undefined;
  patch?: TemplatePatchInput | undefined;
  orders?: { template: EntityReference; display_order: number }[] | undefined;
}

export interface TemplateInput {
  template_type?: 'normal' | 'schedule' | undefined;
  name: string;
  type: TransactionTypeName;
  category?: EntityReference | undefined;
  source_account: EntityReference;
  destination_account?: EntityReference | undefined;
  source_amount: string;
  destination_amount?: string | undefined;
  hide_amount?: boolean | undefined;
  tags?: EntityReference[] | undefined;
  comment?: string | undefined;
  schedule?: {
    frequency_type?: 'disabled' | 'weekly' | 'monthly' | 'daily' | 'yearly' | 'every_n_days' | undefined;
    frequency?: string | number | undefined;
    start_date?: string | undefined;
    end_date?: string | null | undefined;
    utc_offset?: number | undefined;
  } | undefined;
}
export type TemplatePatch = TemplatePatchInput;

export interface ConfirmedDeleteOptions {
  entity: string;
  reference?: EntityReference | undefined;
  mode?: 'preview' | 'apply' | undefined;
  token?: string | undefined;
  requiredProfile: WriteProfile;
  resolve: () => Promise<NamedEntity>;
  endpoint: string;
  invalidate: 'accounts' | 'categories' | 'tagGroups' | 'tags' | 'templates';
  extraInvalidate?: 'accounts' | 'categories' | 'tagGroups' | 'tags' | 'templates' | undefined;
}

export interface EntityDeletePayload extends UnknownRecord {
  id: string;
  revision: string;
}
