"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.EspoCrmTool = void 0;
const EspoCrm_node_1 = require("./EspoCrm.node");
const baseDescription = new EspoCrm_node_1.EspoCrm().description;
class EspoCrmTool extends EspoCrm_node_1.EspoCrm {
    description = {
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
exports.EspoCrmTool = EspoCrmTool;
