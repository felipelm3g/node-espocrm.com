"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.EspoCrm = void 0;
const n8n_workflow_1 = require("n8n-workflow");
function normalizeBaseUrl(input) {
    const trimmed = input.trim();
    const withoutTrailingSlashes = trimmed.replace(/\/+$/, '');
    return withoutTrailingSlashes.replace(/\/api\/v1$/, '');
}
function buildApiUrl(baseUrl, endpoint) {
    const normalizedBaseUrl = normalizeBaseUrl(baseUrl);
    const normalizedEndpoint = endpoint.replace(/^\/+/, '');
    return `${normalizedBaseUrl}/api/v1/${normalizedEndpoint}`;
}
function isRecord(value) {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function parseJsonInput(value, fallback) {
    if (value === undefined || value === null || value === '')
        return fallback;
    if (typeof value === 'string') {
        try {
            return JSON.parse(value);
        }
        catch {
            return fallback;
        }
    }
    return value;
}
function buildBracketQueryString(value, prefix) {
    const pairs = [];
    const addPair = (key, val) => {
        if (val === undefined)
            return;
        if (val === null) {
            pairs.push(`${encodeURIComponent(key)}=`);
            return;
        }
        pairs.push(`${encodeURIComponent(key)}=${encodeURIComponent(String(val))}`);
    };
    const walk = (val, key) => {
        if (!key)
            return;
        if (Array.isArray(val)) {
            for (let i = 0; i < val.length; i++) {
                walk(val[i], `${key}[${i}]`);
            }
            return;
        }
        if (isRecord(val)) {
            for (const [k, v] of Object.entries(val)) {
                walk(v, `${key}[${k}]`);
            }
            return;
        }
        addPair(key, val);
    };
    if (prefix) {
        walk(value, prefix);
        return pairs.join('&');
    }
    if (isRecord(value)) {
        for (const [k, v] of Object.entries(value)) {
            walk(v, k);
        }
    }
    return pairs.join('&');
}
async function espoRequest(method, endpoint, options = {}) {
    const credentials = (await this.getCredentials('espoCrmApi'));
    if (!credentials?.baseUrl) {
        throw new n8n_workflow_1.NodeOperationError(this.getNode(), 'Base URL não configurada nas credenciais.');
    }
    if (!credentials?.apiKey) {
        throw new n8n_workflow_1.NodeOperationError(this.getNode(), 'API Key não configurada nas credenciais.');
    }
    const requestOptions = {
        method,
        url: buildApiUrl(credentials.baseUrl, endpoint),
        json: true,
        headers: {
            Accept: 'application/json',
            'X-Api-Key': credentials.apiKey,
        },
    };
    if (options.qs)
        requestOptions.qs = options.qs;
    if (options.body) {
        requestOptions.body = options.body;
        requestOptions.headers = {
            ...requestOptions.headers,
            'Content-Type': 'application/json',
        };
    }
    try {
        return await this.helpers.request(requestOptions);
    }
    catch (error) {
        const errorResponse = (isRecord(error) ? error : {});
        throw new n8n_workflow_1.NodeApiError(this.getNode(), errorResponse, {
            message: 'Falha ao chamar a API do EspoCRM.',
        });
    }
}
function getFieldAssignments(node, itemIndex, parameterName) {
    const fixed = node.getNodeParameter(parameterName, itemIndex, {});
    const entries = (fixed?.field ?? []);
    const payload = {};
    for (const entry of entries) {
        if (!entry?.name)
            continue;
        payload[entry.name] = entry.value;
    }
    return payload;
}
class EspoCrm {
    description = {
        displayName: 'EspoCRM',
        name: 'espoCrm',
        icon: 'file:../../logo.png',
        group: ['transform'],
        version: 1,
        subtitle: '={{$parameter["operationGroup"] + ": " + $parameter["entity"]}}',
        description: 'CRUD no EspoCRM (entidades dinâmicas por instância)',
        defaults: {
            name: 'EspoCRM',
        },
        inputs: ['main'],
        outputs: ['main'],
        credentials: [
            {
                name: 'espoCrmApi',
                required: true,
            },
        ],
        properties: [
            {
                displayName: 'Operação',
                name: 'operationGroup',
                type: 'options',
                noDataExpression: true,
                options: [
                    { name: 'Ler', value: 'read', action: 'Ler registros' },
                    { name: 'Criar', value: 'create', action: 'Criar um registro' },
                    { name: 'Editar', value: 'update', action: 'Editar um registro' },
                    { name: 'Deletar', value: 'delete', action: 'Deletar um registro' },
                ],
                default: 'read',
            },
            {
                displayName: 'Entidade',
                name: 'entity',
                type: 'options',
                typeOptions: {
                    loadOptionsMethod: 'getEntityOptions',
                },
                noDataExpression: true,
                default: '',
                required: true,
            },
            {
                displayName: 'Ação de Leitura',
                name: 'readOperation',
                type: 'options',
                noDataExpression: true,
                displayOptions: {
                    show: {
                        operationGroup: ['read'],
                    },
                },
                options: [
                    { name: 'Ler Tudo', value: 'getAll', action: 'Ler todos os registros' },
                    { name: 'Ler por ID', value: 'getById', action: 'Ler um registro por ID' },
                    { name: 'Ler por Campo(s)', value: 'getByFields', action: 'Ler registros filtrando por campo(s)' },
                ],
                default: 'getAll',
            },
            {
                displayName: 'ID do Registro',
                name: 'recordId',
                type: 'string',
                displayOptions: {
                    show: {
                        operationGroup: ['read'],
                        readOperation: ['getById'],
                    },
                },
                default: '',
                required: true,
            },
            {
                displayName: 'ID do Registro',
                name: 'recordIdUpdate',
                type: 'string',
                displayOptions: {
                    show: {
                        operationGroup: ['update'],
                    },
                },
                default: '',
                required: true,
            },
            {
                displayName: 'ID do Registro',
                name: 'recordIdDelete',
                type: 'string',
                displayOptions: {
                    show: {
                        operationGroup: ['delete'],
                    },
                },
                default: '',
                required: true,
            },
            {
                displayName: 'Máximo por Página',
                name: 'maxSize',
                type: 'number',
                typeOptions: {
                    minValue: 1,
                    maxValue: 200,
                },
                displayOptions: {
                    show: {
                        operationGroup: ['read'],
                        readOperation: ['getAll', 'getByFields'],
                    },
                },
                default: 200,
            },
            {
                displayName: 'Where (JSON)',
                name: 'whereJson',
                type: 'json',
                displayOptions: {
                    show: {
                        operationGroup: ['read'],
                        readOperation: ['getByFields'],
                    },
                },
                default: '[]',
            },
            {
                displayName: 'Campos',
                name: 'createFields',
                type: 'fixedCollection',
                typeOptions: {
                    multipleValues: true,
                },
                displayOptions: {
                    show: {
                        operationGroup: ['create'],
                    },
                },
                default: {},
                options: [
                    {
                        name: 'field',
                        displayName: 'Campo',
                        values: [
                            {
                                displayName: 'Nome',
                                name: 'name',
                                type: 'options',
                                typeOptions: {
                                    loadOptionsMethod: 'getEntityFieldOptions',
                                },
                                default: '',
                                required: true,
                            },
                            {
                                displayName: 'Valor',
                                name: 'value',
                                type: 'string',
                                default: '',
                            },
                        ],
                    },
                ],
            },
            {
                displayName: 'Campos',
                name: 'updateFields',
                type: 'fixedCollection',
                typeOptions: {
                    multipleValues: true,
                },
                displayOptions: {
                    show: {
                        operationGroup: ['update'],
                    },
                },
                default: {},
                options: [
                    {
                        name: 'field',
                        displayName: 'Campo',
                        values: [
                            {
                                displayName: 'Nome',
                                name: 'name',
                                type: 'options',
                                typeOptions: {
                                    loadOptionsMethod: 'getEntityFieldOptions',
                                },
                                default: '',
                                required: true,
                            },
                            {
                                displayName: 'Valor',
                                name: 'value',
                                type: 'string',
                                default: '',
                            },
                        ],
                    },
                ],
            },
        ],
    };
    methods = {
        loadOptions: {
            async getEntityOptions() {
                const metadata = await espoRequest.call(this, 'GET', 'Metadata/scopes');
                const i18n = await espoRequest.call(this, 'GET', 'I18n');
                const scopesContainer = isRecord(metadata) ? metadata.scopes : undefined;
                const scopes = isRecord(scopesContainer) ? scopesContainer : {};
                const globalContainer = isRecord(i18n) ? i18n.Global : undefined;
                const scopeNamesContainer = isRecord(globalContainer) && isRecord(globalContainer.scopeNames)
                    ? globalContainer.scopeNames
                    : {};
                const scopeNames = {};
                for (const [key, value] of Object.entries(scopeNamesContainer)) {
                    if (typeof value === 'string')
                        scopeNames[key] = value;
                }
                const options = [];
                for (const [scopeName, scopeDef] of Object.entries(scopes)) {
                    if (!isRecord(scopeDef))
                        continue;
                    if (scopeDef.entity !== true)
                        continue;
                    if (scopeDef.object !== true)
                        continue;
                    if (scopeDef.disabled === true)
                        continue;
                    const label = scopeNames?.[scopeName] ?? scopeName;
                    options.push({
                        name: label,
                        value: scopeName,
                    });
                }
                options.sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
                return options;
            },
            async getEntityFieldOptions() {
                const entity = this.getCurrentNodeParameter('entity');
                if (!entity)
                    return [];
                const key = encodeURIComponent(`entityDefs.${entity}.fields`);
                const [fieldsDefs, i18n] = await Promise.all([
                    espoRequest.call(this, 'GET', `Metadata?key=${key}`),
                    espoRequest.call(this, 'GET', 'I18n'),
                ]);
                const entityI18nContainer = isRecord(i18n) ? i18n[entity] : undefined;
                const fieldsLabelsContainer = isRecord(entityI18nContainer) && isRecord(entityI18nContainer.fields)
                    ? entityI18nContainer.fields
                    : {};
                const fieldLabels = {};
                for (const [key, value] of Object.entries(fieldsLabelsContainer)) {
                    if (typeof value === 'string')
                        fieldLabels[key] = value;
                }
                const options = [];
                if (isRecord(fieldsDefs)) {
                    for (const fieldName of Object.keys(fieldsDefs)) {
                        if (fieldName === 'id')
                            continue;
                        const label = fieldLabels?.[fieldName] ?? fieldName;
                        options.push({ name: label, value: fieldName });
                    }
                }
                options.sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
                return options;
            },
        },
    };
    async execute() {
        const items = this.getInputData();
        const returnData = [];
        for (let i = 0; i < items.length; i++) {
            const operationGroup = this.getNodeParameter('operationGroup', i);
            const entity = this.getNodeParameter('entity', i);
            if (!entity) {
                throw new n8n_workflow_1.NodeOperationError(this.getNode(), 'Entidade é obrigatória.', { itemIndex: i });
            }
            if (operationGroup === 'read') {
                const readOperation = this.getNodeParameter('readOperation', i);
                if (readOperation === 'getAll') {
                    const maxSize = this.getNodeParameter('maxSize', i);
                    let offset = 0;
                    while (true) {
                        const response = await espoRequest.call(this, 'GET', entity, {
                            qs: { maxSize, offset },
                        });
                        if (!isRecord(response) || !Array.isArray(response.list)) {
                            throw new n8n_workflow_1.NodeOperationError(this.getNode(), 'Resposta inesperada ao ler tudo.', {
                                itemIndex: i,
                            });
                        }
                        for (const record of response.list) {
                            if (isRecord(record)) {
                                returnData.push({ json: record });
                                continue;
                            }
                            throw new n8n_workflow_1.NodeOperationError(this.getNode(), 'Resposta inesperada na lista de registros.', {
                                itemIndex: i,
                            });
                        }
                        const total = typeof response.total === 'number' ? response.total : undefined;
                        offset += response.list.length;
                        if (response.list.length === 0)
                            break;
                        if (total !== undefined && offset >= total)
                            break;
                        if (response.list.length < maxSize)
                            break;
                    }
                    continue;
                }
                if (readOperation === 'getById') {
                    const recordId = this.getNodeParameter('recordId', i);
                    const response = await espoRequest.call(this, 'GET', `${entity}/${recordId}`);
                    if (!isRecord(response)) {
                        throw new n8n_workflow_1.NodeOperationError(this.getNode(), 'Resposta inesperada ao obter registro por ID.', {
                            itemIndex: i,
                        });
                    }
                    returnData.push({ json: response });
                    continue;
                }
                if (readOperation === 'getByFields') {
                    const maxSize = this.getNodeParameter('maxSize', i);
                    const whereJson = this.getNodeParameter('whereJson', i);
                    const where = parseJsonInput(whereJson, []);
                    if (!Array.isArray(where)) {
                        throw new n8n_workflow_1.NodeOperationError(this.getNode(), 'O campo Where (JSON) precisa ser um array (ex.: []).', { itemIndex: i });
                    }
                    let offset = 0;
                    while (true) {
                        const qs = buildBracketQueryString({ maxSize, offset, where });
                        const response = await espoRequest.call(this, 'GET', `${entity}?${qs}`);
                        if (!isRecord(response) || !Array.isArray(response.list)) {
                            throw new n8n_workflow_1.NodeOperationError(this.getNode(), 'Resposta inesperada ao ler por campo(s).', { itemIndex: i });
                        }
                        for (const record of response.list) {
                            if (!isRecord(record)) {
                                throw new n8n_workflow_1.NodeOperationError(this.getNode(), 'Resposta inesperada na lista de registros.', { itemIndex: i });
                            }
                            returnData.push({ json: record });
                        }
                        const total = typeof response.total === 'number' ? response.total : undefined;
                        offset += response.list.length;
                        if (response.list.length === 0)
                            break;
                        if (total !== undefined && offset >= total)
                            break;
                        if (response.list.length < maxSize)
                            break;
                    }
                    continue;
                }
                throw new n8n_workflow_1.NodeOperationError(this.getNode(), `Ação de leitura inválida: ${readOperation}`, {
                    itemIndex: i,
                });
            }
            if (operationGroup === 'create') {
                const payload = getFieldAssignments(this, i, 'createFields');
                const response = await espoRequest.call(this, 'POST', entity, { body: payload });
                if (!isRecord(response)) {
                    throw new n8n_workflow_1.NodeOperationError(this.getNode(), 'Resposta inesperada ao criar registro.', {
                        itemIndex: i,
                    });
                }
                returnData.push({ json: response });
                continue;
            }
            if (operationGroup === 'update') {
                const recordId = this.getNodeParameter('recordIdUpdate', i);
                const payload = getFieldAssignments(this, i, 'updateFields');
                const response = await espoRequest.call(this, 'PUT', `${entity}/${recordId}`, { body: payload });
                if (!isRecord(response)) {
                    throw new n8n_workflow_1.NodeOperationError(this.getNode(), 'Resposta inesperada ao editar registro.', {
                        itemIndex: i,
                    });
                }
                returnData.push({ json: response });
                continue;
            }
            if (operationGroup === 'delete') {
                const recordId = this.getNodeParameter('recordIdDelete', i);
                const response = await espoRequest.call(this, 'DELETE', `${entity}/${recordId}`);
                returnData.push({ json: { success: response === true } });
                continue;
            }
            throw new n8n_workflow_1.NodeOperationError(this.getNode(), `Operação inválida: ${operationGroup}`, {
                itemIndex: i,
            });
        }
        return [returnData];
    }
}
exports.EspoCrm = EspoCrm;
//# sourceMappingURL=EspoCrm.node.js.map