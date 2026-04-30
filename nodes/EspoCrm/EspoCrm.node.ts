import type {
	IDataObject,
	IExecuteFunctions,
	ILoadOptionsFunctions,
	INodeExecutionData,
	INodeType,
	INodeTypeDescription,
	INodePropertyOptions,
	IHttpRequestOptions,
	JsonObject,
} from 'n8n-workflow';
import { NodeApiError, NodeOperationError } from 'n8n-workflow';

type EspoCredentials = {
	baseUrl: string;
	apiKey: string;
};

function normalizeBaseUrl(input: string): string {
	const trimmed = input.trim();
	const withoutTrailingSlashes = trimmed.replace(/\/+$/, '');
	return withoutTrailingSlashes.replace(/\/api\/v1$/, '');
}

function buildApiUrl(baseUrl: string, endpoint: string): string {
	const normalizedBaseUrl = normalizeBaseUrl(baseUrl);
	const normalizedEndpoint = endpoint.replace(/^\/+/, '');
	return `${normalizedBaseUrl}/api/v1/${normalizedEndpoint}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseJsonInput(value: unknown, fallback: unknown): unknown {
	if (value === undefined || value === null || value === '') return fallback;
	if (typeof value === 'string') {
		try {
			return JSON.parse(value);
		} catch {
			return fallback;
		}
	}
	return value;
}

function buildBracketQueryString(value: unknown, prefix?: string): string {
	const pairs: string[] = [];

	const addPair = (key: string, val: unknown) => {
		if (val === undefined) return;
		if (val === null) {
			pairs.push(`${encodeURIComponent(key)}=`);
			return;
		}
		pairs.push(`${encodeURIComponent(key)}=${encodeURIComponent(String(val))}`);
	};

	const walk = (val: unknown, key?: string) => {
		if (!key) return;

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

function buildBracketQueryStringReadable(value: unknown): string {
	const pairs: string[] = [];

	const addPair = (key: string, val: unknown) => {
		if (val === undefined) return;
		if (val === null) {
			pairs.push(`${key}=`);
			return;
		}
		pairs.push(`${key}=${encodeURIComponent(String(val))}`);
	};

	const walk = (val: unknown, key?: string) => {
		if (!key) return;

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

function decodeBracketEncoding(input: string): string {
	return input.replace(/%5B/gi, '[').replace(/%5D/gi, ']');
}

function tryParseJsonString(value: unknown): unknown {
	if (typeof value !== 'string') return value;
	try {
		return JSON.parse(value);
	} catch {
		return value;
	}
}

function extractEspoErrorMessage(error: unknown): string | undefined {
	if (!isRecord(error)) return undefined;

	const rawBody =
		(isRecord(error.response) ? (error.response as Record<string, unknown>).body : undefined) ??
		(error.error as unknown);

	const body = tryParseJsonString(rawBody);
	if (isRecord(body)) {
		const message = body.message;
		if (typeof message === 'string' && message.trim()) return message.trim();

		const errorValue = body.error;
		if (typeof errorValue === 'string' && errorValue.trim()) return errorValue.trim();

		const reason = body.reason;
		if (typeof reason === 'string' && reason.trim()) return reason.trim();
	}

	const message = (error.message as unknown);
	if (typeof message === 'string' && message.trim()) return message.trim();
	return undefined;
}

function extractHttpStatusCode(error: unknown): number | undefined {
	if (!isRecord(error)) return undefined;
	const response = isRecord(error.response) ? (error.response as Record<string, unknown>) : undefined;
	const value = (error.statusCode ??
		error.status ??
		error.httpCode ??
		response?.statusCode ??
		response?.status ??
		(error as unknown as { response?: { status?: number } }).response?.status) as unknown;
	if (typeof value === 'number' && Number.isFinite(value)) return value;
	if (typeof value === 'string' && value.trim() && !Number.isNaN(Number(value))) return Number(value);
	return undefined;
}

async function espoRequest(
	this: IExecuteFunctions | ILoadOptionsFunctions,
	method: 'GET' | 'POST' | 'PUT' | 'DELETE',
	endpoint: string,
	options: {
		qs?: IDataObject;
		body?: IDataObject;
		itemIndex?: number;
	} = {},
): Promise<unknown> {
	const credentials = (await this.getCredentials('espoCrmApi')) as unknown as EspoCredentials;

	if (!credentials?.baseUrl) {
		throw new NodeOperationError(this.getNode(), 'Base URL não configurada nas credenciais.');
	}

	if (!credentials?.apiKey) {
		throw new NodeOperationError(this.getNode(), 'API Key não configurada nas credenciais.');
	}

	const baseRequestUrl = buildApiUrl(credentials.baseUrl, endpoint);

	const requestOptions: IHttpRequestOptions = {
		method,
		url: baseRequestUrl,
		json: true,
		headers: {
			Accept: 'application/json',
			'X-Api-Key': credentials.apiKey,
		},
	};

	if (options.qs) requestOptions.qs = options.qs;
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
		})) as unknown;

		const statusCode = extractHttpStatusCode(response);
		const responseBody = isRecord(response)
			? Object.prototype.hasOwnProperty.call(response, 'body')
				? (response as Record<string, unknown>).body
				: Object.prototype.hasOwnProperty.call(response, 'data')
					? (response as Record<string, unknown>).data
					: response
			: response;

		if (typeof statusCode === 'number' && (statusCode < 200 || statusCode >= 300)) {
			let debugUrl = baseRequestUrl;
			let debugUrlReadable = baseRequestUrl;
			if (requestOptions.qs && isRecord(requestOptions.qs)) {
				const qsString = buildBracketQueryString(requestOptions.qs);
				const qsReadable = buildBracketQueryStringReadable(requestOptions.qs);
				if (qsString) debugUrl = `${baseRequestUrl}${baseRequestUrl.includes('?') ? '&' : '?'}${qsString}`;
				if (qsReadable)
					debugUrlReadable = `${baseRequestUrl}${baseRequestUrl.includes('?') ? '&' : '?'}${qsReadable}`;
			} else {
				debugUrlReadable = decodeBracketEncoding(baseRequestUrl);
			}

			const debugUrlDisplay = decodeBracketEncoding(debugUrl);
			const debugUrlReadableDisplay = decodeBracketEncoding(debugUrlReadable);

			const description =
				debugUrlReadableDisplay === debugUrlDisplay
					? `Request: ${method} ${debugUrlDisplay}`
					: `Request: ${method} ${debugUrlDisplay}\nReadable: ${method} ${debugUrlReadableDisplay}`;

			const errorResponse: JsonObject = {
				statusCode,
				body: (responseBody ?? null) as unknown as JsonObject,
				request: {
					method,
					url: debugUrlDisplay,
				} as unknown as JsonObject,
			};

			const messageFromBody =
				responseBody === undefined || responseBody === null
					? undefined
					: typeof responseBody === 'string'
						? responseBody
						: JSON.stringify(responseBody);

			throw new NodeApiError(this.getNode(), errorResponse, {
				message: messageFromBody ?? `HTTP ${statusCode}`,
				description,
				httpCode: String(statusCode),
				itemIndex: options.itemIndex,
			});
		}

		return responseBody;
	} catch (error) {
		let debugUrl = baseRequestUrl;
		let debugUrlReadable = baseRequestUrl;
		if (requestOptions.qs && isRecord(requestOptions.qs)) {
			const qsString = buildBracketQueryString(requestOptions.qs);
			const qsReadable = buildBracketQueryStringReadable(requestOptions.qs);
			if (qsString) debugUrl = `${baseRequestUrl}${baseRequestUrl.includes('?') ? '&' : '?'}${qsString}`;
			if (qsReadable)
				debugUrlReadable = `${baseRequestUrl}${baseRequestUrl.includes('?') ? '&' : '?'}${qsReadable}`;
		} else {
			debugUrlReadable = decodeBracketEncoding(baseRequestUrl);
		}

		const debugUrlDisplay = decodeBracketEncoding(debugUrl);
		const debugUrlReadableDisplay = decodeBracketEncoding(debugUrlReadable);

		const description =
			debugUrlReadableDisplay === debugUrlDisplay
				? `Request: ${method} ${debugUrlDisplay}`
				: `Request: ${method} ${debugUrlDisplay}\nReadable: ${method} ${debugUrlReadableDisplay}`;

		const statusCode = extractHttpStatusCode(error);
		const responseBodyRaw = isRecord(error)
			? ((error as unknown as { response?: { body?: unknown; data?: unknown } }).response?.body ??
				(error as unknown as { response?: { body?: unknown; data?: unknown } }).response?.data ??
				(error as Record<string, unknown>).body ??
				(error as Record<string, unknown>).error)
			: undefined;
		const responseBody =
			typeof responseBodyRaw === 'string' ? tryParseJsonString(responseBodyRaw) : responseBodyRaw;

		const errorResponse: JsonObject = {
			statusCode: statusCode ?? null,
			body: (responseBody ?? null) as unknown as JsonObject,
			request: {
				method,
				url: debugUrlDisplay,
			} as unknown as JsonObject,
		};

		const messageFromBody =
			responseBody === undefined || responseBody === null
				? undefined
				: typeof responseBody === 'string'
					? responseBody
					: JSON.stringify(responseBody);

		const apiMessage = extractEspoErrorMessage(error);
		throw new NodeApiError(this.getNode(), errorResponse, {
			message: messageFromBody ?? apiMessage ?? 'Falha ao chamar a API do EspoCRM.',
			description,
			httpCode: statusCode === undefined ? undefined : String(statusCode),
			itemIndex: options.itemIndex,
		});
	}
}

function getFieldAssignments(
	node: IExecuteFunctions,
	itemIndex: number,
	parameterName: string,
): IDataObject {
	const fixed = node.getNodeParameter(parameterName, itemIndex, {}) as IDataObject;
	const entries = (fixed?.field ?? []) as Array<{ name?: string; value?: unknown }>;

	const payload: Record<string, unknown> = {};
	for (const entry of entries) {
		if (!entry?.name) continue;
		payload[entry.name] = entry.value;
	}
	return payload as IDataObject;
}

function getJsonObjectParameter(node: IExecuteFunctions, itemIndex: number, parameterName: string): IDataObject {
	const raw = node.getNodeParameter(parameterName, itemIndex, {}) as unknown;
	const parsed = parseJsonInput(raw, {});
	if (!isRecord(parsed)) {
		throw new NodeOperationError(node.getNode(), 'Corpo (JSON) deve ser um objeto JSON.', { itemIndex });
	}
	return parsed as IDataObject;
}

function buildWhereFromBuilder(node: IExecuteFunctions, itemIndex: number): IDataObject[] {
	const fixed = node.getNodeParameter('filters', itemIndex, {}) as IDataObject;
	const conditions = (fixed?.condition ?? []) as IDataObject[];

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

	const needsAttribute = (type: string) => type !== 'expression';

	const toStringValue = (value: unknown) => (value === undefined || value === null ? '' : String(value));

	const buildSimple = (data: IDataObject): IDataObject => {
		const type = toStringValue(data.type).trim();
		if (!type) throw new NodeOperationError(node.getNode(), 'Tipo da condição é obrigatório.', { itemIndex });
		if (!allowedTypes.has(type)) {
			throw new NodeOperationError(node.getNode(), `Tipo de condição inválido: ${type}`, { itemIndex });
		}

		if (type === 'expression') {
			const expression = toStringValue(data.expression).trim();
			if (!expression) {
				throw new NodeOperationError(node.getNode(), 'Expressão é obrigatória quando o tipo é expression.', {
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
				throw new NodeOperationError(
					node.getNode(),
					linkOnlyTypes.has(type) ? 'Relacionamento (attribute) é obrigatório.' : 'Campo (attribute) é obrigatório.',
					{ itemIndex },
				);
			}

			if (noValueTypes.has(type)) {
				return { type, attribute };
			}

			if (rangeTypes.has(type)) {
				const from = toStringValue(data.valueFrom).trim();
				const to = toStringValue(data.valueTo).trim();
				if (!from || !to) {
					throw new NodeOperationError(node.getNode(), 'Between precisa de Valor (De) e Valor (Até).', {
						itemIndex,
					});
				}
				return { type, attribute, value: [from, to] };
			}

			if (multiValueTypes.has(type)) {
				const valuesFixed = (data.values ?? {}) as IDataObject;
				const valuesEntries = (valuesFixed?.value ?? []) as Array<{ value?: unknown }>;
				const values = valuesEntries
					.map((v) => toStringValue(v.value).trim())
					.filter((v) => v.length > 0);

				if (values.length === 0) {
					throw new NodeOperationError(node.getNode(), 'Lista de valores é obrigatória para este tipo.', {
						itemIndex,
					});
				}
				return { type, attribute, value: values };
			}

			const value = toStringValue(data.value).trim();
			if (!value) {
				throw new NodeOperationError(node.getNode(), 'Valor é obrigatório para este tipo.', { itemIndex });
			}
			return { type, attribute, value };
		}

		throw new NodeOperationError(node.getNode(), `Tipo de condição inválido: ${type}`, { itemIndex });
	};

	const result: IDataObject[] = [];
	const usedAttributes = new Set<string>();
	const duplicateAttributes = new Set<string>();

	for (const condition of conditions) {
		const built = buildSimple(condition);
		result.push(built);
		const attribute = typeof built.attribute === 'string' ? built.attribute.trim() : '';
		if (attribute) {
			if (usedAttributes.has(attribute)) duplicateAttributes.add(attribute);
			usedAttributes.add(attribute);
		}
	}

	if (duplicateAttributes.size > 0) {
		const list = Array.from(duplicateAttributes).sort((a, b) => a.localeCompare(b, 'pt-BR'));
		throw new NodeOperationError(
			node.getNode(),
			`Campo repetido nas condições: ${list.join(', ')}. Use apenas uma condição por campo (ex.: "in", "between" ou "expression").`,
			{ itemIndex },
		);
	}

	return result;
}

export class EspoCrm implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'EspoCRM',
		name: 'espoCrm',
		icon: 'file:../../logo.png',
		group: ['transform'],
		version: 1,
		subtitle:
			'={{$parameter["operation"] === "listEntities" ? ($parameter["operation"] || "") : (($parameter["operation"] || $parameter["action"] || $parameter["operationGroup"] || "") + ": " + $parameter["entity"])}}',
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
					{ name: 'Vincular documento', value: 'linkDocument', action: 'Vincular documento' },
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
						operation: ['linkDocument'],
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
				},
				noDataExpression: true,
				displayOptions: {
					show: {
						operation: ['linkDocument'],
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
						operation: ['linkDocument'],
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
								displayName: 'Expressão',
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
			{
				displayName: 'Opções',
				name: 'options',
				type: 'collection',
				placeholder: 'Adicionar opção',
				displayOptions: {
					show: {
						operation: ['getAll', 'getByFields'],
					},
				},
				default: {},
				options: [
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
			async getEntityOptions(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
				const metadata = await espoRequest.call(this, 'GET', 'Metadata/scopes');
				const i18n = await espoRequest.call(this, 'GET', 'I18n');

				const scopesContainer = isRecord(metadata) ? metadata.scopes : undefined;
				const scopes = isRecord(scopesContainer) ? scopesContainer : {};

				const globalContainer = isRecord(i18n) ? i18n.Global : undefined;
				const scopeNamesContainer =
					isRecord(globalContainer) && isRecord(globalContainer.scopeNames)
						? globalContainer.scopeNames
						: {};

				const scopeNames: Record<string, string> = {};
				for (const [key, value] of Object.entries(scopeNamesContainer)) {
					if (typeof value === 'string') scopeNames[key] = value;
				}

				const options: INodePropertyOptions[] = [];

				for (const [scopeName, scopeDef] of Object.entries(scopes)) {
					if (!isRecord(scopeDef)) continue;
					if (scopeDef.entity !== true) continue;
					if (scopeDef.disabled === true) continue;

					const label = scopeNames?.[scopeName] ?? scopeName;
					options.push({
						name: label,
						value: scopeName,
					});
				}

				options.sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
				return options;
			},

			async getEntityFieldOptions(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
				const entity = this.getCurrentNodeParameter('entity') as string;
				if (!entity) return [];

				const key = encodeURIComponent(`entityDefs.${entity}.fields`);
				const [fieldsDefs, i18n] = await Promise.all([
					espoRequest.call(this, 'GET', `Metadata?key=${key}`),
					espoRequest.call(this, 'GET', 'I18n'),
				]);

				const entityI18nContainer = isRecord(i18n) ? i18n[entity] : undefined;
				const fieldsLabelsContainer =
					isRecord(entityI18nContainer) && isRecord(entityI18nContainer.fields)
						? entityI18nContainer.fields
						: {};

				const fieldLabels: Record<string, string> = {};
				for (const [key, value] of Object.entries(fieldsLabelsContainer)) {
					if (typeof value === 'string') fieldLabels[key] = value;
				}
				const options: INodePropertyOptions[] = [];
				const values = new Set<string>();

				if (isRecord(fieldsDefs)) {
					for (const [fieldName, fieldDef] of Object.entries(fieldsDefs)) {
						if (fieldName === 'id') continue;
						const labelRaw = fieldLabels?.[fieldName] ?? fieldName;
						const fieldType = isRecord(fieldDef) ? fieldDef.type : undefined;
						const isLinkField =
							fieldType === 'link' || fieldType === 'linkParent' || fieldType === 'linkMultiple';

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
								const nameLabel =
									labelRaw === fieldName
										? `${nameAttribute}`
										: `${labelRaw} (Nome) (${nameAttribute})`;
								options.push({ name: nameLabel, value: nameAttribute });
								values.add(nameAttribute);
							}
						}
						if (fieldType === 'linkParent') {
							const typeAttribute = `${fieldName}Type`;
							if (!values.has(typeAttribute)) {
								const typeLabel =
									labelRaw === fieldName
										? `${typeAttribute}`
										: `${labelRaw} (Tipo) (${typeAttribute})`;
								options.push({ name: typeLabel, value: typeAttribute });
								values.add(typeAttribute);
							}
						}
						if (fieldType === 'linkMultiple') {
							const idsAttribute = `${fieldName}Ids`;
							if (!values.has(idsAttribute)) {
								const idsLabel =
									labelRaw === fieldName
										? `${idsAttribute}`
										: `${labelRaw} (IDs) (${idsAttribute})`;
								options.push({ name: idsLabel, value: idsAttribute });
								values.add(idsAttribute);
							}
							const namesAttribute = `${fieldName}Names`;
							if (!values.has(namesAttribute)) {
								const namesLabel =
									labelRaw === fieldName
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

			async getEntityLinkFieldOptions(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
				const entity = this.getCurrentNodeParameter('entity') as string;
				if (!entity) return [];

				const key = encodeURIComponent(`entityDefs.${entity}.fields`);
				const [fieldsDefs, i18n] = await Promise.all([
					espoRequest.call(this, 'GET', `Metadata?key=${key}`),
					espoRequest.call(this, 'GET', 'I18n'),
				]);

				const entityI18nContainer = isRecord(i18n) ? i18n[entity] : undefined;
				const fieldsLabelsContainer =
					isRecord(entityI18nContainer) && isRecord(entityI18nContainer.fields)
						? entityI18nContainer.fields
						: {};

				const fieldLabels: Record<string, string> = {};
				for (const [k, v] of Object.entries(fieldsLabelsContainer)) {
					if (typeof v === 'string') fieldLabels[k] = v;
				}

				const options: INodePropertyOptions[] = [];
				const values = new Set<string>();

				if (isRecord(fieldsDefs)) {
					for (const [fieldName, fieldDef] of Object.entries(fieldsDefs)) {
						if (fieldName === 'id') continue;
						const fieldType = isRecord(fieldDef) ? fieldDef.type : undefined;
						if (fieldType !== 'link' && fieldType !== 'linkParent' && fieldType !== 'linkMultiple') continue;

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

			async getEntityDocumentLinkOptions(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
				const entity = this.getCurrentNodeParameter('entity') as string;
				if (!entity) return [];

				const key = encodeURIComponent(`entityDefs.${entity}.links`);
				const [linksDefs, i18n] = await Promise.all([
					espoRequest.call(this, 'GET', `Metadata?key=${key}`),
					espoRequest.call(this, 'GET', 'I18n'),
				]);

				const entityI18nContainer = isRecord(i18n) ? i18n[entity] : undefined;
				const linksLabelsContainer =
					isRecord(entityI18nContainer) && isRecord(entityI18nContainer.links) ? entityI18nContainer.links : {};

				const linkLabels: Record<string, string> = {};
				for (const [k, v] of Object.entries(linksLabelsContainer)) {
					if (typeof v === 'string') linkLabels[k] = v;
				}

				const options: INodePropertyOptions[] = [];
				const values = new Set<string>();

				if (isRecord(linksDefs)) {
					for (const [linkName, linkDef] of Object.entries(linksDefs)) {
						if (!isRecord(linkDef)) continue;
						if (linkDef.entity !== 'Document') continue;

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

			async getEntityPrimaryFilterOptions(
				this: ILoadOptionsFunctions,
			): Promise<INodePropertyOptions[]> {
				const entity = this.getCurrentNodeParameter('entity') as string;
				if (!entity) return [];

				const key = encodeURIComponent(`clientDefs.${entity}.filterList`);
				const filterList = await espoRequest.call(this, 'GET', `Metadata?key=${key}`);

				const options: INodePropertyOptions[] = [];
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

			async getEntityBoolFilterOptions(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
				const entity = this.getCurrentNodeParameter('entity') as string;
				if (!entity) return [];

				const key = encodeURIComponent(`clientDefs.${entity}.boolFilterList`);
				const boolFilterList = await espoRequest.call(this, 'GET', `Metadata?key=${key}`);

				const values = new Set<string>();
				const options: INodePropertyOptions[] = [];

				const add = (name: string) => {
					if (!name || values.has(name)) return;
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

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const inputItems = this.getInputData();
		const items = inputItems.length > 0 ? inputItems : [{ json: {} }];
		const returnData: INodeExecutionData[] = [];
		const onError = (this.getNode().onError ?? 'stopWorkflow') as
			| 'stopWorkflow'
			| 'continueRegularOutput'
			| 'continueErrorOutput';
		const nodeParameters = this.getNode().parameters as IDataObject;
		const hasOperationParameter = Object.prototype.hasOwnProperty.call(nodeParameters, 'operation');

		for (let i = 0; i < items.length; i++) {
			try {
				let operation = hasOperationParameter ? (this.getNodeParameter('operation', i) as string) : '';
				if (!operation) {
					const legacyAction = this.getNodeParameter('action', i, '') as string;
					if (legacyAction.startsWith('read.')) {
						operation = legacyAction.slice('read.'.length);
					} else if (legacyAction) {
						operation = legacyAction;
					}
				}

				if (!operation) {
					const legacyOperationGroup = this.getNodeParameter('operationGroup', i, '') as string;
					if (legacyOperationGroup === 'read') {
						const legacyReadOperation = this.getNodeParameter('readOperation', i, 'getAll') as string;
						operation = legacyReadOperation;
					} else if (legacyOperationGroup) {
						operation = legacyOperationGroup;
					}
				}

				if (operation === 'listEntities') {
					const metadata = await espoRequest.call(this, 'GET', 'Metadata/scopes', { itemIndex: i });
					const i18n = await espoRequest.call(this, 'GET', 'I18n', { itemIndex: i });

					const scopesContainer = isRecord(metadata) ? metadata.scopes : undefined;
					const scopes = isRecord(scopesContainer) ? scopesContainer : {};

					const globalContainer = isRecord(i18n) ? i18n.Global : undefined;
					const scopeNamesContainer =
						isRecord(globalContainer) && isRecord(globalContainer.scopeNames)
							? globalContainer.scopeNames
							: {};

					const scopeNames: Record<string, string> = {};
					for (const [key, value] of Object.entries(scopeNamesContainer)) {
						if (typeof value === 'string') scopeNames[key] = value;
					}

					const list: Array<{ entity: string; label: string }> = [];
					for (const [scopeName, scopeDef] of Object.entries(scopes)) {
						if (!isRecord(scopeDef)) continue;
						if (scopeDef.entity !== true) continue;
						if (scopeDef.disabled === true) continue;

						const label = scopeNames?.[scopeName] ?? scopeName;
						list.push({ entity: scopeName, label });
					}
					list.sort((a, b) => a.label.localeCompare(b.label, 'pt-BR'));

					returnData.push({ json: { list } as unknown as IDataObject, pairedItem: { item: i } });
					continue;
				}

				const entity = this.getNodeParameter('entity', i, '') as string;

				if (operation === 'getById') {
					if (!entity) {
						throw new NodeOperationError(this.getNode(), 'Entidade é obrigatória.', { itemIndex: i });
					}
					const recordId = this.getNodeParameter('recordId', i) as string;
					const response = await espoRequest.call(this, 'GET', `${entity}/${recordId}`, { itemIndex: i });
					if (!isRecord(response)) {
						throw new NodeOperationError(this.getNode(), 'Resposta inesperada ao obter registro por ID.', {
							itemIndex: i,
						});
					}
					returnData.push({ json: response as IDataObject, pairedItem: { item: i } });
					continue;
				}

				if (operation === 'listEntityFields') {
					if (!entity) {
						throw new NodeOperationError(this.getNode(), 'Entidade é obrigatória.', { itemIndex: i });
					}

					const key = encodeURIComponent(`entityDefs.${entity}.fields`);
					const [fieldsDefs, i18n] = await Promise.all([
						espoRequest.call(this, 'GET', `Metadata?key=${key}`, { itemIndex: i }),
						espoRequest.call(this, 'GET', 'I18n', { itemIndex: i }),
					]);

					const entityI18nContainer = isRecord(i18n) ? i18n[entity] : undefined;
					const fieldsLabelsContainer =
						isRecord(entityI18nContainer) && isRecord(entityI18nContainer.fields)
							? entityI18nContainer.fields
							: {};

					const fieldLabels: Record<string, string> = {};
					for (const [k, v] of Object.entries(fieldsLabelsContainer)) {
						if (typeof v === 'string') fieldLabels[k] = v;
					}

					const fields: Array<{ name: string; label: string; type?: string; definition?: unknown }> = [];
					if (isRecord(fieldsDefs)) {
						for (const [fieldName, fieldDef] of Object.entries(fieldsDefs)) {
							const label = fieldLabels?.[fieldName] ?? fieldName;
							const type =
								isRecord(fieldDef) && typeof fieldDef.type === 'string' ? fieldDef.type : undefined;
							fields.push({ name: fieldName, label, type, definition: fieldDef });
						}
					}
					fields.sort((a, b) => a.label.localeCompare(b.label, 'pt-BR'));

					returnData.push({ json: { entity, fields } as unknown as IDataObject, pairedItem: { item: i } });
					continue;
				}

				if (!entity) {
					throw new NodeOperationError(this.getNode(), 'Entidade é obrigatória.', { itemIndex: i });
				}

				const options = this.getNodeParameter('options', i, {}) as IDataObject;
				const toOptionalNumber = (value: unknown): number | undefined => {
					if (typeof value === 'number' && Number.isFinite(value)) return value;
					if (typeof value === 'string') {
						const trimmed = value.trim();
						if (trimmed === '') return undefined;
						const num = Number(trimmed);
						if (Number.isFinite(num)) return num;
					}
					return undefined;
				};

				const maxSizeRaw = toOptionalNumber(options.maxSize);
				const startOffsetRaw = toOptionalNumber(options.offset);

				const maxSize =
					maxSizeRaw === undefined ? 0 : Math.min(200, Math.max(0, Math.floor(maxSizeRaw)));
				const startOffset = startOffsetRaw === undefined ? 0 : Math.max(0, Math.floor(startOffsetRaw));
				const orderBy = typeof options.orderBy === 'string' ? options.orderBy : '';
				const order = typeof options.order === 'string' ? options.order : 'asc';
				const primaryFilter = typeof options.primaryFilter === 'string' ? options.primaryFilter : '';
				const boolFilterList = Array.isArray(options.boolFilterList)
					? (options.boolFilterList as string[])
					: [];
				const textFilter = typeof options.textFilter === 'string' ? options.textFilter : '';

				if (operation === 'getAll') {
					const qsObject: Record<string, unknown> = {};
					if (maxSize > 0) qsObject.maxSize = maxSize;
					if (startOffset > 0) qsObject.offset = startOffset;
					if (orderBy) qsObject.orderBy = orderBy;
					if (orderBy && order) qsObject.order = order;
					if (primaryFilter) qsObject.primaryFilter = primaryFilter;
					if (textFilter) qsObject.textFilter = textFilter;
					if (Array.isArray(boolFilterList) && boolFilterList.length > 0)
						qsObject.boolFilterList = boolFilterList;

					const qs = buildBracketQueryString(qsObject);
					const response = await espoRequest.call(this, 'GET', qs ? `${entity}?${qs}` : entity, {
						itemIndex: i,
					});

					if (!isRecord(response) || !Array.isArray(response.list)) {
						throw new NodeOperationError(this.getNode(), 'Resposta inesperada ao ler tudo.', {
							itemIndex: i,
						});
					}

					returnData.push({ json: response as IDataObject, pairedItem: { item: i } });
					continue;
				}

				if (operation === 'getByFields') {
					const where = buildWhereFromBuilder(this, i);
					const qsObject: Record<string, unknown> = {};
					if (where.length > 0) qsObject.where = where;
					if (maxSize > 0) qsObject.maxSize = maxSize;
					if (startOffset > 0) qsObject.offset = startOffset;
					if (orderBy) qsObject.orderBy = orderBy;
					if (orderBy && order) qsObject.order = order;
					if (primaryFilter) qsObject.primaryFilter = primaryFilter;
					if (textFilter) qsObject.textFilter = textFilter;
					if (Array.isArray(boolFilterList) && boolFilterList.length > 0)
						qsObject.boolFilterList = boolFilterList;

					const qs = buildBracketQueryString(qsObject);
					const response = await espoRequest.call(this, 'GET', qs ? `${entity}?${qs}` : entity, {
						itemIndex: i,
					});

					if (!isRecord(response) || !Array.isArray(response.list)) {
						throw new NodeOperationError(this.getNode(), 'Resposta inesperada ao ler por campo(s).', {
							itemIndex: i,
						});
					}

					returnData.push({ json: response as IDataObject, pairedItem: { item: i } });
					continue;
				}

				if (operation === 'create') {
					const inputMode = this.getNodeParameter('createInputMode', i, 'fields') as string;
					const payload =
						inputMode === 'json'
							? getJsonObjectParameter(this, i, 'createPayloadJson')
							: getFieldAssignments(this, i, 'createFields');

					if (Object.keys(payload).length === 0) {
						throw new NodeOperationError(this.getNode(), 'Informe ao menos um campo no corpo da requisição.', {
							itemIndex: i,
						});
					}
					const response = await espoRequest.call(this, 'POST', entity, { body: payload, itemIndex: i });
					if (!isRecord(response)) {
						throw new NodeOperationError(this.getNode(), 'Resposta inesperada ao criar registro.', {
							itemIndex: i,
						});
					}
					returnData.push({ json: response as IDataObject, pairedItem: { item: i } });
					continue;
				}

				if (operation === 'update') {
					const recordId = this.getNodeParameter('recordIdUpdate', i) as string;
					const inputMode = this.getNodeParameter('updateInputMode', i, 'fields') as string;
					const payload =
						inputMode === 'json'
							? getJsonObjectParameter(this, i, 'updatePayloadJson')
							: getFieldAssignments(this, i, 'updateFields');

					if (Object.keys(payload).length === 0) {
						throw new NodeOperationError(this.getNode(), 'Informe ao menos um campo no corpo da requisição.', {
							itemIndex: i,
						});
					}
					const response = await espoRequest.call(this, 'PUT', `${entity}/${recordId}`, {
						body: payload,
						itemIndex: i,
					});
					if (!isRecord(response)) {
						throw new NodeOperationError(this.getNode(), 'Resposta inesperada ao editar registro.', {
							itemIndex: i,
						});
					}
					returnData.push({ json: response as IDataObject, pairedItem: { item: i } });
					continue;
				}

				if (operation === 'linkDocument') {
					if (!entity) {
						throw new NodeOperationError(this.getNode(), 'Entidade é obrigatória.', { itemIndex: i });
					}

					const recordId = this.getNodeParameter('recordIdLinkDocument', i) as string;
					const documentLinkField = this.getNodeParameter('documentLinkField', i) as string;
					const documentId = this.getNodeParameter('documentId', i) as string;

					const response = await espoRequest.call(this, 'POST', `${entity}/${recordId}/${documentLinkField}`, {
						body: { id: documentId } as IDataObject,
						itemIndex: i,
					});

					if (isRecord(response)) {
						returnData.push({ json: response as IDataObject, pairedItem: { item: i } });
						continue;
					}

					returnData.push({
						json: {
							linked: true,
							entity,
							recordId,
							documentId,
							linkFieldName: documentLinkField,
							response: (response ?? null) as unknown,
						} as unknown as IDataObject,
						pairedItem: { item: i },
					});
					continue;
				}

				if (operation === 'delete') {
					const recordId = this.getNodeParameter('recordIdDelete', i) as string;
					const response = await espoRequest.call(this, 'DELETE', `${entity}/${recordId}`, { itemIndex: i });
					returnData.push({ json: response as unknown as IDataObject, pairedItem: { item: i } });
					continue;
				}

				throw new NodeOperationError(this.getNode(), `Ação inválida: ${operation}`, {
					itemIndex: i,
				});
			} catch (error) {
				if (onError === 'stopWorkflow') {
					throw error;
				}

				const apiError =
					error instanceof NodeApiError
						? error
						: new NodeApiError(this.getNode(), error as JsonObject, { itemIndex: i });

				if (onError === 'continueErrorOutput') {
					const httpCodeNumber =
						extractHttpStatusCode(apiError) ??
						(typeof apiError.httpCode === 'string' && apiError.httpCode.trim()
							? Number(apiError.httpCode)
							: undefined);
					const errorResponse = isRecord(apiError.errorResponse)
						? (apiError.errorResponse as Record<string, unknown>)
						: {};
					const body = Object.prototype.hasOwnProperty.call(errorResponse, 'body') ? errorResponse.body : null;

					const code = typeof httpCodeNumber === 'number' && Number.isFinite(httpCodeNumber) ? httpCodeNumber : null;
					const marker =
						body === undefined || body === null
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
						} as unknown as IDataObject,
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
