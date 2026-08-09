import type { Account, ApiClient, AuditWriter, Category, NamedEntity, Tag, UnknownRecord } from '../../types.js';
import type { ConfirmedDeleteOptions, ManageTemplateInput, ServiceDependencies, TemplateEntity, TemplateInput, TemplatePatch, TransactionTypeName } from '../../domain-types.js';
import { AppError, assert } from '../../lib/errors.js';
import { decimalToMinor, minorToDecimal } from '../../lib/amounts.js';
import { requireProfile } from '../../lib/permissions.js';
import { objectRevision } from '../../lib/revision.js';
import { parseEntityDeletePayload } from '../../confirmation-payloads.js';
const TEMPLATE_TYPE: Record<string, number> = { normal: 1, schedule: 2 };
const SCHEDULE_FREQUENCY: Record<string, number> = { disabled: 0, weekly: 1, monthly: 2, daily: 3, yearly: 4, every_n_days: 5 };
const TRANSACTION_CATEGORY_TYPE: Record<string, number> = { income: 1, expense: 2, transfer: 3 };
function assertTransactionAccount(account: Account | null | undefined, label = 'account'): asserts account is Account {
    assert(account, 'ACCOUNT_REQUIRED', `${label} is required`);
    assert(!account.hidden, 'HIDDEN_ACCOUNT_NOT_ALLOWED', `Cannot use hidden ${label}`);
    assert(Number(account.type) !== 2, 'PARENT_ACCOUNT_NOT_ALLOWED', `Cannot use a parent ${label} for transactions or templates`);
}
function assertTransactionCategory(category: Category | null | undefined, transactionType: TransactionTypeName): asserts category is Category {
    assert(category, 'CATEGORY_REQUIRED', 'A secondary category is required');
    assert(String(category.parentId ?? '0') !== '0', 'PRIMARY_CATEGORY_NOT_ALLOWED', 'Transactions and templates must use a secondary category');
    assert(!category.hidden, 'HIDDEN_CATEGORY_NOT_ALLOWED', 'Cannot use a hidden category');
    assert(Number(category.type) === TRANSACTION_CATEGORY_TYPE[transactionType], 'CATEGORY_TYPE_MISMATCH', `Category type does not match ${transactionType}`);
}
function assertVisibleTags(tags: Tag[]) {
    assert(tags.every((tag) => !tag.hidden), 'HIDDEN_TAG_NOT_ALLOWED', 'Cannot use hidden tags');
}
export class MasterTemplateMethods {
    declare client: ApiClient;
    declare catalog: ServiceDependencies['catalog'];
    declare signer: ServiceDependencies['signer'];
    declare audit: AuditWriter;
    declare config: ServiceDependencies['config'];
    async listTemplates({ template_type }: { template_type?: 'normal' | 'schedule' | undefined } = {}) {
        const templates = await this.catalog.templates(template_type ? TEMPLATE_TYPE[template_type] : undefined, { refresh: true });
        return (templates as TemplateEntity[]).map((template) => ({
            ...template,
            source_amount_decimal: template.sourceAmount == null ? undefined : minorToDecimal(template.sourceAmount),
            destination_amount_decimal: template.destinationAmount == null ? undefined : minorToDecimal(template.destinationAmount)
        }));
    }
    async manageTemplate(input: ManageTemplateInput): Promise<unknown> {
        requireProfile(this.config.writeProfile, 'extended', 'manage_template');
        const op = input.operation;
        if (op === 'create') {
            assert(input.template, 'TEMPLATE_REQUIRED', 'template is required for create');
            const body = await this.buildTemplateBody(input.template);
            const result = await this.client.post<{ id: string | number }>('transaction/templates/add.json', body);
            this.catalog.invalidate('templates');
            await this.audit.write({ tool: 'manage_template', operation: op, target_ids: [String(result.id)], normalized_arguments: body, result: 'success' });
            return result;
        }
        if (op === 'update') {
            assert(input.template_ref, 'TEMPLATE_REFERENCE_REQUIRED', 'template_ref is required for update');
            const template = await this.catalog.resolveTemplate(input.template_ref, input.template_type ? TEMPLATE_TYPE[input.template_type] : undefined);
            const current = await this.client.get<RawTemplate>('transaction/templates/get.json', { id: String(template.id) });
            const merged = templateResponseToInput(current, input.patch ?? {});
            const built = await this.buildTemplateBody(merged, current.templateType);
            const templateBody: UnknownRecord = { ...built };
            Reflect.deleteProperty(templateBody, 'templateType');
            const body = { id: String(current.id), ...templateBody };
            const result = await this.client.post<unknown>('transaction/templates/modify.json', body);
            this.catalog.invalidate('templates');
            await this.audit.write({ tool: 'manage_template', operation: op, target_ids: [String(current.id)], normalized_arguments: body, result: 'success' });
            return result;
        }
        if (op === 'hide' || op === 'unhide') {
            assert(input.template_ref, 'TEMPLATE_REFERENCE_REQUIRED', 'template_ref is required');
            const template = await this.catalog.resolveTemplate(input.template_ref, input.template_type ? TEMPLATE_TYPE[input.template_type] : undefined);
            const result = await this.client.post<unknown>('transaction/templates/hide.json', { id: String(template.id), hidden: op === 'hide' });
            this.catalog.invalidate('templates');
            await this.audit.write({ tool: 'manage_template', operation: op, target_ids: [String(template.id)], result: 'success' });
            return result;
        }
        if (op === 'move') {
            assert(input.orders?.length, 'ORDERS_REQUIRED', 'orders are required for move');
            const orders = await Promise.all(input.orders.map(async (entry) => ({ id: String((await this.catalog.resolveTemplate(entry.template, input.template_type ? TEMPLATE_TYPE[input.template_type] : undefined)).id), displayOrder: entry.display_order })));
            const result = await this.client.post<unknown>('transaction/templates/move.json', { newDisplayOrders: orders });
            this.catalog.invalidate('templates');
            await this.audit.write({ tool: 'manage_template', operation: op, target_ids: orders.map((item) => item.id), result: 'success' });
            return result;
        }
        if (op === 'delete')
            return this.confirmedDelete({
                entity: 'template', reference: input.template_ref, mode: input.mode, token: input.confirmation_token,
                requiredProfile: 'extended', resolve: () => this.catalog.resolveTemplate(input.template_ref, input.template_type ? TEMPLATE_TYPE[input.template_type] : undefined),
                endpoint: 'transaction/templates/delete.json', invalidate: 'templates'
            });
        throw new AppError('INVALID_OPERATION', 'Unsupported template operation');
    }
    async buildTemplateBody(template: TemplateInput, forcedType?: number): Promise<UnknownRecord & { templateType: number }> {
        const templateType = forcedType ?? TEMPLATE_TYPE[template.template_type ?? 'normal'];
        assert(templateType, 'INVALID_TEMPLATE_TYPE', `Unsupported template type: ${template.template_type}`);
        const transactionTypes: Record<string, number> = { balance_modification: 1, income: 2, expense: 3, transfer: 4 };
        const typeCode = transactionTypes[template.type];
        assert(typeCode, 'INVALID_TRANSACTION_TYPE', `Unsupported transaction type: ${template.type}`);
        const category = typeCode === 1 ? null : await this.catalog.resolveCategory(template.category);
        const source = await this.catalog.resolveAccount(template.source_account);
        const destination = template.type === 'transfer' ? await this.catalog.resolveAccount(template.destination_account) : null;
        const tags = template.tags?.length ? await Promise.all(template.tags.map((ref) => this.catalog.resolveTag(ref))) : [];
        assertTransactionAccount(source, 'source account');
        if (destination) {
            assertTransactionAccount(destination, 'destination account');
            assert(String(source.id) !== String(destination.id), 'SAME_TRANSFER_ACCOUNT', 'Source and destination accounts must differ');
        }
        if (category)
            assertTransactionCategory(category, template.type);
        assertVisibleTags(tags);
        assert(tags.length <= 10, 'TOO_MANY_TAGS', 'ezBookkeeping permits at most 10 tags per template');
        const schedule = template.schedule ?? {};
        const scheduleFrequencyType = schedule.frequency_type === undefined ? undefined : SCHEDULE_FREQUENCY[schedule.frequency_type];
        if (templateType === 2) {
            assert(scheduleFrequencyType !== undefined, 'INVALID_SCHEDULE_FREQUENCY', 'A scheduled template requires a valid frequency_type');
            assert(schedule.start_date, 'SCHEDULE_START_DATE_REQUIRED', 'A scheduled template requires start_date');
        }
        return {
            templateType,
            name: template.name,
            type: typeCode,
            categoryId: category ? String(category.id) : '0',
            sourceAccountId: String(source.id),
            destinationAccountId: destination ? String(destination.id) : '0',
            sourceAmount: decimalToMinor(template.source_amount),
            destinationAmount: destination ? decimalToMinor(template.destination_amount ?? template.source_amount) : 0,
            hideAmount: template.hide_amount ?? false,
            tagIds: tags.map((tag) => String(tag.id)),
            comment: template.comment ?? '',
            scheduledFrequencyType: templateType === 2 ? scheduleFrequencyType : undefined,
            scheduledFrequency: templateType === 2 ? String(schedule.frequency ?? '') : undefined,
            scheduledStartDate: templateType === 2 ? schedule.start_date : undefined,
            scheduledEndDate: templateType === 2 ? schedule.end_date : undefined,
            utcOffset: templateType === 2 ? (schedule.utc_offset ?? this.client.config.timezoneOffset) : undefined
        };
    }
    async confirmedDelete({ entity, mode, token, requiredProfile, resolve, endpoint, invalidate, extraInvalidate }: ConfirmedDeleteOptions): Promise<unknown> {
        requireProfile(this.config.writeProfile, requiredProfile, `delete_${entity}`);
        const action = `delete_${entity}`;
        if (mode === 'preview') {
            this.catalog.invalidate(invalidate);
            if (extraInvalidate)
                this.catalog.invalidate(extraInvalidate);
            const item = await resolve();
            const revision = objectRevision(item);
            const confirmation = this.signer.issue(action, { id: String(item.id), revision });
            return { item: { ...item, revision }, confirmation_token: confirmation.token, expires_at: confirmation.expires_at };
        }
        if (mode !== 'apply')
            throw new AppError('INVALID_MODE', 'mode must be preview or apply');
        assert(token, 'CONFIRMATION_TOKEN_REQUIRED', 'confirmation_token is required for apply');
        const payload = this.signer.verify(token, action, parseEntityDeletePayload);
        this.catalog.invalidate(invalidate);
        if (extraInvalidate)
            this.catalog.invalidate(extraInvalidate);
        const current = await resolve();
        assert(String(current.id) === String(payload.id), 'CONFIRMATION_TARGET_MISMATCH', `Confirmation token targets another ${entity}`);
        assert(objectRevision(current) === payload.revision, 'ENTITY_CHANGED', `${entity} changed after deletion preview`);
        await this.client.post(endpoint, { id: String(current.id) });
        this.catalog.invalidate(invalidate);
        if (extraInvalidate)
            this.catalog.invalidate(extraInvalidate);
        const auditId = await this.audit.write({ tool: `delete_${entity}`, target_ids: [String(current.id)], result: 'success' });
        return { deleted: true, id: String(current.id), audit_id: auditId };
    }
}
function templateResponseToInput(current: RawTemplate, patch: TemplatePatch): TemplateInput {
    const typeNames: Record<number, TransactionTypeName> = { 1: 'balance_modification', 2: 'income', 3: 'expense', 4: 'transfer' };
    const typeName = typeNames[current.type];
    assert(typeName, 'INVALID_TRANSACTION_TYPE', `Unsupported upstream transaction type: ${current.type}`);
    const frequencyNames: Record<number, NonNullable<NonNullable<TemplateInput['schedule']>['frequency_type']>> = { 0: 'disabled', 1: 'weekly', 2: 'monthly', 3: 'daily', 4: 'yearly', 5: 'every_n_days' };
    const frequencyName = current.scheduledFrequencyType === undefined ? undefined : frequencyNames[current.scheduledFrequencyType];
    return {
        template_type: current.templateType === 2 ? 'schedule' : 'normal',
        name: patch.name ?? current.name,
        type: patch.type ?? typeName,
        category: (patch.type ?? typeName) === 'balance_modification'
            ? undefined
            : patch.category ?? { id: String(current.categoryId) },
        source_account: patch.source_account ?? { id: String(current.sourceAccountId) },
        destination_account: patch.destination_account ?? (current.destinationAccountId && String(current.destinationAccountId) !== '0' ? { id: String(current.destinationAccountId) } : undefined),
        source_amount: patch.source_amount ?? minorToDecimal(current.sourceAmount),
        destination_amount: patch.destination_amount ?? (current.destinationAmount == null ? undefined : minorToDecimal(current.destinationAmount)),
        hide_amount: patch.hide_amount ?? current.hideAmount,
        tags: patch.tags ?? (current.tagIds ?? []).map((id) => ({ id: String(id) })),
        comment: patch.comment ?? current.comment,
        schedule: {
            frequency_type: frequencyName,
            frequency: current.scheduledFrequency,
            start_date: current.scheduledStartDate,
            end_date: current.scheduledEndDate,
            utc_offset: current.utcOffset,
            ...(patch.schedule ?? {})
        }
    };
}
interface RawTemplate extends NamedEntity {
    templateType: number;
    type: number;
    categoryId: string | number;
    sourceAccountId: string | number;
    destinationAccountId?: string | number;
    sourceAmount: string | number;
    destinationAmount?: string | number | null;
    hideAmount?: boolean;
    tagIds?: (string | number)[];
    comment?: string;
    scheduledFrequencyType?: number;
    scheduledFrequency?: string;
    scheduledStartDate?: string;
    scheduledEndDate?: string | null;
    utcOffset?: number;
}
