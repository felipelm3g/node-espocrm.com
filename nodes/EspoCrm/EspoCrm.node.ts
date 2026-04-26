import type {
	IDataObject,
	IExecuteFunctions,
	ILoadOptionsFunctions,
	INodeExecutionData,
	INodeType,
	INodeTypeDescription,
	INodePropertyOptions,
	IRequestOptions,
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

async function espoRequest(
	this: IExecuteFunctions | ILoadOptionsFunctions,
	method: 'GET' | 'POST' | 'PUT' | 'DELETE',
	endpoint: string,
	options: {
		qs?: IDataObject;
		body?: IDataObject;
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

	const requestOptions: IRequestOptions = {
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
		return await this.helpers.request(requestOptions);
	} catch (error) {
		let debugUrl = baseRequestUrl;
		let debugUrlReadable = baseRequestUrl;
		if (requestOptions.qs && isRecord(requestOptions.qs)) {
			const qsString = buildBracketQueryString(requestOptions.qs);
			const qsReadable = buildBracketQueryStringReadable(requestOptions.qs);
			if (qsString) debugUrl = `${baseRequestUrl}${baseRequestUrl.includes('?') ? '&' : '?'}${qsString}`;
			if (qsReadable)
				debugUrlReadable = `${baseRequestUrl}${baseRequestUrl.includes('?') ? '&' : '?'}${qsReadable}`;
		}

		const errorResponse = (isRecord(error) ? (error as unknown as JsonObject) : ({} as JsonObject)) as JsonObject;
		throw new NodeApiError(this.getNode(), errorResponse, {
			message: 'Falha ao chamar a API do EspoCRM.',
			description: `Request: ${method} ${debugUrl}\nReadable: ${method} ${debugUrlReadable}`,
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

function buildWhereFromBuilder(node: IExecuteFunctions, itemIndex: number): IDataObject[] {
	const fixed = node.getNodeParameter('filters', itemIndex, {}) as IDataObject;
	const conditions = (fixed?.condition ?? []) as IDataObject[];

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

	const needsAttribute = (type: string) => type !== 'expression';

	const toStringValue = (value: unknown) => (value === undefined || value === null ? '' : String(value));

	const buildSimple = (data: IDataObject): IDataObject => {
		const type = toStringValue(data.type).trim();
		if (!type) throw new NodeOperationError(node.getNode(), 'Tipo da condição é obrigatório.', { itemIndex });

		if (type === 'expression') {
			const expression = toStringValue(data.expression).trim();
			if (!expression) {
				throw new NodeOperationError(node.getNode(), 'Expression é obrigatório quando o tipo é expression.', {
					itemIndex,
				});
			}
			return { type, value: expression };
		}

		if (needsAttribute(type)) {
			const attribute = toStringValue(data.attribute).trim();
			if (!attribute) {
				throw new NodeOperationError(node.getNode(), 'Campo (attribute) é obrigatório.', { itemIndex });
			}

			if (linkOnlyTypes.has(type) && attribute.endsWith('Id')) {
				throw new NodeOperationError(
					node.getNode(),
					'Para este tipo, use o nome do relacionamento (ex.: assignedUser) e não o campo ...Id.',
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

	for (const condition of conditions) {
		const mode = toStringValue(condition.mode).trim() || 'simple';

		if (mode === 'simple') {
			result.push(buildSimple(condition));
			continue;
		}

		if (mode === 'group') {
			const groupType = toStringValue(condition.groupType).trim();
			if (!groupType) {
				throw new NodeOperationError(node.getNode(), 'Tipo do grupo é obrigatório.', { itemIndex });
			}
			if (!['and', 'or', 'not'].includes(groupType)) {
				throw new NodeOperationError(node.getNode(), `Tipo do grupo inválido: ${groupType}`, { itemIndex });
			}

			const groupFixed = (condition.groupConditions ?? {}) as IDataObject;
			const groupConditions = (groupFixed?.condition ?? []) as IDataObject[];
			if (groupConditions.length === 0) {
				throw new NodeOperationError(node.getNode(), 'Grupo precisa ter pelo menos uma condição.', {
					itemIndex,
				});
			}

			const value = groupConditions.map(buildSimple);
			result.push({ type: groupType, value });
			continue;
		}

		throw new NodeOperationError(node.getNode(), `Modo de condição inválido: ${mode}`, { itemIndex });
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
				displayName: 'Máximo por Página (0 = padrão)',
				name: 'maxSize',
				type: 'number',
				typeOptions: {
					minValue: 0,
					maxValue: 200,
				},
				displayOptions: {
					show: {
						operationGroup: ['read'],
						readOperation: ['getAll', 'getByFields'],
					},
				},
				default: 0,
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
											'linkedWith',
											'notLinkedWith',
											'isLinked',
											'isNotLinked',
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
															'linkedWith',
															'notLinkedWith',
															'isLinked',
															'isNotLinked',
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
					if (scopeDef.object !== true) continue;
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
						const label = fieldLabels?.[fieldName] ?? fieldName;
						if (!values.has(fieldName)) {
							options.push({ name: label, value: fieldName });
							values.add(fieldName);
						}

						const fieldType = isRecord(fieldDef) ? fieldDef.type : undefined;
						if (fieldType === 'link') {
							const idAttribute = `${fieldName}Id`;
							if (!values.has(idAttribute)) {
								options.push({ name: `${label} (ID)`, value: idAttribute });
								values.add(idAttribute);
							}
						}
					}
				}

				options.sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
				return options;
			},
		},
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const items = this.getInputData();
		const returnData: INodeExecutionData[] = [];

		for (let i = 0; i < items.length; i++) {
			const operationGroup = this.getNodeParameter('operationGroup', i) as string;
			const entity = this.getNodeParameter('entity', i) as string;

			if (!entity) {
				throw new NodeOperationError(this.getNode(), 'Entidade é obrigatória.', { itemIndex: i });
			}

			if (operationGroup === 'read') {
				const readOperation = this.getNodeParameter('readOperation', i) as string;

				if (readOperation === 'getAll') {
					const maxSize = this.getNodeParameter('maxSize', i) as number;
					let offset = 0;

					while (true) {
						const response = await espoRequest.call(this, 'GET', entity, {
							qs: {
								...(maxSize > 0 ? { maxSize } : {}),
								...(offset > 0 ? { offset } : {}),
							},
						});

						if (!isRecord(response) || !Array.isArray(response.list)) {
							throw new NodeOperationError(this.getNode(), 'Resposta inesperada ao ler tudo.', {
								itemIndex: i,
							});
						}

						for (const record of response.list) {
							if (isRecord(record)) {
								returnData.push({ json: record as IDataObject });
								continue;
							}
							throw new NodeOperationError(
								this.getNode(),
								'Resposta inesperada na lista de registros.',
								{
									itemIndex: i,
								},
							);
						}

						const total = typeof response.total === 'number' ? response.total : undefined;
						offset += response.list.length;

						if (response.list.length === 0) break;
						if (total !== undefined && offset >= total) break;
						if (maxSize > 0 && response.list.length < maxSize) break;
					}
					continue;
				}

				if (readOperation === 'getById') {
					const recordId = this.getNodeParameter('recordId', i) as string;
					const response = await espoRequest.call(this, 'GET', `${entity}/${recordId}`);
					if (!isRecord(response)) {
						throw new NodeOperationError(this.getNode(), 'Resposta inesperada ao obter registro por ID.', {
							itemIndex: i,
						});
					}
					returnData.push({ json: response as IDataObject });
					continue;
				}

				if (readOperation === 'getByFields') {
					const maxSize = this.getNodeParameter('maxSize', i) as number;
					const filterMode = this.getNodeParameter('filterMode', i, 'builder') as string;

					let where: unknown[] = [];
					if (filterMode === 'builder') {
						const built = buildWhereFromBuilder(this, i);
						if (built.length > 0) where = built as unknown[];
					}

					if (filterMode === 'json' || where.length === 0) {
						const whereJson = this.getNodeParameter('whereJson', i, '[]') as unknown;
						const parsed = parseJsonInput(whereJson, []);
						if (!Array.isArray(parsed)) {
							throw new NodeOperationError(
								this.getNode(),
								'O campo Where (JSON) precisa ser um array (ex.: []).',
								{ itemIndex: i },
							);
						}
						if (parsed.length > 0) where = parsed;
					}

					let offset = 0;
					while (true) {
						const qsObject: Record<string, unknown> = {
							where,
						};
						if (maxSize > 0) qsObject.maxSize = maxSize;
						if (offset > 0) qsObject.offset = offset;

						const qs = buildBracketQueryString(qsObject);
						const response = await espoRequest.call(this, 'GET', `${entity}?${qs}`);

						if (!isRecord(response) || !Array.isArray(response.list)) {
							throw new NodeOperationError(
								this.getNode(),
								'Resposta inesperada ao ler por campo(s).',
								{ itemIndex: i },
							);
						}

						for (const record of response.list) {
							if (!isRecord(record)) {
								throw new NodeOperationError(
									this.getNode(),
									'Resposta inesperada na lista de registros.',
									{ itemIndex: i },
								);
							}
							returnData.push({ json: record as IDataObject });
						}

						const total = typeof response.total === 'number' ? response.total : undefined;
						offset += response.list.length;

						if (response.list.length === 0) break;
						if (total !== undefined && offset >= total) break;
						if (maxSize > 0 && response.list.length < maxSize) break;
					}

					continue;
				}

				throw new NodeOperationError(this.getNode(), `Ação de leitura inválida: ${readOperation}`, {
					itemIndex: i,
				});
			}

			if (operationGroup === 'create') {
				const payload = getFieldAssignments(this, i, 'createFields');
				const response = await espoRequest.call(this, 'POST', entity, { body: payload });
				if (!isRecord(response)) {
					throw new NodeOperationError(this.getNode(), 'Resposta inesperada ao criar registro.', {
						itemIndex: i,
					});
				}
				returnData.push({ json: response as IDataObject });
				continue;
			}

			if (operationGroup === 'update') {
				const recordId = this.getNodeParameter('recordIdUpdate', i) as string;
				const payload = getFieldAssignments(this, i, 'updateFields');
				const response = await espoRequest.call(this, 'PUT', `${entity}/${recordId}`, { body: payload });
				if (!isRecord(response)) {
					throw new NodeOperationError(this.getNode(), 'Resposta inesperada ao editar registro.', {
						itemIndex: i,
					});
				}
				returnData.push({ json: response as IDataObject });
				continue;
			}

			if (operationGroup === 'delete') {
				const recordId = this.getNodeParameter('recordIdDelete', i) as string;
				const response = await espoRequest.call(this, 'DELETE', `${entity}/${recordId}`);
				returnData.push({ json: { success: response === true } });
				continue;
			}

			throw new NodeOperationError(this.getNode(), `Operação inválida: ${operationGroup}`, {
				itemIndex: i,
			});
		}

		return [returnData];
	}
}
