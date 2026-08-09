import type { ApiClient, AppConfig, AuditWriter } from './types.js';
import type { ServiceDependencies } from './domain-types.js';
import { EzBookkeepingClient } from './lib/ezbk-client.js';
import { ConfirmationSigner } from './lib/confirmation.js';
import { AuditLog } from './lib/audit-log.js';
import { CatalogService } from './services/catalog-service.js';
import { TransactionService } from './services/transaction-service.js';
import { MasterService } from './services/master-service.js';
import { AnalyticsService } from './services/analytics-service.js';
export interface Runtime {
    config: AppConfig;
    client: ApiClient;
    signer: ConfirmationSigner;
    audit: AuditWriter;
    catalog: ServiceDependencies['catalog'];
    transactionService: TransactionService;
    masterService: MasterService;
    analyticsService: AnalyticsService;
}
interface RuntimeOptions {
    client?: ApiClient;
    fetchImpl?: typeof globalThis.fetch;
    signer?: ConfirmationSigner;
    audit?: AuditWriter;
    catalog?: ServiceDependencies['catalog'];
}
export function createRuntime(config: AppConfig, options: RuntimeOptions = {}): Runtime {
    const client = options.client ?? new EzBookkeepingClient(config.ezbookkeeping, options.fetchImpl);
    const signer = options.signer ?? new ConfirmationSigner(config.mcp.confirmationSecret, config.mcp.confirmationTtlSeconds);
    const audit = options.audit ?? new AuditLog(config.mcp.auditLogPath);
    const catalog = options.catalog ?? new CatalogService(client);
    const serviceConfig = {
        writeProfile: config.mcp.writeProfile,
        batchUpdateLimit: config.mcp.batchUpdateLimit
    };
    return {
        config,
        client,
        signer,
        audit,
        catalog,
        transactionService: new TransactionService({ client, catalog, signer, audit, config: serviceConfig }),
        masterService: new MasterService({ client, catalog, signer, audit, config: serviceConfig }),
        analyticsService: new AnalyticsService({ client, catalog, audit, config: serviceConfig })
    };
}
