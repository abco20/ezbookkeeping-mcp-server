import * as z from 'zod/v4';
export const reference = z.union([
    z.string().min(1),
    z.object({
        id: z.string().optional(),
        name: z.string().optional(),
        parent_name: z.string().optional(),
        type: z.union([z.string(), z.number()]).optional()
    }).refine((value) => value.id || value.name, 'id or name is required')
]);
export const transactionType = z.enum(['balance_modification', 'income', 'expense', 'transfer']);
export const amount = z.string().regex(/^-?(?:0|[1-9]\d*)(?:\.\d{1,2})?$/, 'decimal amount with at most two fractional digits');
export const color = z.string().regex(/^[0-9A-Fa-f]{6}$/);
export const accountCategory = z.enum(['cash', 'checking', 'credit_card', 'virtual', 'debt', 'receivable', 'investment', 'savings', 'certificate_of_deposit']);
export const accountCreate = z.object({
    name: z.string().min(1).max(64),
    category: accountCategory,
    type: z.enum(['single', 'parent']),
    icon: z.union([z.string(), z.number().int().positive()]).optional(),
    color: color.optional(),
    currency: z.string().length(3).optional(),
    balance: amount.optional(),
    balance_time: z.string().optional(),
    comment: z.string().max(255).optional(),
    credit_card_statement_date: z.number().int().min(0).max(28).optional(),
    sub_accounts: z.array(z.object({
        name: z.string().min(1).max(64),
        category: accountCategory.optional(),
        icon: z.union([z.string(), z.number().int().positive()]).optional(),
        color: color.optional(),
        currency: z.string().length(3).optional(),
        balance: amount.optional(),
        balance_time: z.string().optional(),
        comment: z.string().max(255).optional(),
        credit_card_statement_date: z.number().int().min(0).max(28).optional()
    })).optional()
});
export const accountPatch = z.object({
    name: z.string().min(1).max(64).optional(),
    category: accountCategory.optional(),
    icon: z.union([z.string(), z.number().int().positive()]).optional(),
    color: color.optional(),
    currency: z.string().length(3).optional(),
    balance: amount.optional(),
    balance_time: z.string().optional(),
    last_reconciled_time: z.string().optional(),
    comment: z.string().max(255).optional(),
    credit_card_statement_date: z.number().int().min(0).max(28).optional(),
    hidden: z.boolean().optional()
});
export const categoryCreate = z.object({
    name: z.string().min(1).max(64),
    type: z.enum(['income', 'expense', 'transfer']).optional(),
    parent: reference.optional(),
    icon: z.union([z.string(), z.number().int().positive()]).optional(),
    color: color.optional(),
    comment: z.string().max(255).optional()
});
export const categoryPatch = z.object({
    name: z.string().min(1).max(64).optional(),
    parent: z.union([reference, z.null()]).optional(),
    icon: z.union([z.string(), z.number().int().positive()]).optional(),
    color: color.optional(),
    comment: z.string().max(255).optional(),
    hidden: z.boolean().optional()
});
export const tagCreate = z.object({ name: z.string().min(1).max(64), group: reference.optional() });
export const tagPatch = z.object({ name: z.string().min(1).max(64).optional(), group: z.union([reference, z.null()]).optional() });
export const schedule = z.object({
    frequency_type: z.enum(['disabled', 'weekly', 'monthly', 'daily', 'yearly', 'every_n_days']),
    frequency: z.union([z.string(), z.number()]).optional(),
    start_date: z.string(),
    end_date: z.string().optional(),
    utc_offset: z.number().int().min(-720).max(840).optional()
});
export const templateCreate = z.object({
    template_type: z.enum(['normal', 'schedule']).default('normal'),
    name: z.string().min(1).max(64),
    type: transactionType,
    category: reference.optional(),
    source_account: reference,
    destination_account: reference.optional(),
    source_amount: amount,
    destination_amount: amount.optional(),
    hide_amount: z.boolean().optional(),
    tags: z.array(reference).max(10).optional(),
    comment: z.string().max(255).optional(),
    schedule: schedule.optional()
});
export const templatePatch = z.object({
    name: z.string().min(1).max(64).optional(),
    type: transactionType.optional(),
    category: reference.optional(),
    source_account: reference.optional(),
    destination_account: reference.optional(),
    source_amount: amount.optional(),
    destination_amount: amount.optional(),
    hide_amount: z.boolean().optional(),
    tags: z.array(reference).max(10).optional(),
    comment: z.string().max(255).optional(),
    schedule: schedule.partial().optional()
});
export const selectorShape = {
    start_time: z.string().optional().describe('RFC 3339 inclusive lower bound'),
    end_time: z.string().optional().describe('RFC 3339 inclusive upper bound'),
    type: transactionType.optional(),
    categories: z.array(reference).optional(),
    accounts: z.array(reference).optional(),
    tags_any: z.array(reference).optional(),
    tags_all: z.array(reference).optional(),
    tags_none: z.array(reference).optional(),
    no_tags: z.boolean().optional(),
    keyword: z.string().optional(),
    ignore_case: z.boolean().optional(),
    amount_filter: z.union([
        z.string(),
        z.object({ op: z.enum(['gt', 'lt', 'eq', 'ne']), value: z.string() }),
        z.object({ op: z.literal('between'), min: z.string(), max: z.string() })
    ]).optional(),
    must_have_pictures: z.boolean().optional()
};

export type AccountCreateInput = z.infer<typeof accountCreate>;
export type AccountPatchInput = z.infer<typeof accountPatch>;
export type CategoryCreateInput = z.infer<typeof categoryCreate>;
export type CategoryPatchInput = z.infer<typeof categoryPatch>;
export type TagCreateInput = z.infer<typeof tagCreate>;
export type TagPatchInput = z.infer<typeof tagPatch>;
export type TemplateCreateInput = z.infer<typeof templateCreate>;
export type TemplatePatchInput = z.infer<typeof templatePatch>;
