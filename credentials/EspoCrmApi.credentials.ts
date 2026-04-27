import type {
	IAuthenticateGeneric,
	ICredentialTestRequest,
	ICredentialType,
	INodeProperties,
} from 'n8n-workflow';

export class EspoCrmApi implements ICredentialType {
	name = 'espoCrmApi';
	displayName = 'EspoCRM API';
	documentationUrl = 'https://docs.espocrm.com/api/';

	properties: INodeProperties[] = [
		{
			displayName: 'URL Base',
			name: 'baseUrl',
			type: 'string',
			default: 'https://example.com',
			placeholder: 'https://crm.seudominio.com.br',
			description: 'URL base do EspoCRM, sem /api/v1.',
			required: true,
		},
		{
			displayName: 'Chave de API',
			name: 'apiKey',
			type: 'string',
			typeOptions: {
				password: true,
			},
			default: '',
			required: true,
		},
	];

	authenticate: IAuthenticateGeneric = {
		type: 'generic',
		properties: {
			headers: {
				'X-Api-Key': '={{$credentials.apiKey}}',
			},
		},
	};

	test: ICredentialTestRequest = {
		request: {
			method: 'GET',
			baseURL:
				'={{$credentials.baseUrl.trim().replace(/\\/+$/, "").replace(/\\/api\\/v1$/, "")}}/api/v1',
			url: '/Metadata/scopes',
		},
	};
}
