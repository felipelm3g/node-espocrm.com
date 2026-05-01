import type { IExecuteFunctions, ILoadOptionsFunctions, INodeExecutionData, INodeType, INodeTypeDescription, INodePropertyOptions } from 'n8n-workflow';
export declare class EspoCrm implements INodeType {
    description: INodeTypeDescription;
    methods: {
        loadOptions: {
            getEntityOptions(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]>;
            getEntityFieldOptions(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]>;
            getEntityLinkFieldOptions(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]>;
            getEntityDocumentLinkOptions(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]>;
            getEntityFieldValueOptions(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]>;
            getEntityPrimaryFilterOptions(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]>;
            getEntityBoolFilterOptions(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]>;
        };
    };
    execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]>;
}
