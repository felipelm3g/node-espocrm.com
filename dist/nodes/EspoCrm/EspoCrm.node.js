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
    const response = isRecord(error.response) ? error.response : undefined;
    const value = (error.statusCode ??
        error.status ??
        error.httpCode ??
        response?.statusCode ??
        response?.status ??
        error.response?.status);
    if (typeof value === 'number' && Number.isFinite(value))
        return value;
    if (typeof value === 'string' && value.trim() && !Number.isNaN(Number(value)))
        return Number(value);
    return undefined;
}
function isCustomEntityScope(scopeDef) {
    const flag = scopeDef.custom ??
        scopeDef.isCustom ??
        scopeDef.isCustomEntity ??
        scopeDef.isCustomScope ??
        scopeDef.isCustomModule;
    if (typeof flag === 'boolean')
        return flag;
    const moduleValue = scopeDef.module;
    if (typeof moduleValue === 'string' && moduleValue.trim().toLowerCase() === 'custom')
        return true;
    const typeValue = scopeDef.type;
    if (typeof typeValue === 'string' && typeValue.trim().toLowerCase().includes('custom'))
        return true;
    return false;
}
function formatEntityLabel(scopeName, scopeDef, scopeNames) {
    const base = scopeNames?.[scopeName] ?? scopeName;
    const suffix = isCustomEntityScope(scopeDef) ? 'Custom' : 'Standard';
    return `${base} (${suffix})`;
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
    if (options.headers && isRecord(options.headers)) {
        requestOptions.headers = {
            ...requestOptions.headers,
            ...options.headers,
        };
    }
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
        const response = (await this.helpers.httpRequest({
            ...requestOptions,
            returnFullResponse: true,
            ignoreHttpStatusErrors: true,
        }));
        const statusCode = extractHttpStatusCode(response);
        const responseBody = isRecord(response)
            ? Object.prototype.hasOwnProperty.call(response, 'body')
                ? response.body
                : Object.prototype.hasOwnProperty.call(response, 'data')
                    ? response.data
                    : response
            : response;
        if (typeof statusCode === 'number' && (statusCode < 200 || statusCode >= 300)) {
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
            const errorResponse = {
                statusCode,
                body: (responseBody ?? null),
                request: {
                    method,
                    url: debugUrlDisplay,
                },
            };
            const messageFromBody = responseBody === undefined || responseBody === null
                ? undefined
                : typeof responseBody === 'string'
                    ? responseBody
                    : JSON.stringify(responseBody);
            throw new n8n_workflow_1.NodeApiError(this.getNode(), errorResponse, {
                message: messageFromBody ?? `HTTP ${statusCode}`,
                description,
                httpCode: String(statusCode),
                itemIndex: options.itemIndex,
            });
        }
        return responseBody;
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
        const statusCode = extractHttpStatusCode(error);
        const responseBodyRaw = isRecord(error)
            ? (error.response?.body ??
                error.response?.data ??
                error.body ??
                error.error)
            : undefined;
        const responseBody = typeof responseBodyRaw === 'string' ? tryParseJsonString(responseBodyRaw) : responseBodyRaw;
        const errorResponse = {
            statusCode: statusCode ?? null,
            body: (responseBody ?? null),
            request: {
                method,
                url: debugUrlDisplay,
            },
        };
        const messageFromBody = responseBody === undefined || responseBody === null
            ? undefined
            : typeof responseBody === 'string'
                ? responseBody
                : JSON.stringify(responseBody);
        const apiMessage = extractEspoErrorMessage(error);
        throw new n8n_workflow_1.NodeApiError(this.getNode(), errorResponse, {
            message: messageFromBody ?? apiMessage ?? 'Falha ao chamar a API do EspoCRM.',
            description,
            httpCode: statusCode === undefined ? undefined : String(statusCode),
            itemIndex: options.itemIndex,
        });
    }
}
function parseAttributeSelectInput(value) {
    if (value === undefined || value === null)
        return [];
    if (Array.isArray(value))
        return value.map(String).map((v) => v.trim()).filter((v) => v.length > 0);
    if (typeof value !== 'string')
        return [];
    const trimmed = value.trim();
    if (!trimmed)
        return [];
    const parsed = parseJsonInput(trimmed, undefined);
    if (Array.isArray(parsed)) {
        return parsed.map(String).map((v) => v.trim()).filter((v) => v.length > 0);
    }
    return trimmed
        .split(',')
        .map((v) => v.trim())
        .filter((v) => v.length > 0);
}
function parseWhereGroupInput(value) {
    if (value === undefined || value === null || value === '')
        return [];
    const parsed = parseJsonInput(value, []);
    return Array.isArray(parsed) ? parsed : [];
}
function buildListQueryObject(params) {
    const qsObject = {};
    if (Array.isArray(params.where) && params.where.length > 0)
        qsObject.where = params.where;
    if (typeof params.maxSize === 'number' && params.maxSize > 0)
        qsObject.maxSize = params.maxSize;
    if (typeof params.offset === 'number' && params.offset > 0)
        qsObject.offset = params.offset;
    if (params.orderBy)
        qsObject.orderBy = params.orderBy;
    if (params.orderBy && params.order)
        qsObject.order = params.order;
    if (params.primaryFilter)
        qsObject.primaryFilter = params.primaryFilter;
    if (params.textFilter)
        qsObject.textFilter = params.textFilter;
    if (Array.isArray(params.boolFilterList) && params.boolFilterList.length > 0)
        qsObject.boolFilterList = params.boolFilterList;
    if (Array.isArray(params.attributeSelect) && params.attributeSelect.length > 0)
        qsObject.attributeSelect = params.attributeSelect.join(',');
    if (Array.isArray(params.whereGroup) && params.whereGroup.length > 0)
        qsObject.whereGroup = params.whereGroup;
    return qsObject;
}
async function listWithOptionalPagination(ctx, params) {
    const pageSize = params.maxSize > 0 ? Math.min(200, Math.max(1, Math.floor(params.maxSize))) : 200;
    let offset = Math.max(0, Math.floor(params.offset));
    const aggregated = [];
    let lastTotal = undefined;
    while (true) {
        const requestQsObject = {
            ...params.qsObject,
            maxSize: pageSize,
            offset,
        };
        const qs = buildBracketQueryString(requestQsObject);
        const response = await espoRequest.call(ctx, 'GET', qs ? `${params.endpoint}?${qs}` : params.endpoint, {
            headers: params.headers,
            itemIndex: params.itemIndex,
        });
        if (!isRecord(response) || !Array.isArray(response.list)) {
            throw new n8n_workflow_1.NodeOperationError(ctx.getNode(), 'Resposta inesperada ao listar registros.', {
                itemIndex: params.itemIndex,
            });
        }
        const list = response.list;
        lastTotal = response.total;
        aggregated.push(...list);
        if (!params.returnAll) {
            return response;
        }
        if (list.length === 0)
            break;
        if (list.length < pageSize)
            break;
        if (typeof lastTotal === 'number') {
            if (lastTotal === -2)
                break;
            if (lastTotal >= 0 && aggregated.length >= lastTotal)
                break;
        }
        offset += list.length;
    }
    return {
        list: aggregated,
        total: typeof lastTotal === 'number' ? lastTotal : null,
    };
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
function getAssignmentCollectionPayload(node, itemIndex, parameterName) {
    const raw = node.getNodeParameter(parameterName, itemIndex, {});
    const assignments = (raw?.assignments ?? []);
    const payload = {};
    for (const a of assignments) {
        const name = typeof a?.name === 'string' ? a.name.trim() : '';
        if (!name)
            continue;
        payload[name] = a.value;
    }
    return payload;
}
function getJsonObjectParameter(node, itemIndex, parameterName) {
    const raw = node.getNodeParameter(parameterName, itemIndex, {});
    const parsed = parseJsonInput(raw, {});
    if (!isRecord(parsed)) {
        throw new n8n_workflow_1.NodeOperationError(node.getNode(), 'Corpo (JSON) deve ser um objeto JSON.', { itemIndex });
    }
    return parsed;
}
function buildWhereFromBuilder(node, itemIndex) {
    const fixed = node.getNodeParameter('filters', itemIndex, {});
    const conditions = (fixed?.condition ?? []);
    const linkOnlyTypes = new Set(['linkedWith', 'notLinkedWith', 'isLinked', 'isNotLinked']);
    const allowedTypes = new Set([
        'equals',
        'notEquals',
        'greaterThan',
        'lessThan',
        'greaterThanOrEquals',
        'lessThanOrEquals',
        'between',
        'in',
        'notIn',
        'arrayAnyOf',
        'arrayNoneOf',
        'arrayAllOf',
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
        'linkedWith',
        'notLinkedWith',
        'isLinked',
        'isNotLinked',
        'expression',
    ]);
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
        if (!allowedTypes.has(type)) {
            throw new n8n_workflow_1.NodeOperationError(node.getNode(), `Tipo de condição inválido: ${type}`, { itemIndex });
        }
        if (type === 'expression') {
            const expression = toStringValue(data.expression).trim();
            if (!expression) {
                throw new n8n_workflow_1.NodeOperationError(node.getNode(), 'Expressão é obrigatória quando o tipo é expression.', {
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
    const usedAttributes = new Set();
    const duplicateAttributes = new Set();
    for (const condition of conditions) {
        const built = buildSimple(condition);
        result.push(built);
        const attribute = typeof built.attribute === 'string' ? built.attribute.trim() : '';
        if (attribute) {
            if (usedAttributes.has(attribute))
                duplicateAttributes.add(attribute);
            usedAttributes.add(attribute);
        }
    }
    if (duplicateAttributes.size > 0) {
        const list = Array.from(duplicateAttributes).sort((a, b) => a.localeCompare(b, 'pt-BR'));
        throw new n8n_workflow_1.NodeOperationError(node.getNode(), `Campo repetido nas condições: ${list.join(', ')}. Use apenas uma condição por campo (ex.: "in", "between" ou "expression").`, { itemIndex });
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
        subtitle: '={{$parameter["operation"] === "listEntities" ? ($parameter["operation"] || "") : (($parameter["operation"] || $parameter["action"] || $parameter["operationGroup"] || "") + ": " + $parameter["entity"])}}',
        description: 'CRUD no EspoCRM (entidades dinâmicas por instância)',
        documentationUrl: 'https://docs.espocrm.com/api/',
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
                displayName: 'Categoria',
                name: 'resource',
                type: 'options',
                noDataExpression: true,
                options: [
                    { name: 'Entidades', value: 'entities' },
                    { name: 'Documentos', value: 'documents' },
                    { name: 'Relacionamentos', value: 'relationships' },
                    { name: 'Metadata', value: 'metadata' },
                ],
                default: 'entities',
            },
            {
                displayName: 'Ação',
                name: 'operation',
                type: 'options',
                noDataExpression: true,
                displayOptions: {
                    show: {
                        resource: ['entities'],
                    },
                },
                options: [
                    { name: 'Ler todos registros', value: 'getAll', action: 'Ler todos registros' },
                    { name: 'Ler registro por ID', value: 'getById', action: 'Ler registro por ID' },
                    {
                        name: 'Procurar registro por campo(s)',
                        value: 'getByFields',
                        action: 'Procurar registro por campo(s)',
                    },
                    { name: 'Criar registro', value: 'create', action: 'Criar registro' },
                    { name: 'Editar registro', value: 'update', action: 'Editar registro' },
                    { name: 'Deletar registro', value: 'delete', action: 'Deletar registro' },
                ],
                default: 'getAll',
            },
            {
                displayName: 'Ação',
                name: 'operation',
                type: 'options',
                noDataExpression: true,
                displayOptions: {
                    show: {
                        resource: ['documents'],
                    },
                },
                options: [
                    { name: 'Listar documentos', value: 'listDocuments', action: 'Listar documentos' },
                    { name: 'Vincular documento', value: 'linkDocument', action: 'Vincular documento' },
                    { name: 'Desvincular documento', value: 'unlinkDocument', action: 'Desvincular documento' },
                ],
                default: 'listDocuments',
            },
            {
                displayName: 'Ação',
                name: 'operation',
                type: 'options',
                noDataExpression: true,
                displayOptions: {
                    show: {
                        resource: ['relationships'],
                    },
                },
                options: [
                    { name: 'Listar relacionados', value: 'listRelated', action: 'Listar relacionados' },
                    { name: 'Vincular relacionado', value: 'relate', action: 'Vincular relacionado' },
                    { name: 'Desvincular relacionado', value: 'unrelate', action: 'Desvincular relacionado' },
                ],
                default: 'listRelated',
            },
            {
                displayName: 'Ação',
                name: 'operation',
                type: 'options',
                noDataExpression: true,
                displayOptions: {
                    show: {
                        resource: ['metadata'],
                    },
                },
                options: [
                    { name: 'Listar entidades', value: 'listEntities', action: 'Listar entidades' },
                    {
                        name: 'Listar campos de entidades',
                        value: 'listEntityFields',
                        action: 'Listar campos de entidades',
                    },
                ],
                default: 'listEntities',
            },
            {
                displayName: 'Ação (legado)',
                name: 'action',
                type: 'hidden',
                default: '',
            },
            {
                displayName: 'Operação (legado)',
                name: 'operationGroup',
                type: 'hidden',
                default: '',
            },
            {
                displayName: 'Ação de Leitura (legado)',
                name: 'readOperation',
                type: 'hidden',
                default: '',
            },
            {
                displayName: 'Entidade',
                name: 'entity',
                type: 'options',
                typeOptions: {
                    loadOptionsMethod: 'getEntityOptions',
                    loadOptionsDependsOn: ['resource'],
                },
                noDataExpression: true,
                displayOptions: {
                    hide: {
                        operation: ['listEntities'],
                    },
                },
                default: '',
                required: true,
            },
            {
                displayName: 'Usar X-No-Total (legado)',
                name: 'sendNoTotalHeader',
                type: 'hidden',
                default: false,
            },
            {
                displayName: 'X-No-Total (legado)',
                name: 'noTotalHeaderValue',
                type: 'hidden',
                default: true,
            },
            {
                displayName: 'ID do Registro',
                name: 'recordId',
                type: 'string',
                displayOptions: {
                    show: {
                        operation: ['getById'],
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
                        operation: ['update'],
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
                        operation: ['delete'],
                    },
                },
                default: '',
                required: true,
            },
            {
                displayName: 'ID do Registro',
                name: 'recordIdLinkDocument',
                type: 'string',
                displayOptions: {
                    show: {
                        operation: ['linkDocument', 'unlinkDocument'],
                    },
                },
                default: '',
                required: true,
            },
            {
                displayName: 'ID do Registro',
                name: 'recordIdListDocuments',
                type: 'string',
                displayOptions: {
                    show: {
                        operation: ['listDocuments'],
                    },
                },
                default: '',
                required: true,
            },
            {
                displayName: 'ID do Registro',
                name: 'recordIdRelationship',
                type: 'string',
                displayOptions: {
                    show: {
                        operation: ['listRelated', 'relate', 'unrelate'],
                    },
                },
                default: '',
                required: true,
            },
            {
                displayName: 'Relacionamento (Document)',
                name: 'documentLinkField',
                type: 'options',
                typeOptions: {
                    loadOptionsMethod: 'getEntityDocumentLinkOptions',
                    loadOptionsDependsOn: ['entity'],
                },
                noDataExpression: true,
                displayOptions: {
                    show: {
                        operation: ['linkDocument', 'unlinkDocument', 'listDocuments'],
                    },
                },
                default: '',
                required: true,
            },
            {
                displayName: 'Relacionamento',
                name: 'relationshipLinkField',
                type: 'options',
                typeOptions: {
                    loadOptionsMethod: 'getEntityRelationshipLinkOptions',
                    loadOptionsDependsOn: ['entity'],
                },
                noDataExpression: true,
                displayOptions: {
                    show: {
                        operation: ['listRelated', 'relate', 'unrelate'],
                    },
                },
                default: '',
                required: true,
            },
            {
                displayName: 'ID do Relacionado',
                name: 'relatedRecordId',
                type: 'string',
                displayOptions: {
                    show: {
                        operation: ['relate', 'unrelate'],
                    },
                },
                default: '',
                required: true,
            },
            {
                displayName: 'ID do Documento',
                name: 'documentId',
                type: 'string',
                displayOptions: {
                    show: {
                        operation: ['linkDocument', 'unlinkDocument'],
                    },
                },
                default: '',
                required: true,
            },
            {
                displayName: 'Filtros',
                name: 'filters',
                type: 'fixedCollection',
                typeOptions: {
                    multipleValues: true,
                    multipleValueButtonText: 'Adicionar filtro',
                },
                displayOptions: {
                    show: {
                        operation: ['getByFields'],
                    },
                },
                default: {},
                placeholder: 'Adicionar filtro',
                options: [
                    {
                        name: 'condition',
                        displayName: 'Filtro',
                        values: [
                            {
                                displayName: 'Tipo',
                                name: 'type',
                                type: 'options',
                                noDataExpression: true,
                                options: [
                                    { name: 'Igual (equals)', value: 'equals' },
                                    { name: 'Diferente (notEquals)', value: 'notEquals' },
                                    { name: 'Maior que (greaterThan)', value: 'greaterThan' },
                                    { name: 'Menor que (lessThan)', value: 'lessThan' },
                                    { name: 'Maior ou igual (greaterThanOrEquals)', value: 'greaterThanOrEquals' },
                                    { name: 'Menor ou igual (lessThanOrEquals)', value: 'lessThanOrEquals' },
                                    { name: 'Entre (between)', value: 'between' },
                                    { name: 'Em lista (in)', value: 'in' },
                                    { name: 'Não em lista (notIn)', value: 'notIn' },
                                    { name: 'Array: algum dos valores (arrayAnyOf)', value: 'arrayAnyOf' },
                                    { name: 'Array: nenhum dos valores (arrayNoneOf)', value: 'arrayNoneOf' },
                                    { name: 'Array: todos os valores (arrayAllOf)', value: 'arrayAllOf' },
                                    { name: 'Semelhante (like)', value: 'like' },
                                    { name: 'Não semelhante (notLike)', value: 'notLike' },
                                    { name: 'Começa com (startsWith)', value: 'startsWith' },
                                    { name: 'Termina com (endsWith)', value: 'endsWith' },
                                    { name: 'Contém (contains)', value: 'contains' },
                                    { name: 'Não contém (notContains)', value: 'notContains' },
                                    { name: 'Depois de (after)', value: 'after' },
                                    { name: 'Antes de (before)', value: 'before' },
                                    { name: 'Hoje (today)', value: 'today' },
                                    { name: 'Passado (past)', value: 'past' },
                                    { name: 'Futuro (future)', value: 'future' },
                                    { name: 'Últimos 7 dias (lastSevenDays)', value: 'lastSevenDays' },
                                    { name: 'Últimos X dias (lastXDays)', value: 'lastXDays' },
                                    { name: 'Próximos X dias (nextXDays)', value: 'nextXDays' },
                                    { name: 'Mais antigo que X dias (olderThanXDays)', value: 'olderThanXDays' },
                                    { name: 'Depois de X dias (afterXDays)', value: 'afterXDays' },
                                    { name: 'É nulo (isNull)', value: 'isNull' },
                                    { name: 'Não é nulo (isNotNull)', value: 'isNotNull' },
                                    { name: 'É verdadeiro (isTrue)', value: 'isTrue' },
                                    { name: 'É falso (isFalse)', value: 'isFalse' },
                                    { name: 'Ligado com (linkedWith)', value: 'linkedWith' },
                                    { name: 'Não ligado com (notLinkedWith)', value: 'notLinkedWith' },
                                    { name: 'Está ligado (isLinked)', value: 'isLinked' },
                                    { name: 'Não está ligado (isNotLinked)', value: 'isNotLinked' },
                                    { name: 'Expressão (expression)', value: 'expression' },
                                ],
                                default: 'equals',
                            },
                            {
                                displayName: 'Relacionamento (atributo)',
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
                                displayName: 'Campo (atributo)',
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
                                required: true,
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
                                required: true,
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
                                required: true,
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
                                                required: true,
                                            },
                                        ],
                                    },
                                ],
                            },
                            {
                                displayName: 'Expressão',
                                name: 'expression',
                                type: 'string',
                                displayOptions: {
                                    show: {
                                        type: ['expression'],
                                    },
                                },
                                default: '',
                                required: true,
                            },
                        ],
                    },
                ],
            },
            {
                displayName: 'Opções',
                name: 'options',
                type: 'collection',
                placeholder: 'Adicionar opção',
                displayOptions: {
                    show: {
                        operation: ['getAll', 'getByFields', 'listDocuments', 'listRelated'],
                    },
                },
                default: {},
                options: [
                    {
                        displayName: 'Não calcular total (melhor desempenho)',
                        name: 'disableTotalCalculation',
                        type: 'boolean',
                        default: false,
                    },
                    {
                        displayName: 'Retornar lista como itens (remover total)',
                        name: 'extractListItems',
                        type: 'boolean',
                        default: false,
                    },
                    {
                        displayName: 'Retornar tudo (paginar automaticamente)',
                        name: 'returnAll',
                        type: 'boolean',
                        default: false,
                    },
                    {
                        displayName: 'Tamanho Máx.',
                        name: 'maxSize',
                        type: 'number',
                        typeOptions: {
                            minValue: 0,
                            maxValue: 200,
                        },
                        default: 0,
                    },
                    {
                        displayName: 'Deslocamento (offset)',
                        name: 'offset',
                        type: 'number',
                        typeOptions: {
                            minValue: 0,
                        },
                        default: 0,
                    },
                    {
                        displayName: 'Ordenar por',
                        name: 'orderBy',
                        type: 'options',
                        typeOptions: {
                            loadOptionsMethod: 'getEntityFieldOptions',
                            loadOptionsDependsOn: ['entity'],
                        },
                        noDataExpression: true,
                        default: '',
                    },
                    {
                        displayName: 'Ordem',
                        name: 'order',
                        type: 'options',
                        noDataExpression: true,
                        options: [
                            { name: 'Crescente', value: 'asc' },
                            { name: 'Decrescente', value: 'desc' },
                        ],
                        default: 'asc',
                    },
                    {
                        displayName: 'Filtro Primário',
                        name: 'primaryFilter',
                        type: 'options',
                        typeOptions: {
                            loadOptionsMethod: 'getEntityPrimaryFilterOptions',
                            loadOptionsDependsOn: ['entity'],
                        },
                        noDataExpression: true,
                        default: '',
                    },
                    {
                        displayName: 'Filtros Booleanos',
                        name: 'boolFilterList',
                        type: 'multiOptions',
                        typeOptions: {
                            loadOptionsMethod: 'getEntityBoolFilterOptions',
                            loadOptionsDependsOn: ['entity'],
                        },
                        noDataExpression: true,
                        default: [],
                    },
                    {
                        displayName: 'Filtro de Texto',
                        name: 'textFilter',
                        type: 'string',
                        default: '',
                    },
                    {
                        displayName: 'Atributos (attributeSelect)',
                        name: 'attributeSelect',
                        type: 'multiOptions',
                        typeOptions: {
                            loadOptionsMethod: 'getEntityAttributeSelectOptions',
                            loadOptionsDependsOn: ['entity'],
                        },
                        noDataExpression: true,
                        default: [],
                    },
                    {
                        displayName: 'Where Group (whereGroup)',
                        name: 'whereGroup',
                        type: 'json',
                        default: [],
                    },
                ],
            },
            {
                displayName: 'Opções (Atualizar)',
                name: 'updateOptions',
                type: 'collection',
                placeholder: 'Adicionar opção',
                displayOptions: {
                    show: {
                        operation: ['update'],
                    },
                },
                default: {},
                options: [
                    {
                        displayName: 'Version Number (X-Version-Number)',
                        name: 'versionNumber',
                        type: 'string',
                        default: '',
                    },
                ],
            },
            {
                displayName: 'Modo de Entrada',
                name: 'createInputMode',
                type: 'options',
                noDataExpression: true,
                displayOptions: {
                    show: {
                        operation: ['create'],
                    },
                },
                options: [
                    { name: 'Campo a campo', value: 'fields' },
                    { name: 'JSON', value: 'json' },
                ],
                default: 'fields',
            },
            {
                displayName: 'Corpo (JSON)',
                name: 'createPayloadJson',
                type: 'json',
                displayOptions: {
                    show: {
                        operation: ['create'],
                        createInputMode: ['json'],
                    },
                },
                default: {},
                required: true,
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
                        operation: ['create'],
                        createInputMode: ['fields'],
                    },
                    hide: {
                        '@tool': [true],
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
                                required: true,
                            },
                        ],
                    },
                ],
            },
            {
                displayName: 'Campos',
                name: 'createFieldsAi',
                type: 'assignmentCollection',
                typeOptions: {
                    assignment: {
                        hideType: true,
                        disableType: true,
                        defaultType: 'string',
                    },
                },
                displayOptions: {
                    show: {
                        operation: ['create'],
                        createInputMode: ['fields'],
                        '@tool': [true],
                    },
                },
                default: {
                    assignments: [],
                },
            },
            {
                displayName: 'Opções (Criar)',
                name: 'createOptions',
                type: 'collection',
                placeholder: 'Adicionar opção',
                displayOptions: {
                    show: {
                        operation: ['create'],
                    },
                },
                default: {},
                options: [
                    {
                        displayName: 'Pular checagem de duplicidade (X-Skip-Duplicate-Check)',
                        name: 'skipDuplicateCheck',
                        type: 'boolean',
                        default: false,
                    },
                    {
                        displayName: 'ID da origem do duplicado (X-Duplicate-Source-Id)',
                        name: 'duplicateSourceId',
                        type: 'string',
                        default: '',
                    },
                ],
            },
            {
                displayName: 'Modo de Entrada',
                name: 'updateInputMode',
                type: 'options',
                noDataExpression: true,
                displayOptions: {
                    show: {
                        operation: ['update'],
                    },
                },
                options: [
                    { name: 'Campo a campo', value: 'fields' },
                    { name: 'JSON', value: 'json' },
                ],
                default: 'fields',
            },
            {
                displayName: 'Corpo (JSON)',
                name: 'updatePayloadJson',
                type: 'json',
                displayOptions: {
                    show: {
                        operation: ['update'],
                        updateInputMode: ['json'],
                    },
                },
                default: {},
                required: true,
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
                        operation: ['update'],
                        updateInputMode: ['fields'],
                    },
                    hide: {
                        '@tool': [true],
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
                                required: true,
                            },
                        ],
                    },
                ],
            },
            {
                displayName: 'Campos',
                name: 'updateFieldsAi',
                type: 'assignmentCollection',
                typeOptions: {
                    assignment: {
                        hideType: true,
                        disableType: true,
                        defaultType: 'string',
                    },
                },
                displayOptions: {
                    show: {
                        operation: ['update'],
                        updateInputMode: ['fields'],
                        '@tool': [true],
                    },
                },
                default: {
                    assignments: [],
                },
            },
        ],
    };
    methods = {
        loadOptions: {
            async getEntityOptions() {
                const resource = this.getCurrentNodeParameter('resource');
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
                const candidates = [];
                for (const [scopeName, scopeDef] of Object.entries(scopes)) {
                    if (!isRecord(scopeDef))
                        continue;
                    if (scopeDef.entity !== true)
                        continue;
                    if (scopeDef.disabled === true)
                        continue;
                    candidates.push({ scopeName, scopeDef });
                }
                let allowed = candidates;
                if (resource === 'documents') {
                    const allowedSet = new Set();
                    const batchSize = 10;
                    for (let start = 0; start < candidates.length; start += batchSize) {
                        const batch = candidates.slice(start, start + batchSize);
                        const results = await Promise.all(batch.map(async ({ scopeName }) => {
                            try {
                                const linksKey = encodeURIComponent(`entityDefs.${scopeName}.links`);
                                const linksDefs = await espoRequest.call(this, 'GET', `Metadata?key=${linksKey}`);
                                if (!isRecord(linksDefs))
                                    return { scopeName, ok: false };
                                for (const linkDef of Object.values(linksDefs)) {
                                    if (isRecord(linkDef) && linkDef.entity === 'Document')
                                        return { scopeName, ok: true };
                                }
                                return { scopeName, ok: false };
                            }
                            catch {
                                return { scopeName, ok: false };
                            }
                        }));
                        for (const r of results) {
                            if (r.ok)
                                allowedSet.add(r.scopeName);
                        }
                    }
                    allowed = candidates.filter((c) => allowedSet.has(c.scopeName));
                }
                for (const { scopeName, scopeDef } of allowed) {
                    const label = formatEntityLabel(scopeName, scopeDef, scopeNames);
                    options.push({ name: label, value: scopeName });
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
                        const isAttachmentField = fieldType === 'file' || fieldType === 'image';
                        const isLinkField = isAttachmentField ||
                            fieldType === 'link' ||
                            fieldType === 'linkParent' ||
                            fieldType === 'linkMultiple';
                        if (!isLinkField) {
                            const label = labelRaw === fieldName ? fieldName : `${labelRaw} (${fieldName})`;
                            if (!values.has(fieldName)) {
                                options.push({ name: label, value: fieldName });
                                values.add(fieldName);
                            }
                        }
                        if (fieldType === 'link' || fieldType === 'linkParent' || isAttachmentField) {
                            const idAttribute = `${fieldName}Id`;
                            if (!values.has(idAttribute)) {
                                const idLabel = labelRaw === fieldName ? `${idAttribute}` : `${labelRaw} (ID) (${idAttribute})`;
                                options.push({ name: idLabel, value: idAttribute });
                                values.add(idAttribute);
                            }
                        }
                        if (fieldType === 'link' || fieldType === 'linkParent' || isAttachmentField) {
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
            async getEntityAttributeSelectOptions() {
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
                        const labelRaw = fieldLabels?.[fieldName] ?? fieldName;
                        const fieldType = isRecord(fieldDef) ? fieldDef.type : undefined;
                        const isAttachmentField = fieldType === 'file' || fieldType === 'image';
                        const label = labelRaw === fieldName ? fieldName : `${labelRaw} (${fieldName})`;
                        if (!values.has(fieldName)) {
                            options.push({ name: label, value: fieldName });
                            values.add(fieldName);
                        }
                        if (fieldType === 'link' || fieldType === 'linkParent' || isAttachmentField) {
                            const idAttribute = `${fieldName}Id`;
                            if (!values.has(idAttribute)) {
                                const idLabel = labelRaw === fieldName ? `${idAttribute}` : `${labelRaw} (ID) (${idAttribute})`;
                                options.push({ name: idLabel, value: idAttribute });
                                values.add(idAttribute);
                            }
                            const nameAttribute = `${fieldName}Name`;
                            if (!values.has(nameAttribute)) {
                                const nameLabel = labelRaw === fieldName ? `${nameAttribute}` : `${labelRaw} (Nome) (${nameAttribute})`;
                                options.push({ name: nameLabel, value: nameAttribute });
                                values.add(nameAttribute);
                            }
                        }
                        if (fieldType === 'linkParent') {
                            const typeAttribute = `${fieldName}Type`;
                            if (!values.has(typeAttribute)) {
                                const typeLabel = labelRaw === fieldName ? `${typeAttribute}` : `${labelRaw} (Tipo) (${typeAttribute})`;
                                options.push({ name: typeLabel, value: typeAttribute });
                                values.add(typeAttribute);
                            }
                        }
                        if (fieldType === 'linkMultiple') {
                            const idsAttribute = `${fieldName}Ids`;
                            if (!values.has(idsAttribute)) {
                                const idsLabel = labelRaw === fieldName ? `${idsAttribute}` : `${labelRaw} (IDs) (${idsAttribute})`;
                                options.push({ name: idsLabel, value: idsAttribute });
                                values.add(idsAttribute);
                            }
                            const namesAttribute = `${fieldName}Names`;
                            if (!values.has(namesAttribute)) {
                                const namesLabel = labelRaw === fieldName ? `${namesAttribute}` : `${labelRaw} (Nomes) (${namesAttribute})`;
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
            async getEntityDocumentLinkOptions() {
                const entity = this.getCurrentNodeParameter('entity');
                if (!entity)
                    return [];
                const key = encodeURIComponent(`entityDefs.${entity}.links`);
                const [linksDefs, i18n] = await Promise.all([
                    espoRequest.call(this, 'GET', `Metadata?key=${key}`),
                    espoRequest.call(this, 'GET', 'I18n'),
                ]);
                const entityI18nContainer = isRecord(i18n) ? i18n[entity] : undefined;
                const linksLabelsContainer = isRecord(entityI18nContainer) && isRecord(entityI18nContainer.links) ? entityI18nContainer.links : {};
                const linkLabels = {};
                for (const [k, v] of Object.entries(linksLabelsContainer)) {
                    if (typeof v === 'string')
                        linkLabels[k] = v;
                }
                const options = [];
                const values = new Set();
                if (isRecord(linksDefs)) {
                    for (const [linkName, linkDef] of Object.entries(linksDefs)) {
                        if (!isRecord(linkDef))
                            continue;
                        if (linkDef.entity !== 'Document')
                            continue;
                        const labelRaw = linkLabels?.[linkName] ?? linkName;
                        const label = labelRaw === linkName ? linkName : `${labelRaw} (${linkName})`;
                        if (!values.has(linkName)) {
                            options.push({ name: label, value: linkName });
                            values.add(linkName);
                        }
                    }
                }
                options.sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
                return options;
            },
            async getEntityRelationshipLinkOptions() {
                const entity = this.getCurrentNodeParameter('entity');
                if (!entity)
                    return [];
                const key = encodeURIComponent(`entityDefs.${entity}.links`);
                const [linksDefs, i18n] = await Promise.all([
                    espoRequest.call(this, 'GET', `Metadata?key=${key}`),
                    espoRequest.call(this, 'GET', 'I18n'),
                ]);
                const entityI18nContainer = isRecord(i18n) ? i18n[entity] : undefined;
                const linksLabelsContainer = isRecord(entityI18nContainer) && isRecord(entityI18nContainer.links) ? entityI18nContainer.links : {};
                const linkLabels = {};
                for (const [k, v] of Object.entries(linksLabelsContainer)) {
                    if (typeof v === 'string')
                        linkLabels[k] = v;
                }
                const options = [];
                const values = new Set();
                if (isRecord(linksDefs)) {
                    for (const [linkName, linkDef] of Object.entries(linksDefs)) {
                        if (!isRecord(linkDef))
                            continue;
                        const relatedEntity = typeof linkDef.entity === 'string' ? linkDef.entity : '';
                        if (!relatedEntity)
                            continue;
                        const labelRaw = linkLabels?.[linkName] ?? linkName;
                        const label = labelRaw === linkName ? `${linkName} → ${relatedEntity}` : `${labelRaw} (${linkName}) → ${relatedEntity}`;
                        if (!values.has(linkName)) {
                            options.push({ name: label, value: linkName });
                            values.add(linkName);
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
                const raw = await espoRequest.call(this, 'GET', `Metadata?key=${key}`);
                const filterList = Array.isArray(raw)
                    ? raw
                    : isRecord(raw) && Array.isArray(raw.filterList)
                        ? raw.filterList
                        : [];
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
                const raw = await espoRequest.call(this, 'GET', `Metadata?key=${key}`);
                const boolFilterList = Array.isArray(raw)
                    ? raw
                    : isRecord(raw) && Array.isArray(raw.boolFilterList)
                        ? raw.boolFilterList
                        : [];
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
        const inputItems = this.getInputData();
        const items = inputItems.length > 0 ? inputItems : [{ json: {} }];
        const returnData = [];
        const onError = (this.getNode().onError ?? 'stopWorkflow');
        const nodeParameters = this.getNode().parameters;
        const hasOperationParameter = Object.prototype.hasOwnProperty.call(nodeParameters, 'operation');
        for (let i = 0; i < items.length; i++) {
            try {
                const sendNoTotalHeader = this.getNodeParameter('sendNoTotalHeader', i, false);
                const noTotalHeaderValue = this.getNodeParameter('noTotalHeaderValue', i, true);
                let requestHeaders = sendNoTotalHeader
                    ? { 'X-No-Total': noTotalHeaderValue ? 'true' : 'false' }
                    : undefined;
                let operation = hasOperationParameter ? this.getNodeParameter('operation', i) : '';
                if (!operation) {
                    const legacyAction = this.getNodeParameter('action', i, '');
                    if (legacyAction.startsWith('read.')) {
                        operation = legacyAction.slice('read.'.length);
                    }
                    else if (legacyAction) {
                        operation = legacyAction;
                    }
                }
                if (!operation) {
                    const legacyOperationGroup = this.getNodeParameter('operationGroup', i, '');
                    if (legacyOperationGroup === 'read') {
                        const legacyReadOperation = this.getNodeParameter('readOperation', i, 'getAll');
                        operation = legacyReadOperation;
                    }
                    else if (legacyOperationGroup) {
                        operation = legacyOperationGroup;
                    }
                }
                if (operation === 'listEntities') {
                    const metadata = await espoRequest.call(this, 'GET', 'Metadata/scopes', {
                        headers: requestHeaders,
                        itemIndex: i,
                    });
                    const i18n = await espoRequest.call(this, 'GET', 'I18n', { headers: requestHeaders, itemIndex: i });
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
                    const list = [];
                    for (const [scopeName, scopeDef] of Object.entries(scopes)) {
                        if (!isRecord(scopeDef))
                            continue;
                        if (scopeDef.entity !== true)
                            continue;
                        if (scopeDef.disabled === true)
                            continue;
                        const label = formatEntityLabel(scopeName, scopeDef, scopeNames);
                        list.push({ entity: scopeName, label });
                    }
                    list.sort((a, b) => a.label.localeCompare(b.label, 'pt-BR'));
                    returnData.push({ json: { list }, pairedItem: { item: i } });
                    continue;
                }
                const entity = this.getNodeParameter('entity', i, '');
                if (operation === 'getById') {
                    if (!entity) {
                        throw new n8n_workflow_1.NodeOperationError(this.getNode(), 'Entidade é obrigatória.', { itemIndex: i });
                    }
                    const recordId = this.getNodeParameter('recordId', i);
                    const response = await espoRequest.call(this, 'GET', `${entity}/${recordId}`, {
                        headers: requestHeaders,
                        itemIndex: i,
                    });
                    if (!isRecord(response)) {
                        throw new n8n_workflow_1.NodeOperationError(this.getNode(), 'Resposta inesperada ao obter registro por ID.', {
                            itemIndex: i,
                        });
                    }
                    returnData.push({ json: response, pairedItem: { item: i } });
                    continue;
                }
                if (operation === 'listEntityFields') {
                    if (!entity) {
                        throw new n8n_workflow_1.NodeOperationError(this.getNode(), 'Entidade é obrigatória.', { itemIndex: i });
                    }
                    const key = encodeURIComponent(`entityDefs.${entity}.fields`);
                    const [fieldsDefs, i18n] = await Promise.all([
                        espoRequest.call(this, 'GET', `Metadata?key=${key}`, { headers: requestHeaders, itemIndex: i }),
                        espoRequest.call(this, 'GET', 'I18n', { headers: requestHeaders, itemIndex: i }),
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
                    const fields = [];
                    if (isRecord(fieldsDefs)) {
                        for (const [fieldName, fieldDef] of Object.entries(fieldsDefs)) {
                            const label = fieldLabels?.[fieldName] ?? fieldName;
                            const type = isRecord(fieldDef) && typeof fieldDef.type === 'string' ? fieldDef.type : undefined;
                            fields.push({ name: fieldName, label, type, definition: fieldDef });
                        }
                    }
                    fields.sort((a, b) => a.label.localeCompare(b.label, 'pt-BR'));
                    returnData.push({ json: { entity, fields }, pairedItem: { item: i } });
                    continue;
                }
                if (!entity) {
                    throw new n8n_workflow_1.NodeOperationError(this.getNode(), 'Entidade é obrigatória.', { itemIndex: i });
                }
                const options = this.getNodeParameter('options', i, {});
                if (options.disableTotalCalculation === true) {
                    requestHeaders = isRecord(requestHeaders)
                        ? { ...requestHeaders, 'X-No-Total': 'true' }
                        : { 'X-No-Total': 'true' };
                }
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
                const returnAll = options.returnAll === true;
                const extractListItems = options.extractListItems === true;
                const attributeSelect = parseAttributeSelectInput(options.attributeSelect);
                const whereGroup = parseWhereGroupInput(options.whereGroup);
                const pushExtractedListIfPresent = (response) => {
                    if (!extractListItems)
                        return false;
                    if (!isRecord(response))
                        return false;
                    if (!Object.prototype.hasOwnProperty.call(response, 'list'))
                        return false;
                    if (!Object.prototype.hasOwnProperty.call(response, 'total'))
                        return false;
                    const list = response.list;
                    if (!Array.isArray(list))
                        return false;
                    for (const entry of list) {
                        if (isRecord(entry)) {
                            returnData.push({ json: entry, pairedItem: { item: i } });
                        }
                        else {
                            returnData.push({ json: { value: entry }, pairedItem: { item: i } });
                        }
                    }
                    return true;
                };
                if (operation === 'getAll') {
                    const qsObject = buildListQueryObject({
                        offset: startOffset,
                        maxSize,
                        orderBy,
                        order,
                        primaryFilter,
                        boolFilterList,
                        textFilter,
                        attributeSelect,
                        whereGroup,
                    });
                    const response = await listWithOptionalPagination(this, {
                        endpoint: entity,
                        headers: requestHeaders,
                        itemIndex: i,
                        returnAll,
                        maxSize,
                        offset: startOffset,
                        qsObject,
                    });
                    if (pushExtractedListIfPresent(response))
                        continue;
                    returnData.push({ json: response, pairedItem: { item: i } });
                    continue;
                }
                if (operation === 'getByFields') {
                    const where = buildWhereFromBuilder(this, i);
                    const qsObject = buildListQueryObject({
                        where,
                        offset: startOffset,
                        maxSize,
                        orderBy,
                        order,
                        primaryFilter,
                        boolFilterList,
                        textFilter,
                        attributeSelect,
                        whereGroup,
                    });
                    const response = await listWithOptionalPagination(this, {
                        endpoint: entity,
                        headers: requestHeaders,
                        itemIndex: i,
                        returnAll,
                        maxSize,
                        offset: startOffset,
                        qsObject,
                    });
                    if (pushExtractedListIfPresent(response))
                        continue;
                    returnData.push({ json: response, pairedItem: { item: i } });
                    continue;
                }
                if (operation === 'create') {
                    const inputMode = this.getNodeParameter('createInputMode', i, 'fields');
                    const payload = inputMode === 'json'
                        ? getJsonObjectParameter(this, i, 'createPayloadJson')
                        : isRecord(this.getNode().parameters) && (this.getNode().type ?? '').endsWith('Tool')
                            ? getAssignmentCollectionPayload(this, i, 'createFieldsAi')
                            : getFieldAssignments(this, i, 'createFields');
                    if (Object.keys(payload).length === 0) {
                        throw new n8n_workflow_1.NodeOperationError(this.getNode(), 'Informe ao menos um campo no corpo da requisição.', {
                            itemIndex: i,
                        });
                    }
                    const createOptions = this.getNodeParameter('createOptions', i, {});
                    const createHeaders = {};
                    if (createOptions.skipDuplicateCheck === true) {
                        createHeaders['X-Skip-Duplicate-Check'] = 'true';
                    }
                    if (typeof createOptions.duplicateSourceId === 'string' && createOptions.duplicateSourceId.trim()) {
                        createHeaders['X-Duplicate-Source-Id'] = createOptions.duplicateSourceId.trim();
                    }
                    const headers = isRecord(requestHeaders)
                        ? { ...requestHeaders, ...createHeaders }
                        : (Object.keys(createHeaders).length > 0 ? createHeaders : requestHeaders);
                    const response = await espoRequest.call(this, 'POST', entity, {
                        headers,
                        body: payload,
                        itemIndex: i,
                    });
                    if (!isRecord(response)) {
                        throw new n8n_workflow_1.NodeOperationError(this.getNode(), 'Resposta inesperada ao criar registro.', {
                            itemIndex: i,
                        });
                    }
                    returnData.push({ json: response, pairedItem: { item: i } });
                    continue;
                }
                if (operation === 'update') {
                    const recordId = this.getNodeParameter('recordIdUpdate', i);
                    const inputMode = this.getNodeParameter('updateInputMode', i, 'fields');
                    const payload = inputMode === 'json'
                        ? getJsonObjectParameter(this, i, 'updatePayloadJson')
                        : isRecord(this.getNode().parameters) && (this.getNode().type ?? '').endsWith('Tool')
                            ? getAssignmentCollectionPayload(this, i, 'updateFieldsAi')
                            : getFieldAssignments(this, i, 'updateFields');
                    if (Object.keys(payload).length === 0) {
                        throw new n8n_workflow_1.NodeOperationError(this.getNode(), 'Informe ao menos um campo no corpo da requisição.', {
                            itemIndex: i,
                        });
                    }
                    const updateOptions = this.getNodeParameter('updateOptions', i, {});
                    const versionNumber = typeof updateOptions.versionNumber === 'string' ? updateOptions.versionNumber.trim() : '';
                    const updateHeaders = versionNumber ? { 'X-Version-Number': versionNumber } : {};
                    const headers = isRecord(requestHeaders)
                        ? { ...requestHeaders, ...updateHeaders }
                        : (Object.keys(updateHeaders).length > 0 ? updateHeaders : requestHeaders);
                    const response = await espoRequest.call(this, 'PATCH', `${entity}/${recordId}`, {
                        headers,
                        body: payload,
                        itemIndex: i,
                    });
                    if (!isRecord(response)) {
                        throw new n8n_workflow_1.NodeOperationError(this.getNode(), 'Resposta inesperada ao editar registro.', {
                            itemIndex: i,
                        });
                    }
                    returnData.push({ json: response, pairedItem: { item: i } });
                    continue;
                }
                if (operation === 'listDocuments') {
                    if (!entity) {
                        throw new n8n_workflow_1.NodeOperationError(this.getNode(), 'Entidade é obrigatória.', { itemIndex: i });
                    }
                    const recordId = this.getNodeParameter('recordIdListDocuments', i);
                    const documentLinkField = this.getNodeParameter('documentLinkField', i);
                    const endpoint = `${entity}/${recordId}/${documentLinkField}`;
                    const qsObject = buildListQueryObject({
                        offset: startOffset,
                        maxSize,
                        orderBy,
                        order,
                        primaryFilter,
                        boolFilterList,
                        textFilter,
                        attributeSelect,
                        whereGroup,
                    });
                    if (returnAll) {
                        const response = await listWithOptionalPagination(this, {
                            endpoint,
                            headers: requestHeaders,
                            itemIndex: i,
                            returnAll,
                            maxSize,
                            offset: startOffset,
                            qsObject,
                        });
                        if (pushExtractedListIfPresent(response))
                            continue;
                        returnData.push({ json: response, pairedItem: { item: i } });
                        continue;
                    }
                    const qs = buildBracketQueryString(qsObject);
                    const response = await espoRequest.call(this, 'GET', qs ? `${endpoint}?${qs}` : endpoint, {
                        headers: requestHeaders,
                        itemIndex: i,
                    });
                    if (isRecord(response)) {
                        if (pushExtractedListIfPresent(response))
                            continue;
                        returnData.push({ json: response, pairedItem: { item: i } });
                        continue;
                    }
                    returnData.push({
                        json: {
                            entity,
                            recordId,
                            linkFieldName: documentLinkField,
                            documents: (response ?? null),
                        },
                        pairedItem: { item: i },
                    });
                    continue;
                }
                if (operation === 'listRelated') {
                    if (!entity) {
                        throw new n8n_workflow_1.NodeOperationError(this.getNode(), 'Entidade é obrigatória.', { itemIndex: i });
                    }
                    const recordId = this.getNodeParameter('recordIdRelationship', i);
                    const relationshipLinkField = this.getNodeParameter('relationshipLinkField', i);
                    const endpoint = `${entity}/${recordId}/${relationshipLinkField}`;
                    const qsObject = buildListQueryObject({
                        offset: startOffset,
                        maxSize,
                        orderBy,
                        order,
                        primaryFilter,
                        boolFilterList,
                        textFilter,
                        attributeSelect,
                        whereGroup,
                    });
                    if (returnAll) {
                        const response = await listWithOptionalPagination(this, {
                            endpoint,
                            headers: requestHeaders,
                            itemIndex: i,
                            returnAll,
                            maxSize,
                            offset: startOffset,
                            qsObject,
                        });
                        if (pushExtractedListIfPresent(response))
                            continue;
                        returnData.push({ json: response, pairedItem: { item: i } });
                        continue;
                    }
                    const qs = buildBracketQueryString(qsObject);
                    const response = await espoRequest.call(this, 'GET', qs ? `${endpoint}?${qs}` : endpoint, {
                        headers: requestHeaders,
                        itemIndex: i,
                    });
                    if (isRecord(response)) {
                        if (pushExtractedListIfPresent(response))
                            continue;
                        returnData.push({ json: response, pairedItem: { item: i } });
                        continue;
                    }
                    returnData.push({
                        json: {
                            entity,
                            recordId,
                            linkFieldName: relationshipLinkField,
                            related: (response ?? null),
                        },
                        pairedItem: { item: i },
                    });
                    continue;
                }
                if (operation === 'relate') {
                    if (!entity) {
                        throw new n8n_workflow_1.NodeOperationError(this.getNode(), 'Entidade é obrigatória.', { itemIndex: i });
                    }
                    const recordId = this.getNodeParameter('recordIdRelationship', i);
                    const relationshipLinkField = this.getNodeParameter('relationshipLinkField', i);
                    const relatedRecordId = this.getNodeParameter('relatedRecordId', i);
                    const response = await espoRequest.call(this, 'POST', `${entity}/${recordId}/${relationshipLinkField}`, {
                        headers: requestHeaders,
                        body: { id: relatedRecordId },
                        itemIndex: i,
                    });
                    if (isRecord(response)) {
                        returnData.push({ json: response, pairedItem: { item: i } });
                        continue;
                    }
                    returnData.push({
                        json: {
                            linked: true,
                            entity,
                            recordId,
                            relatedRecordId,
                            linkFieldName: relationshipLinkField,
                            response: (response ?? null),
                        },
                        pairedItem: { item: i },
                    });
                    continue;
                }
                if (operation === 'unrelate') {
                    if (!entity) {
                        throw new n8n_workflow_1.NodeOperationError(this.getNode(), 'Entidade é obrigatória.', { itemIndex: i });
                    }
                    const recordId = this.getNodeParameter('recordIdRelationship', i);
                    const relationshipLinkField = this.getNodeParameter('relationshipLinkField', i);
                    const relatedRecordId = this.getNodeParameter('relatedRecordId', i);
                    const response = await espoRequest.call(this, 'DELETE', `${entity}/${recordId}/${relationshipLinkField}`, {
                        headers: requestHeaders,
                        body: { id: relatedRecordId },
                        itemIndex: i,
                    });
                    if (isRecord(response)) {
                        returnData.push({ json: response, pairedItem: { item: i } });
                        continue;
                    }
                    returnData.push({
                        json: {
                            unlinked: true,
                            entity,
                            recordId,
                            relatedRecordId,
                            linkFieldName: relationshipLinkField,
                            response: (response ?? null),
                        },
                        pairedItem: { item: i },
                    });
                    continue;
                }
                if (operation === 'linkDocument') {
                    if (!entity) {
                        throw new n8n_workflow_1.NodeOperationError(this.getNode(), 'Entidade é obrigatória.', { itemIndex: i });
                    }
                    const recordId = this.getNodeParameter('recordIdLinkDocument', i);
                    const documentLinkField = this.getNodeParameter('documentLinkField', i);
                    const documentId = this.getNodeParameter('documentId', i);
                    const response = await espoRequest.call(this, 'POST', `${entity}/${recordId}/${documentLinkField}`, {
                        headers: requestHeaders,
                        body: { id: documentId },
                        itemIndex: i,
                    });
                    if (isRecord(response)) {
                        returnData.push({ json: response, pairedItem: { item: i } });
                        continue;
                    }
                    returnData.push({
                        json: {
                            linked: true,
                            entity,
                            recordId,
                            documentId,
                            linkFieldName: documentLinkField,
                            response: (response ?? null),
                        },
                        pairedItem: { item: i },
                    });
                    continue;
                }
                if (operation === 'unlinkDocument') {
                    if (!entity) {
                        throw new n8n_workflow_1.NodeOperationError(this.getNode(), 'Entidade é obrigatória.', { itemIndex: i });
                    }
                    const recordId = this.getNodeParameter('recordIdLinkDocument', i);
                    const documentLinkField = this.getNodeParameter('documentLinkField', i);
                    const documentId = this.getNodeParameter('documentId', i);
                    const response = await espoRequest.call(this, 'DELETE', `${entity}/${recordId}/${documentLinkField}`, {
                        headers: requestHeaders,
                        body: { id: documentId },
                        itemIndex: i,
                    });
                    if (isRecord(response)) {
                        returnData.push({ json: response, pairedItem: { item: i } });
                        continue;
                    }
                    returnData.push({
                        json: {
                            unlinked: true,
                            entity,
                            recordId,
                            documentId,
                            linkFieldName: documentLinkField,
                            response: (response ?? null),
                        },
                        pairedItem: { item: i },
                    });
                    continue;
                }
                if (operation === 'delete') {
                    const recordId = this.getNodeParameter('recordIdDelete', i);
                    const response = await espoRequest.call(this, 'DELETE', `${entity}/${recordId}`, {
                        headers: requestHeaders,
                        itemIndex: i,
                    });
                    returnData.push({ json: response, pairedItem: { item: i } });
                    continue;
                }
                throw new n8n_workflow_1.NodeOperationError(this.getNode(), `Ação inválida: ${operation}`, {
                    itemIndex: i,
                });
            }
            catch (error) {
                if (onError === 'stopWorkflow') {
                    throw error;
                }
                const apiError = error instanceof n8n_workflow_1.NodeApiError
                    ? error
                    : new n8n_workflow_1.NodeApiError(this.getNode(), error, { itemIndex: i });
                if (onError === 'continueErrorOutput') {
                    const httpCodeNumber = extractHttpStatusCode(apiError) ??
                        (typeof apiError.httpCode === 'string' && apiError.httpCode.trim()
                            ? Number(apiError.httpCode)
                            : undefined);
                    const errorResponse = isRecord(apiError.errorResponse)
                        ? apiError.errorResponse
                        : {};
                    const body = Object.prototype.hasOwnProperty.call(errorResponse, 'body') ? errorResponse.body : null;
                    const code = typeof httpCodeNumber === 'number' && Number.isFinite(httpCodeNumber) ? httpCodeNumber : null;
                    const marker = body === undefined || body === null
                        ? code === null
                            ? 'Erro na API do EspoCRM'
                            : `HTTP ${code}`
                        : typeof body === 'string'
                            ? body
                            : JSON.stringify(body);
                    returnData.push({
                        json: {
                            error: {
                                message: marker,
                                statusCode: code,
                                body: body ?? null,
                            },
                        },
                        pairedItem: { item: i },
                    });
                    continue;
                }
                if (onError === 'continueRegularOutput') {
                    continue;
                }
            }
        }
        return [returnData];
    }
}
exports.EspoCrm = EspoCrm;
