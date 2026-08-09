import type { ServiceDependencies } from '../domain-types.js';
import { MasterAccountMethods } from './master/account-methods.js';
import { MasterTaxonomyMethods } from './master/taxonomy-methods.js';
import { MasterTemplateMethods } from './master/template-methods.js';
class MasterServiceBase {
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
export type MasterService = MasterServiceBase & MasterAccountMethods & MasterTaxonomyMethods & MasterTemplateMethods;
export const MasterService = MasterServiceBase as unknown as {
    new(...args: ConstructorParameters<typeof MasterServiceBase>): MasterService;
};
for (const Source of [MasterAccountMethods, MasterTaxonomyMethods, MasterTemplateMethods]) {
    const descriptors = Object.getOwnPropertyDescriptors(Source.prototype);
    Reflect.deleteProperty(descriptors, 'constructor');
    Object.defineProperties(MasterServiceBase.prototype, descriptors);
}
