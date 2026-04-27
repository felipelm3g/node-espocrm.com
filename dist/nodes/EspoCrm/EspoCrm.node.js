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
function buildBracketQueryStringReadable(value) {
    const pairs = [];
    const addPair = (key, val) => {
        if (val === undefined)
            return;
        if (val === null) {
            pairs.push(`${key}=`);
            return;
        }
        pairs.push(`${key}=${encodeURIComponent(String(val))}`);
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
    if (isRecord(value)) {
        for (const [k, v] of Object.entries(value)) {
            walk(v, k);
        }
    }
    return pairs.join('&');
}
function decodeBracketEncoding(input) {
    return input.replace(/%5B/gi, '[').replace(/%5D/gi, ']');
}
function tryParseJsonString(value) {
    if (typeof value !== 'string')
        return value;
    try {
        return JSON.parse(value);
    }
    catch {
        return value;
    }
}
function extractEspoErrorMessage(error) {
    if (!isRecord(error))
        return undefined;
    const rawBody = (isRecord(error.response) ? error.response.body : undefined) ??
        error.error;
    const body = tryParseJsonString(rawBody);
    if (isRecord(body)) {
        const message = body.message;
        if (typeof message === 'string' && message.trim())
            return message.trim();
        const errorValue = body.error;
        if (typeof errorValue === 'string' && errorValue.trim())
            return errorValue.trim();
        const reason = body.reason;
        if (typeof reason === 'string' && reason.trim())
            return reason.trim();
    }
    const message = error.message;
    if (typeof message === 'string' && message.trim())
        return message.trim();
    return undefined;
}
function extractHttpStatusCode(error) {
    if (!isRecord(error))
        return undefined;
    const value = (error.statusCode ?? error.httpCode);
    return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}
async function espoRequest(method, endpoint, options = {}) {
    const credentials = (await this.getCredentials('espoCrmApi'));
    if (!credentials?.baseUrl) {
        throw new n8n_workflow_1.NodeOperationError(this.getNode(), 'Base URL não configurada nas credenciais.');
    }
    if (!credentials?.apiKey) {
        throw new n8n_workflow_1.NodeOperationError(this.getNode(), 'API Key não configurada nas credenciais.');
    }
    const baseRequestUrl = buildApiUrl(credentials.baseUrl, endpoint);
    const requestOptions = {
        method,
        url: baseRequestUrl,
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
        let debugUrl = baseRequestUrl;
        let debugUrlReadable = baseRequestUrl;
        if (requestOptions.qs && isRecord(requestOptions.qs)) {
            const qsString = buildBracketQueryString(requestOptions.qs);
            const qsReadable = buildBracketQueryStringReadable(requestOptions.qs);
            if (qsString)
                debugUrl = `${baseRequestUrl}${baseRequestUrl.includes('?') ? '&' : '?'}${qsString}`;
            if (qsReadable)
                debugUrlReadable = `${baseRequestUrl}${baseRequestUrl.includes('?') ? '&' : '?'}${qsReadable}`;
        }
        else {
            debugUrlReadable = decodeBracketEncoding(baseRequestUrl);
        }
        const debugUrlDisplay = decodeBracketEncoding(debugUrl);
        const debugUrlReadableDisplay = decodeBracketEncoding(debugUrlReadable);
        const description = debugUrlReadableDisplay === debugUrlDisplay
            ? `Request: ${method} ${debugUrlDisplay}`
            : `Request: ${method} ${debugUrlDisplay}\nReadable: ${method} ${debugUrlReadableDisplay}`;
        const errorResponse = (isRecord(error) ? error : {});
        const statusCode = extractHttpStatusCode(error);
        if (statusCode !== undefined && errorResponse.statusCode === undefined) {
            errorResponse.statusCode = statusCode;
        }
        const apiMessage = extractEspoErrorMessage(error);
        throw new n8n_workflow_1.NodeApiError(this.getNode(), errorResponse, {
            message: apiMessage ?? 'Falha ao chamar a API do EspoCRM.',
            description,
            httpCode: statusCode === undefined ? undefined : String(statusCode),
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
function buildWhereFromBuilder(node, itemIndex) {
    const fixed = node.getNodeParameter('filters', itemIndex, {});
    const conditions = (fixed?.condition ?? []);
    const linkOnlyTypes = new Set(['linkedWith', 'notLinkedWith', 'isLinked', 'isNotLinked']);
    const noValueTypes = new Set([
        'isNull',
        'isNotNull',
        'isTrue',
        'isFalse',
        'today',
        'past',
        'future',
        'lastSevenDays',
        'currentMonth',
        'nextMonth',
        'lastMonth',
        'currentQuarter',
        'lastQuarter',
        'currentYear',
        'lastYear',
        'currentFiscalYear',
        'lastFiscalYear',
        'currentFiscalQuarter',
        'lastFiscalQuarter',
        'arrayIsEmpty',
        'arrayIsNotEmpty',
        'isLinked',
        'isNotLinked',
    ]);
    const multiValueTypes = new Set(['in', 'notIn', 'arrayAnyOf', 'arrayNoneOf', 'arrayAllOf']);
    const rangeTypes = new Set(['between']);
    const needsAttribute = (type) => type !== 'expression';
    const toStringValue = (value) => (value === undefined || value === null ? '' : String(value));
    const buildSimple = (data) => {
        const type = toStringValue(data.type).trim();
        if (!type)
            throw new n8n_workflow_1.NodeOperationError(node.getNode(), 'Tipo da condição é obrigatório.', { itemIndex });
        if (type === 'expression') {
            const expression = toStringValue(data.expression).trim();
            if (!expression) {
                throw new n8n_workflow_1.NodeOperationError(node.getNode(), 'Expression é obrigatório quando o tipo é expression.', {
                    itemIndex,
                });
            }
            return { type, value: expression };
        }
        if (needsAttribute(type)) {
            const attribute = linkOnlyTypes.has(type)
                ? toStringValue(data.linkAttribute).trim()
                : toStringValue(data.attribute).trim();
            if (!attribute) {
                throw new n8n_workflow_1.NodeOperationError(node.getNode(), linkOnlyTypes.has(type) ? 'Relacionamento (attribute) é obrigatório.' : 'Campo (attribute) é obrigatório.', { itemIndex });
            }
            if (noValueTypes.has(type)) {
                return { type, attribute };
            }
            if (rangeTypes.has(type)) {
                const from = toStringValue(data.valueFrom).trim();
                const to = toStringValue(data.valueTo).trim();
                if (!from || !to) {
                    throw new n8n_workflow_1.NodeOperationError(node.getNode(), 'Between precisa de Valor (De) e Valor (Até).', {
                        itemIndex,
                    });
                }
                return { type, attribute, value: [from, to] };
            }
            if (multiValueTypes.has(type)) {
                const valuesFixed = (data.values ?? {});
                const valuesEntries = (valuesFixed?.value ?? []);
                const values = valuesEntries
                    .map((v) => toStringValue(v.value).trim())
                    .filter((v) => v.length > 0);
                if (values.length === 0) {
                    throw new n8n_workflow_1.NodeOperationError(node.getNode(), 'Lista de valores é obrigatória para este tipo.', {
                        itemIndex,
                    });
                }
                return { type, attribute, value: values };
            }
            const value = toStringValue(data.value).trim();
            if (!value) {
                throw new n8n_workflow_1.NodeOperationError(node.getNode(), 'Valor é obrigatório para este tipo.', { itemIndex });
            }
            return { type, attribute, value };
        }
        throw new n8n_workflow_1.NodeOperationError(node.getNode(), `Tipo de condição inválido: ${type}`, { itemIndex });
    };
    const result = [];
    for (const condition of conditions) {
        const mode = toStringValue(condition.mode).trim() || 'simple';
        if (mode === 'simple') {
            result.push(buildSimple(condition));
            continue;
        }
        if (mode === 'group') {
            const groupType = toStringValue(condition.groupType).trim();
            if (!groupType) {
                throw new n8n_workflow_1.NodeOperationError(node.getNode(), 'Tipo do grupo é obrigatório.', { itemIndex });
            }
            if (!['and', 'or', 'not'].includes(groupType)) {
                throw new n8n_workflow_1.NodeOperationError(node.getNode(), `Tipo do grupo inválido: ${groupType}`, { itemIndex });
            }
            const groupFixed = (condition.groupConditions ?? {});
            const groupConditions = (groupFixed?.condition ?? []);
            if (groupConditions.length === 0) {
                throw new n8n_workflow_1.NodeOperationError(node.getNode(), 'Grupo precisa ter pelo menos uma condição.', {
                    itemIndex,
                });
            }
            const value = groupConditions.map(buildSimple);
            result.push({ type: groupType, value });
            continue;
        }
        throw new n8n_workflow_1.NodeOperationError(node.getNode(), `Modo de condição inválido: ${mode}`, { itemIndex });
    }
    return result;
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
        documentationUrl: 'https://docs.espocrm.com/api/',
        defaults: {
            name: 'EspoCRM',
        },
        inputs: ['main'],
        outputs: ['main', 'main'],
        outputNames: ['Sucesso', 'Erro'],
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
                displayName: 'Formato de Saída',
                name: 'readOutputMode',
                type: 'options',
                noDataExpression: true,
                displayOptions: {
                    show: {
                        operationGroup: ['read'],
                        readOperation: ['getAll', 'getById', 'getByFields'],
                    },
                },
                options: [
                    { name: 'Resposta da API (1 item)', value: 'api' },
                    { name: 'Registros (1 item por registro)', value: 'records' },
                ],
                default: 'api',
            },
            {
                displayName: 'Options',
                name: 'options',
                type: 'collection',
                placeholder: 'Add option',
                displayOptions: {
                    show: {
                        operationGroup: ['read'],
                        readOperation: ['getAll', 'getByFields'],
                    },
                },
                default: {},
                options: [
                    {
                        displayName: 'Max Size',
                        name: 'maxSize',
                        type: 'number',
                        typeOptions: {
                            minValue: 0,
                            maxValue: 200,
                        },
                        default: 0,
                    },
                    {
                        displayName: 'Offset',
                        name: 'offset',
                        type: 'number',
                        typeOptions: {
                            minValue: 0,
                        },
                        default: 0,
                    },
                    {
                        displayName: 'Order By',
                        name: 'orderBy',
                        type: 'options',
                        typeOptions: {
                            loadOptionsMethod: 'getEntityFieldOptions',
                        },
                        noDataExpression: true,
                        default: '',
                    },
                    {
                        displayName: 'Order',
                        name: 'order',
                        type: 'options',
                        noDataExpression: true,
                        options: [
                            { name: 'Asc', value: 'asc' },
                            { name: 'Desc', value: 'desc' },
                        ],
                        default: 'asc',
                    },
                    {
                        displayName: 'Primary Filter',
                        name: 'primaryFilter',
                        type: 'options',
                        typeOptions: {
                            loadOptionsMethod: 'getEntityPrimaryFilterOptions',
                        },
                        noDataExpression: true,
                        default: '',
                    },
                    {
                        displayName: 'Bool Filters',
                        name: 'boolFilterList',
                        type: 'multiOptions',
                        typeOptions: {
                            loadOptionsMethod: 'getEntityBoolFilterOptions',
                        },
                        noDataExpression: true,
                        default: [],
                    },
                    {
                        displayName: 'Text Filter',
                        name: 'textFilter',
                        type: 'string',
                        default: '',
                    },
                    {
                        displayName: 'Buscar Todas as Páginas',
                        name: 'autoPaginate',
                        type: 'boolean',
                        default: true,
                    },
                ],
            },
            {
                displayName: 'Modo de Filtro',
                name: 'filterMode',
                type: 'options',
                noDataExpression: true,
                displayOptions: {
                    show: {
                        operationGroup: ['read'],
                        readOperation: ['getByFields'],
                    },
                },
                options: [
                    { name: 'Construtor', value: 'builder' },
                    { name: 'JSON (avançado)', value: 'json' },
                ],
                default: 'builder',
            },
            {
                displayName: 'Condições',
                name: 'filters',
                type: 'fixedCollection',
                typeOptions: {
                    multipleValues: true,
                },
                displayOptions: {
                    show: {
                        operationGroup: ['read'],
                        readOperation: ['getByFields'],
                        filterMode: ['builder'],
                    },
                },
                default: {},
                options: [
                    {
                        name: 'condition',
                        displayName: 'Condição',
                        values: [
                            {
                                displayName: 'Modo',
                                name: 'mode',
                                type: 'options',
                                noDataExpression: true,
                                options: [
                                    { name: 'Simples', value: 'simple' },
                                    { name: 'Grupo (AND/OR/NOT)', value: 'group' },
                                ],
                                default: 'simple',
                            },
                            {
                                displayName: 'Tipo',
                                name: 'type',
                                type: 'options',
                                noDataExpression: true,
                                displayOptions: {
                                    show: {
                                        mode: ['simple'],
                                    },
                                },
                                options: [
                                    { name: 'equals', value: 'equals' },
                                    { name: 'notEquals', value: 'notEquals' },
                                    { name: 'greaterThan', value: 'greaterThan' },
                                    { name: 'lessThan', value: 'lessThan' },
                                    { name: 'greaterThanOrEquals', value: 'greaterThanOrEquals' },
                                    { name: 'lessThanOrEquals', value: 'lessThanOrEquals' },
                                    { name: 'between', value: 'between' },
                                    { name: 'in', value: 'in' },
                                    { name: 'notIn', value: 'notIn' },
                                    { name: 'like', value: 'like' },
                                    { name: 'notLike', value: 'notLike' },
                                    { name: 'startsWith', value: 'startsWith' },
                                    { name: 'endsWith', value: 'endsWith' },
                                    { name: 'contains', value: 'contains' },
                                    { name: 'notContains', value: 'notContains' },
                                    { name: 'after', value: 'after' },
                                    { name: 'before', value: 'before' },
                                    { name: 'today', value: 'today' },
                                    { name: 'past', value: 'past' },
                                    { name: 'future', value: 'future' },
                                    { name: 'lastSevenDays', value: 'lastSevenDays' },
                                    { name: 'lastXDays', value: 'lastXDays' },
                                    { name: 'nextXDays', value: 'nextXDays' },
                                    { name: 'olderThanXDays', value: 'olderThanXDays' },
                                    { name: 'afterXDays', value: 'afterXDays' },
                                    { name: 'isNull', value: 'isNull' },
                                    { name: 'isNotNull', value: 'isNotNull' },
                                    { name: 'isTrue', value: 'isTrue' },
                                    { name: 'isFalse', value: 'isFalse' },
                                    { name: 'linkedWith', value: 'linkedWith' },
                                    { name: 'notLinkedWith', value: 'notLinkedWith' },
                                    { name: 'isLinked', value: 'isLinked' },
                                    { name: 'isNotLinked', value: 'isNotLinked' },
                                    { name: 'expression', value: 'expression' },
                                ],
                                default: 'equals',
                            },
                            {
                                displayName: 'Relacionamento (attribute)',
                                name: 'linkAttribute',
                                type: 'options',
                                typeOptions: {
                                    loadOptionsMethod: 'getEntityLinkFieldOptions',
                                },
                                displayOptions: {
                                    show: {
                                        mode: ['simple'],
                                        type: ['linkedWith', 'notLinkedWith', 'isLinked', 'isNotLinked'],
                                    },
                                },
                                default: '',
                                required: true,
                            },
                            {
                                displayName: 'Campo (attribute)',
                                name: 'attribute',
                                type: 'options',
                                typeOptions: {
                                    loadOptionsMethod: 'getEntityFieldOptions',
                                },
                                displayOptions: {
                                    show: {
                                        mode: ['simple'],
                                        type: [
                                            'equals',
                                            'notEquals',
                                            'greaterThan',
                                            'lessThan',
                                            'greaterThanOrEquals',
                                            'lessThanOrEquals',
                                            'between',
                                            'in',
                                            'notIn',
                                            'like',
                                            'notLike',
                                            'startsWith',
                                            'endsWith',
                                            'contains',
                                            'notContains',
                                            'after',
                                            'before',
                                            'today',
                                            'past',
                                            'future',
                                            'lastSevenDays',
                                            'lastXDays',
                                            'nextXDays',
                                            'olderThanXDays',
                                            'afterXDays',
                                            'isNull',
                                            'isNotNull',
                                            'isTrue',
                                            'isFalse',
                                        ],
                                    },
                                },
                                default: '',
                                required: true,
                            },
                            {
                                displayName: 'Valor',
                                name: 'value',
                                type: 'string',
                                displayOptions: {
                                    show: {
                                        mode: ['simple'],
                                        type: [
                                            'equals',
                                            'notEquals',
                                            'greaterThan',
                                            'lessThan',
                                            'greaterThanOrEquals',
                                            'lessThanOrEquals',
                                            'like',
                                            'notLike',
                                            'startsWith',
                                            'endsWith',
                                            'contains',
                                            'notContains',
                                            'after',
                                            'before',
                                            'lastXDays',
                                            'nextXDays',
                                            'olderThanXDays',
                                            'afterXDays',
                                            'linkedWith',
                                            'notLinkedWith',
                                        ],
                                    },
                                },
                                default: '',
                            },
                            {
                                displayName: 'Valor (De)',
                                name: 'valueFrom',
                                type: 'string',
                                displayOptions: {
                                    show: {
                                        mode: ['simple'],
                                        type: ['between'],
                                    },
                                },
                                default: '',
                            },
                            {
                                displayName: 'Valor (Até)',
                                name: 'valueTo',
                                type: 'string',
                                displayOptions: {
                                    show: {
                                        mode: ['simple'],
                                        type: ['between'],
                                    },
                                },
                                default: '',
                            },
                            {
                                displayName: 'Valores',
                                name: 'values',
                                type: 'fixedCollection',
                                typeOptions: {
                                    multipleValues: true,
                                },
                                displayOptions: {
                                    show: {
                                        mode: ['simple'],
                                        type: ['in', 'notIn', 'arrayAnyOf', 'arrayNoneOf', 'arrayAllOf'],
                                    },
                                },
                                default: {},
                                options: [
                                    {
                                        name: 'value',
                                        displayName: 'Valor',
                                        values: [
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
                                displayName: 'Expression',
                                name: 'expression',
                                type: 'string',
                                displayOptions: {
                                    show: {
                                        mode: ['simple'],
                                        type: ['expression'],
                                    },
                                },
                                default: '',
                            },
                            {
                                displayName: 'Tipo do Grupo',
                                name: 'groupType',
                                type: 'options',
                                noDataExpression: true,
                                displayOptions: {
                                    show: {
                                        mode: ['group'],
                                    },
                                },
                                options: [
                                    { name: 'AND', value: 'and' },
                                    { name: 'OR', value: 'or' },
                                    { name: 'NOT', value: 'not' },
                                ],
                                default: 'and',
                            },
                            {
                                displayName: 'Condições do Grupo',
                                name: 'groupConditions',
                                type: 'fixedCollection',
                                typeOptions: {
                                    multipleValues: true,
                                },
                                displayOptions: {
                                    show: {
                                        mode: ['group'],
                                    },
                                },
                                default: {},
                                options: [
                                    {
                                        name: 'condition',
                                        displayName: 'Condição',
                                        values: [
                                            {
                                                displayName: 'Tipo',
                                                name: 'type',
                                                type: 'options',
                                                noDataExpression: true,
                                                options: [
                                                    { name: 'equals', value: 'equals' },
                                                    { name: 'notEquals', value: 'notEquals' },
                                                    { name: 'greaterThan', value: 'greaterThan' },
                                                    { name: 'lessThan', value: 'lessThan' },
                                                    { name: 'greaterThanOrEquals', value: 'greaterThanOrEquals' },
                                                    { name: 'lessThanOrEquals', value: 'lessThanOrEquals' },
                                                    { name: 'between', value: 'between' },
                                                    { name: 'in', value: 'in' },
                                                    { name: 'notIn', value: 'notIn' },
                                                    { name: 'like', value: 'like' },
                                                    { name: 'notLike', value: 'notLike' },
                                                    { name: 'startsWith', value: 'startsWith' },
                                                    { name: 'endsWith', value: 'endsWith' },
                                                    { name: 'contains', value: 'contains' },
                                                    { name: 'notContains', value: 'notContains' },
                                                    { name: 'after', value: 'after' },
                                                    { name: 'before', value: 'before' },
                                                    { name: 'today', value: 'today' },
                                                    { name: 'past', value: 'past' },
                                                    { name: 'future', value: 'future' },
                                                    { name: 'lastSevenDays', value: 'lastSevenDays' },
                                                    { name: 'lastXDays', value: 'lastXDays' },
                                                    { name: 'nextXDays', value: 'nextXDays' },
                                                    { name: 'olderThanXDays', value: 'olderThanXDays' },
                                                    { name: 'afterXDays', value: 'afterXDays' },
                                                    { name: 'isNull', value: 'isNull' },
                                                    { name: 'isNotNull', value: 'isNotNull' },
                                                    { name: 'isTrue', value: 'isTrue' },
                                                    { name: 'isFalse', value: 'isFalse' },
                                                    { name: 'linkedWith', value: 'linkedWith' },
                                                    { name: 'notLinkedWith', value: 'notLinkedWith' },
                                                    { name: 'isLinked', value: 'isLinked' },
                                                    { name: 'isNotLinked', value: 'isNotLinked' },
                                                    { name: 'expression', value: 'expression' },
                                                ],
                                                default: 'equals',
                                            },
                                            {
                                                displayName: 'Relacionamento (attribute)',
                                                name: 'linkAttribute',
                                                type: 'options',
                                                typeOptions: {
                                                    loadOptionsMethod: 'getEntityLinkFieldOptions',
                                                },
                                                displayOptions: {
                                                    show: {
                                                        type: ['linkedWith', 'notLinkedWith', 'isLinked', 'isNotLinked'],
                                                    },
                                                },
                                                default: '',
                                                required: true,
                                            },
                                            {
                                                displayName: 'Campo (attribute)',
                                                name: 'attribute',
                                                type: 'options',
                                                typeOptions: {
                                                    loadOptionsMethod: 'getEntityFieldOptions',
                                                },
                                                displayOptions: {
                                                    show: {
                                                        type: [
                                                            'equals',
                                                            'notEquals',
                                                            'greaterThan',
                                                            'lessThan',
                                                            'greaterThanOrEquals',
                                                            'lessThanOrEquals',
                                                            'between',
                                                            'in',
                                                            'notIn',
                                                            'like',
                                                            'notLike',
                                                            'startsWith',
                                                            'endsWith',
                                                            'contains',
                                                            'notContains',
                                                            'after',
                                                            'before',
                                                            'today',
                                                            'past',
                                                            'future',
                                                            'lastSevenDays',
                                                            'lastXDays',
                                                            'nextXDays',
                                                            'olderThanXDays',
                                                            'afterXDays',
                                                            'isNull',
                                                            'isNotNull',
                                                            'isTrue',
                                                            'isFalse',
                                                        ],
                                                    },
                                                },
                                                default: '',
                                                required: true,
                                            },
                                            {
                                                displayName: 'Valor',
                                                name: 'value',
                                                type: 'string',
                                                displayOptions: {
                                                    show: {
                                                        type: [
                                                            'equals',
                                                            'notEquals',
                                                            'greaterThan',
                                                            'lessThan',
                                                            'greaterThanOrEquals',
                                                            'lessThanOrEquals',
                                                            'like',
                                                            'notLike',
                                                            'startsWith',
                                                            'endsWith',
                                                            'contains',
                                                            'notContains',
                                                            'after',
                                                            'before',
                                                            'lastXDays',
                                                            'nextXDays',
                                                            'olderThanXDays',
                                                            'afterXDays',
                                                            'linkedWith',
                                                            'notLinkedWith',
                                                        ],
                                                    },
                                                },
                                                default: '',
                                            },
                                            {
                                                displayName: 'Valor (De)',
                                                name: 'valueFrom',
                                                type: 'string',
                                                displayOptions: {
                                                    show: {
                                                        type: ['between'],
                                                    },
                                                },
                                                default: '',
                                            },
                                            {
                                                displayName: 'Valor (Até)',
                                                name: 'valueTo',
                                                type: 'string',
                                                displayOptions: {
                                                    show: {
                                                        type: ['between'],
                                                    },
                                                },
                                                default: '',
                                            },
                                            {
                                                displayName: 'Valores',
                                                name: 'values',
                                                type: 'fixedCollection',
                                                typeOptions: {
                                                    multipleValues: true,
                                                },
                                                displayOptions: {
                                                    show: {
                                                        type: ['in', 'notIn', 'arrayAnyOf', 'arrayNoneOf', 'arrayAllOf'],
                                                    },
                                                },
                                                default: {},
                                                options: [
                                                    {
                                                        name: 'value',
                                                        displayName: 'Valor',
                                                        values: [
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
                                                displayName: 'Expression',
                                                name: 'expression',
                                                type: 'string',
                                                displayOptions: {
                                                    show: {
                                                        type: ['expression'],
                                                    },
                                                },
                                                default: '',
                                            },
                                        ],
                                    },
                                ],
                            },
                        ],
                    },
                ],
            },
            {
                displayName: 'Where (JSON)',
                name: 'whereJson',
                type: 'json',
                displayOptions: {
                    show: {
                        operationGroup: ['read'],
                        readOperation: ['getByFields'],
                        filterMode: ['json'],
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
                const values = new Set();
                if (isRecord(fieldsDefs)) {
                    for (const [fieldName, fieldDef] of Object.entries(fieldsDefs)) {
                        if (fieldName === 'id')
                            continue;
                        const labelRaw = fieldLabels?.[fieldName] ?? fieldName;
                        const fieldType = isRecord(fieldDef) ? fieldDef.type : undefined;
                        const isLinkField = fieldType === 'link' || fieldType === 'linkParent' || fieldType === 'linkMultiple';
                        if (!isLinkField) {
                            const label = labelRaw === fieldName ? fieldName : `${labelRaw} (${fieldName})`;
                            if (!values.has(fieldName)) {
                                options.push({ name: label, value: fieldName });
                                values.add(fieldName);
                            }
                        }
                        if (fieldType === 'link' || fieldType === 'linkParent') {
                            const idAttribute = `${fieldName}Id`;
                            if (!values.has(idAttribute)) {
                                const idLabel = labelRaw === fieldName ? `${idAttribute}` : `${labelRaw} (ID) (${idAttribute})`;
                                options.push({ name: idLabel, value: idAttribute });
                                values.add(idAttribute);
                            }
                        }
                        if (fieldType === 'link' || fieldType === 'linkParent') {
                            const nameAttribute = `${fieldName}Name`;
                            if (!values.has(nameAttribute)) {
                                const nameLabel = labelRaw === fieldName
                                    ? `${nameAttribute}`
                                    : `${labelRaw} (Nome) (${nameAttribute})`;
                                options.push({ name: nameLabel, value: nameAttribute });
                                values.add(nameAttribute);
                            }
                        }
                        if (fieldType === 'linkParent') {
                            const typeAttribute = `${fieldName}Type`;
                            if (!values.has(typeAttribute)) {
                                const typeLabel = labelRaw === fieldName
                                    ? `${typeAttribute}`
                                    : `${labelRaw} (Tipo) (${typeAttribute})`;
                                options.push({ name: typeLabel, value: typeAttribute });
                                values.add(typeAttribute);
                            }
                        }
                        if (fieldType === 'linkMultiple') {
                            const idsAttribute = `${fieldName}Ids`;
                            if (!values.has(idsAttribute)) {
                                const idsLabel = labelRaw === fieldName
                                    ? `${idsAttribute}`
                                    : `${labelRaw} (IDs) (${idsAttribute})`;
                                options.push({ name: idsLabel, value: idsAttribute });
                                values.add(idsAttribute);
                            }
                            const namesAttribute = `${fieldName}Names`;
                            if (!values.has(namesAttribute)) {
                                const namesLabel = labelRaw === fieldName
                                    ? `${namesAttribute}`
                                    : `${labelRaw} (Nomes) (${namesAttribute})`;
                                options.push({ name: namesLabel, value: namesAttribute });
                                values.add(namesAttribute);
                            }
                        }
                    }
                }
                options.sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
                return options;
            },
            async getEntityLinkFieldOptions() {
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
                for (const [k, v] of Object.entries(fieldsLabelsContainer)) {
                    if (typeof v === 'string')
                        fieldLabels[k] = v;
                }
                const options = [];
                const values = new Set();
                if (isRecord(fieldsDefs)) {
                    for (const [fieldName, fieldDef] of Object.entries(fieldsDefs)) {
                        if (fieldName === 'id')
                            continue;
                        const fieldType = isRecord(fieldDef) ? fieldDef.type : undefined;
                        if (fieldType !== 'link' && fieldType !== 'linkParent' && fieldType !== 'linkMultiple')
                            continue;
                        const labelRaw = fieldLabels?.[fieldName] ?? fieldName;
                        const label = labelRaw === fieldName ? fieldName : `${labelRaw} (${fieldName})`;
                        if (!values.has(fieldName)) {
                            options.push({ name: label, value: fieldName });
                            values.add(fieldName);
                        }
                    }
                }
                options.sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
                return options;
            },
            async getEntityPrimaryFilterOptions() {
                const entity = this.getCurrentNodeParameter('entity');
                if (!entity)
                    return [];
                const key = encodeURIComponent(`clientDefs.${entity}.filterList`);
                const filterList = await espoRequest.call(this, 'GET', `Metadata?key=${key}`);
                const options = [];
                if (Array.isArray(filterList)) {
                    for (const item of filterList) {
                        if (typeof item === 'string') {
                            options.push({ name: item, value: item });
                            continue;
                        }
                        if (isRecord(item) && typeof item.name === 'string') {
                            options.push({ name: item.name, value: item.name });
                        }
                    }
                }
                options.sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
                return options;
            },
            async getEntityBoolFilterOptions() {
                const entity = this.getCurrentNodeParameter('entity');
                if (!entity)
                    return [];
                const key = encodeURIComponent(`clientDefs.${entity}.boolFilterList`);
                const boolFilterList = await espoRequest.call(this, 'GET', `Metadata?key=${key}`);
                const values = new Set();
                const options = [];
                const add = (name) => {
                    if (!name || values.has(name))
                        return;
                    values.add(name);
                    options.push({ name, value: name });
                };
                if (Array.isArray(boolFilterList)) {
                    for (const item of boolFilterList) {
                        if (typeof item === 'string') {
                            add(item);
                            continue;
                        }
                        if (isRecord(item) && typeof item.name === 'string') {
                            add(item.name);
                        }
                    }
                }
                add('onlyMy');
                add('followed');
                options.sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
                return options;
            },
        },
    };
    async execute() {
        const items = this.getInputData();
        const returnData = [];
        const errorData = [];
        for (let i = 0; i < items.length; i++) {
            try {
                const operationGroup = this.getNodeParameter('operationGroup', i);
                const entity = this.getNodeParameter('entity', i);
                if (!entity) {
                    throw new n8n_workflow_1.NodeOperationError(this.getNode(), 'Entidade é obrigatória.', { itemIndex: i });
                }
                if (operationGroup === 'read') {
                    const readOperation = this.getNodeParameter('readOperation', i);
                    const readOutputMode = this.getNodeParameter('readOutputMode', i, 'api');
                    const options = this.getNodeParameter('options', i, {});
                    const toOptionalNumber = (value) => {
                        if (typeof value === 'number' && Number.isFinite(value))
                            return value;
                        if (typeof value === 'string') {
                            const trimmed = value.trim();
                            if (trimmed === '')
                                return undefined;
                            const num = Number(trimmed);
                            if (Number.isFinite(num))
                                return num;
                        }
                        return undefined;
                    };
                    const maxSizeRaw = toOptionalNumber(options.maxSize);
                    const startOffsetRaw = toOptionalNumber(options.offset);
                    const maxSize = maxSizeRaw === undefined ? 0 : Math.min(200, Math.max(0, Math.floor(maxSizeRaw)));
                    const startOffset = startOffsetRaw === undefined ? 0 : Math.max(0, Math.floor(startOffsetRaw));
                    const orderBy = typeof options.orderBy === 'string' ? options.orderBy : '';
                    const order = typeof options.order === 'string' ? options.order : 'asc';
                    const primaryFilter = typeof options.primaryFilter === 'string' ? options.primaryFilter : '';
                    const boolFilterList = Array.isArray(options.boolFilterList)
                        ? options.boolFilterList
                        : [];
                    const textFilter = typeof options.textFilter === 'string' ? options.textFilter : '';
                    const autoPaginate = typeof options.autoPaginate === 'boolean'
                        ? options.autoPaginate
                        : typeof options.autoPaginate === 'string'
                            ? options.autoPaginate.trim() !== 'false'
                            : readOperation === 'getAll';
                    if (readOperation === 'getAll') {
                        const allRecords = [];
                        let total;
                        let offset = startOffset;
                        if (!autoPaginate) {
                            const qsObject = {};
                            if (maxSize > 0)
                                qsObject.maxSize = maxSize;
                            if (offset > 0)
                                qsObject.offset = offset;
                            if (orderBy)
                                qsObject.orderBy = orderBy;
                            if (orderBy && order)
                                qsObject.order = order;
                            if (primaryFilter)
                                qsObject.primaryFilter = primaryFilter;
                            if (textFilter)
                                qsObject.textFilter = textFilter;
                            if (Array.isArray(boolFilterList) && boolFilterList.length > 0)
                                qsObject.boolFilterList = boolFilterList;
                            const qs = buildBracketQueryString(qsObject);
                            const response = await espoRequest.call(this, 'GET', qs ? `${entity}?${qs}` : entity);
                            if (!isRecord(response) || !Array.isArray(response.list)) {
                                throw new n8n_workflow_1.NodeOperationError(this.getNode(), 'Resposta inesperada ao ler tudo.', {
                                    itemIndex: i,
                                });
                            }
                            if (readOutputMode === 'api') {
                                returnData.push({ json: response, pairedItem: { item: i } });
                            }
                            else {
                                for (const record of response.list) {
                                    if (!isRecord(record)) {
                                        throw new n8n_workflow_1.NodeOperationError(this.getNode(), 'Resposta inesperada na lista de registros.', {
                                            itemIndex: i,
                                        });
                                    }
                                    returnData.push({ json: record, pairedItem: { item: i } });
                                }
                            }
                            continue;
                        }
                        while (true) {
                            const qsObject = {};
                            if (maxSize > 0)
                                qsObject.maxSize = maxSize;
                            if (offset > 0)
                                qsObject.offset = offset;
                            if (orderBy)
                                qsObject.orderBy = orderBy;
                            if (orderBy && order)
                                qsObject.order = order;
                            if (primaryFilter)
                                qsObject.primaryFilter = primaryFilter;
                            if (textFilter)
                                qsObject.textFilter = textFilter;
                            if (Array.isArray(boolFilterList) && boolFilterList.length > 0)
                                qsObject.boolFilterList = boolFilterList;
                            const qs = buildBracketQueryString(qsObject);
                            const response = await espoRequest.call(this, 'GET', qs ? `${entity}?${qs}` : entity);
                            if (!isRecord(response) || !Array.isArray(response.list)) {
                                throw new n8n_workflow_1.NodeOperationError(this.getNode(), 'Resposta inesperada ao ler tudo.', {
                                    itemIndex: i,
                                });
                            }
                            if (total === undefined && typeof response.total === 'number')
                                total = response.total;
                            for (const record of response.list) {
                                if (!isRecord(record)) {
                                    throw new n8n_workflow_1.NodeOperationError(this.getNode(), 'Resposta inesperada na lista de registros.', {
                                        itemIndex: i,
                                    });
                                }
                                if (readOutputMode === 'api') {
                                    allRecords.push(record);
                                }
                                else {
                                    returnData.push({ json: record });
                                }
                            }
                            offset += response.list.length;
                            if (response.list.length === 0)
                                break;
                            if (total !== undefined && offset >= total)
                                break;
                            if (maxSize > 0 && response.list.length < maxSize)
                                break;
                        }
                        if (readOutputMode === 'api') {
                            returnData.push({
                                json: {
                                    total: total ?? allRecords.length,
                                    list: allRecords,
                                },
                            });
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
                        const filterMode = this.getNodeParameter('filterMode', i, 'builder');
                        const allRecords = [];
                        let total;
                        let where = [];
                        if (filterMode === 'builder') {
                            const built = buildWhereFromBuilder(this, i);
                            if (built.length > 0)
                                where = built;
                        }
                        if (filterMode === 'json' || where.length === 0) {
                            const whereJson = this.getNodeParameter('whereJson', i, '[]');
                            const parsed = parseJsonInput(whereJson, []);
                            if (!Array.isArray(parsed)) {
                                throw new n8n_workflow_1.NodeOperationError(this.getNode(), 'O campo Where (JSON) precisa ser um array (ex.: []).', { itemIndex: i });
                            }
                            if (parsed.length > 0)
                                where = parsed;
                        }
                        let offset = startOffset;
                        if (!autoPaginate) {
                            const qsObject = { where };
                            if (maxSize > 0)
                                qsObject.maxSize = maxSize;
                            if (offset > 0)
                                qsObject.offset = offset;
                            if (orderBy)
                                qsObject.orderBy = orderBy;
                            if (orderBy && order)
                                qsObject.order = order;
                            if (primaryFilter)
                                qsObject.primaryFilter = primaryFilter;
                            if (textFilter)
                                qsObject.textFilter = textFilter;
                            if (Array.isArray(boolFilterList) && boolFilterList.length > 0)
                                qsObject.boolFilterList = boolFilterList;
                            const qs = buildBracketQueryString(qsObject);
                            const response = await espoRequest.call(this, 'GET', `${entity}?${qs}`);
                            if (!isRecord(response) || !Array.isArray(response.list)) {
                                throw new n8n_workflow_1.NodeOperationError(this.getNode(), 'Resposta inesperada ao ler por campo(s).', { itemIndex: i });
                            }
                            if (readOutputMode === 'api') {
                                returnData.push({ json: response });
                            }
                            else {
                                for (const record of response.list) {
                                    if (!isRecord(record)) {
                                        throw new n8n_workflow_1.NodeOperationError(this.getNode(), 'Resposta inesperada na lista de registros.', { itemIndex: i });
                                    }
                                    returnData.push({ json: record });
                                }
                            }
                            continue;
                        }
                        while (true) {
                            const qsObject = { where };
                            if (maxSize > 0)
                                qsObject.maxSize = maxSize;
                            if (offset > 0)
                                qsObject.offset = offset;
                            if (orderBy)
                                qsObject.orderBy = orderBy;
                            if (orderBy && order)
                                qsObject.order = order;
                            if (primaryFilter)
                                qsObject.primaryFilter = primaryFilter;
                            if (textFilter)
                                qsObject.textFilter = textFilter;
                            if (Array.isArray(boolFilterList) && boolFilterList.length > 0)
                                qsObject.boolFilterList = boolFilterList;
                            const qs = buildBracketQueryString(qsObject);
                            const response = await espoRequest.call(this, 'GET', `${entity}?${qs}`);
                            if (!isRecord(response) || !Array.isArray(response.list)) {
                                throw new n8n_workflow_1.NodeOperationError(this.getNode(), 'Resposta inesperada ao ler por campo(s).', { itemIndex: i });
                            }
                            if (total === undefined && typeof response.total === 'number')
                                total = response.total;
                            for (const record of response.list) {
                                if (!isRecord(record)) {
                                    throw new n8n_workflow_1.NodeOperationError(this.getNode(), 'Resposta inesperada na lista de registros.', { itemIndex: i });
                                }
                                if (readOutputMode === 'api') {
                                    allRecords.push(record);
                                }
                                else {
                                    returnData.push({ json: record, pairedItem: { item: i } });
                                }
                            }
                            offset += response.list.length;
                            if (response.list.length === 0)
                                break;
                            if (total !== undefined && offset >= total)
                                break;
                            if (maxSize > 0 && response.list.length < maxSize)
                                break;
                        }
                        if (readOutputMode === 'api') {
                            returnData.push({
                                json: {
                                    total: total ?? allRecords.length,
                                    list: allRecords,
                                },
                                pairedItem: { item: i },
                            });
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
                    returnData.push({ json: response, pairedItem: { item: i } });
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
                    returnData.push({ json: response, pairedItem: { item: i } });
                    continue;
                }
                if (operationGroup === 'delete') {
                    const recordId = this.getNodeParameter('recordIdDelete', i);
                    const response = await espoRequest.call(this, 'DELETE', `${entity}/${recordId}`);
                    returnData.push({ json: { success: response === true }, pairedItem: { item: i } });
                    continue;
                }
                throw new n8n_workflow_1.NodeOperationError(this.getNode(), `Operação inválida: ${operationGroup}`, {
                    itemIndex: i,
                });
            }
            catch (error) {
                if (this.continueOnFail()) {
                    const statusCode = extractHttpStatusCode(error) ??
                        (isRecord(error) && typeof error.httpCode === 'string'
                            ? Number(error.httpCode)
                            : undefined);
                    const message = extractEspoErrorMessage(error) ??
                        (error instanceof Error ? error.message : typeof error === 'string' ? error : 'Erro desconhecido');
                    errorData.push({
                        json: {
                            statusCode: typeof statusCode === 'number' && Number.isFinite(statusCode) ? statusCode : null,
                            message,
                        },
                        pairedItem: { item: i },
                    });
                    continue;
                }
                throw error;
            }
        }
        return [returnData, errorData];
    }
}
exports.EspoCrm = EspoCrm;
