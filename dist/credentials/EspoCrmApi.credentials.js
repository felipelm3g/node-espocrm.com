"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.EspoCrmApi = void 0;
class EspoCrmApi {
    name = 'espoCrmApi';
    displayName = 'EspoCRM API';
    documentationUrl = 'https://docs.espocrm.com/development/api/';
    properties = [
        {
            displayName: 'Base URL',
            name: 'baseUrl',
            type: 'string',
            default: 'https://example.com',
            placeholder: 'https://crm.seudominio.com.br',
            description: 'URL base do EspoCRM, sem /api/v1.',
            required: true,
        },
        {
            displayName: 'API Key',
            name: 'apiKey',
            type: 'string',
            typeOptions: {
                password: true,
            },
            default: '',
            required: true,
        },
    ];
    authenticate = {
        type: 'generic',
        properties: {
            headers: {
                'X-Api-Key': '={{$credentials.apiKey}}',
            },
        },
    };
    test = {
        request: {
            method: 'GET',
            baseURL: '={{$credentials.baseUrl.trim().replace(/\\/+$/, "").replace(/\\/api\\/v1$/, "")}}/api/v1',
            url: '/Metadata/scopes',
        },
    };
}
exports.EspoCrmApi = EspoCrmApi;
