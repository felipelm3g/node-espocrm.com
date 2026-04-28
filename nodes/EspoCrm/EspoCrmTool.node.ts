import type { INodeTypeDescription } from 'n8n-workflow';
import { EspoCrm as EspoCrmBase } from './EspoCrm.node';

const baseDescription = new EspoCrmBase().description;

export class EspoCrmTool extends EspoCrmBase {
	description: INodeTypeDescription = {
		...baseDescription,
		displayName: 'EspoCRM Tool',
		name: 'espoCrmTool',
		defaults: {
			...baseDescription.defaults,
			name: 'EspoCRM Tool',
		},
		inputs: ['main'],
		outputs: ['ai_tool'],
	};
}

