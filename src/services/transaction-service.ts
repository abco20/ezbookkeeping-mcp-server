import type { ServiceDependencies } from '../domain-types.js';
import { TransactionReadMethods } from './transaction/read-methods.js';
import { TransactionWriteMethods } from './transaction/write-methods.js';
import { TransactionBatchMethods } from './transaction/batch-methods.js';
class TransactionServiceBase {
    readonly client: ServiceDependencies['client'];
    readonly catalog: ServiceDependencies['catalog'];
    readonly signer: ServiceDependencies['signer'];
    readonly audit: ServiceDependencies['audit'];
    readonly config: ServiceDependencies['config'];
    constructor({ client, catalog, signer, audit, config }: ServiceDependencies) {
        this.client = client;
        this.catalog = catalog;
        this.signer = signer;
        this.audit = audit;
        this.config = config;
    }
}
export type TransactionService = TransactionServiceBase & TransactionReadMethods & TransactionWriteMethods & TransactionBatchMethods;
export const TransactionService = TransactionServiceBase as unknown as {
    new(...args: ConstructorParameters<typeof TransactionServiceBase>): TransactionService;
};
for (const Source of [TransactionReadMethods, TransactionWriteMethods, TransactionBatchMethods]) {
    const descriptors = Object.getOwnPropertyDescriptors(Source.prototype);
    Reflect.deleteProperty(descriptors, 'constructor');
    Object.defineProperties(TransactionServiceBase.prototype, descriptors);
}
