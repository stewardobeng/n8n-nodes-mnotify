import type { IDataObject, IExecuteFunctions, INodeProperties } from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';

import { emitRecords, mnotifyApiRequest, splitRecipients, withoutEmptyValues } from '../GenericFunctions';
import { mnPath } from '../endpoints';

const showOnlyForIvr = { resource: ['ivr'] };

export const ivrDescription: INodeProperties[] = [
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: {
			show: showOnlyForIvr,
		},
		options: [
			{
				name: 'Create Scenario',
				value: 'createScenario',
				action: 'Create an IVR scenario',
				description: 'Add an outbound IVR scenario to the account',
			},
			{
				name: 'Delete Scenario',
				value: 'deleteScenario',
				action: 'Delete an IVR scenario',
				description: 'Remove an outbound IVR scenario',
			},
			{
				name: 'Delete Scenario Flow',
				value: 'deleteFlow',
				action: 'Delete an IVR scenario flow',
				description: 'Remove one step from a scenario',
			},
			{
				name: 'Get Many Scenarios',
				value: 'getScenarios',
				action: 'Get many IVR scenarios',
				description: 'List the outbound IVR scenarios on the account',
			},
			{
				name: 'Get Scenario',
				value: 'getScenario',
				action: 'Get an IVR scenario',
				description: 'Retrieve one outbound IVR scenario by ID',
			},
			{
				name: 'Get Scenario Flow',
				value: 'getFlow',
				action: 'Get an IVR scenario flow',
				description: 'Retrieve one step of a scenario, with its audio and keypad options',
			},
			{
				name: 'Initiate Call',
				value: 'initiateCall',
				action: 'Initiate an IVR call',
				description: 'Ask mNotify to dial a number and start an IVR session',
			},
			{
				name: 'Save Scenario Flow',
				value: 'saveFlow',
				action: 'Save an IVR scenario flow',
				description: 'Add or replace a step of a scenario, including its audio and keypad map',
			},
			{
				name: 'Send Scenario',
				value: 'launchScenario',
				action: 'Send an IVR scenario',
				description: 'Call a list of numbers and play an outbound IVR scenario',
			},
			{
				name: 'Update Scenario',
				value: 'updateScenario',
				action: 'Update an IVR scenario',
				description: 'Change the title, description or enabled state of a scenario',
			},
		],
		default: 'getScenarios',
	},
	{
		displayName: 'Scenario ID',
		name: 'ivrScenarioId',
		type: 'string',
		default: '',
		required: true,
		displayOptions: {
			show: {
				resource: ['ivr'],
				operation: ['getScenario', 'updateScenario', 'deleteScenario', 'launchScenario'],
			},
		},
		description: 'ID of the IVR scenario',
	},
	{
		displayName: 'Title',
		name: 'ivrScenarioTitle',
		type: 'string',
		default: '',
		displayOptions: {
			show: {
				resource: ['ivr'],
				operation: ['createScenario', 'updateScenario'],
			},
		},
		description: 'Name of the scenario',
	},
	{
		displayName: 'Description',
		name: 'ivrScenarioDescription',
		type: 'string',
		typeOptions: {
			rows: 3,
		},
		default: '',
		displayOptions: {
			show: {
				resource: ['ivr'],
				operation: ['createScenario', 'updateScenario'],
			},
		},
		description: 'What the scenario is for',
	},
	{
		displayName: 'Enabled',
		name: 'ivrScenarioStatus',
		type: 'boolean',
		default: true,
		displayOptions: {
			show: {
				resource: ['ivr'],
				operation: ['createScenario', 'updateScenario'],
			},
		},
		description: 'Whether the scenario may be used. mNotify creates scenarios enabled by default.',
	},
	{
		displayName: 'Caller Number',
		name: 'ivrFromNumber',
		type: 'string',
		default: '',
		required: true,
		placeholder: '233501234567',
		displayOptions: {
			show: {
				resource: ['ivr'],
				operation: ['initiateCall'],
			},
		},
		description: 'Number that initiates the call, in international format without a plus sign',
	},
	{
		displayName: 'Destination Number',
		name: 'ivrToNumber',
		type: 'string',
		default: '',
		required: true,
		placeholder: '233541234567',
		displayOptions: {
			show: {
				resource: ['ivr'],
				operation: ['initiateCall'],
			},
		},
		description: 'Number to dial, in international format without a plus sign',
	},
	{
		displayName: 'Session UUID',
		name: 'ivrUuid',
		type: 'string',
		default: '',
		required: true,
		displayOptions: {
			show: {
				resource: ['ivr'],
				operation: ['initiateCall'],
			},
		},
		description:
			'Unique identifier for this call session. Supply your own value so the eventual callback can be matched to this call.',
	},
	{
		displayName: 'Tracking ID',
		name: 'ivrUniqueId',
		type: 'string',
		default: '',
		required: true,
		displayOptions: {
			show: {
				resource: ['ivr'],
				operation: ['initiateCall'],
			},
		},
		description: 'Second identifier used by mNotify when it reports the call, for example your own record ID',
	},
	{
		displayName: 'Phone Numbers',
		name: 'ivrRecipients',
		type: 'string',
		typeOptions: {
			rows: 2,
		},
		default: '',
		required: true,
		placeholder: '0249706365, 0203698970',
		displayOptions: {
			show: {
				resource: ['ivr'],
				operation: ['launchScenario'],
			},
		},
		description:
			'Numbers to call, separated by commas, spaces or new lines. Local and international formats are accepted. IVR calls are charged per contact.',
	},
	{
		displayName: 'Flow ID',
		name: 'ivrFlowId',
		type: 'string',
		default: '',
		required: true,
		displayOptions: {
			show: {
				resource: ['ivr'],
				operation: ['getFlow', 'deleteFlow'],
			},
		},
		description: 'ID of the scenario step (flow). It is returned by Save Scenario Flow and Get Scenario Flow.',
	},
	{
		displayName: 'Flow ID',
		name: 'ivrFlowIdUpdate',
		type: 'string',
		default: '',
		displayOptions: {
			show: {
				resource: ['ivr'],
				operation: ['saveFlow'],
			},
		},
		description: 'Leave empty to add a new step to the scenario, or enter an existing flow ID to replace that step',
	},
	{
		displayName: 'Scenario Name or ID',
		name: 'ivrFlowScenarioId',
		type: 'options',
		typeOptions: {
			loadOptionsMethod: 'getIvrScenarios',
		},
		default: '',
		displayOptions: {
			show: {
				resource: ['ivr'],
				operation: ['saveFlow'],
			},
		},
		description: 'Scenario the step belongs to (sent as ivr_scenarios_id when adding a new step). Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.',
	},
	{
		displayName: 'Flow Name',
		name: 'ivrFlowName',
		type: 'string',
		default: '',
		displayOptions: {
			show: {
				resource: ['ivr'],
				operation: ['saveFlow'],
			},
		},
		description: 'Name of the step, for example Sales Menu',
	},
	{
		displayName: 'Route',
		name: 'ivrFlowRoute',
		type: 'string',
		default: '',
		placeholder: '/sales_menu',
		displayOptions: {
			show: {
				resource: ['ivr'],
				operation: ['saveFlow'],
			},
		},
		description:
			'Route name of the step. Name the first step "start"; any other step can use a name of your choice.',
	},
	{
		displayName: 'Audio URL',
		name: 'ivrFlowAudio',
		type: 'string',
		default: '',
		placeholder: 'https://example.com/welcome.mp3',
		displayOptions: {
			show: {
				resource: ['ivr'],
				operation: ['saveFlow'],
			},
		},
		description: 'URL of the audio file played at this step',
	},
	{
		displayName: 'Keypad Options (DTMF)',
		name: 'ivrFlowDtmf',
		type: 'json',
		default: {},
		displayOptions: {
			show: {
				resource: ['ivr'],
				operation: ['saveFlow'],
			},
		},
		description:
			'Object mapping a keypad digit to the route it leads to, for example {"1": "/sales", "2": "/support"}',
	},
];

/** Parses a JSON field into an object, returning null when it is not usable. */
function jsonObject(value: unknown): IDataObject | null {
	if (value === null || value === undefined || value === '') {
		return {};
	}
	if (typeof value === 'object' && !Array.isArray(value)) {
		return value as IDataObject;
	}
	if (typeof value === 'string') {
		try {
			const parsed = JSON.parse(value);
			if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) {
				return parsed as IDataObject;
			}
		} catch {
			return null;
		}
	}
	return null;
}

export async function executeIvrOperation(
	this: IExecuteFunctions,
	operation: string,
	itemIndex: number,
): Promise<IDataObject[]> {
	switch (operation) {
		case 'getScenarios': {
			const response = await mnotifyApiRequest.call(this, 'GET', mnPath('ivrScenarios'));
			return emitRecords(response, ['data', 'scenario_list', 'ivr_scenarios', 'scenarios']);
		}
		case 'getScenario': {
			const scenarioId = this.getNodeParameter('ivrScenarioId', itemIndex, '') as string;
			const response = await mnotifyApiRequest.call(
				this,
				'GET',
				mnPath('ivrScenarioById', { id: scenarioId }),
			);
			return emitRecords(response, ['scenario_list', 'scenario', 'data']);
		}
		case 'createScenario': {
			const body = withoutEmptyValues({
				title: this.getNodeParameter('ivrScenarioTitle', itemIndex, '') as string,
				description: this.getNodeParameter('ivrScenarioDescription', itemIndex, '') as string,
				status: this.getNodeParameter('ivrScenarioStatus', itemIndex, true) as boolean,
			});
			if (!body.title) {
				throw new NodeOperationError(this.getNode(), 'The scenario title is empty.', { itemIndex });
			}
			const response = await mnotifyApiRequest.call(this, 'POST', mnPath('ivrScenarios'), { body });
			return [
				{
					scenarioId: response.id ?? response._id ?? '',
					title: response.title ?? body.title,
					description: response.description ?? body.description,
					status: response.status ?? '',
				},
			];
		}
		case 'updateScenario': {
			const scenarioId = this.getNodeParameter('ivrScenarioId', itemIndex, '') as string;
			const body = withoutEmptyValues({
				id: scenarioId,
				title: this.getNodeParameter('ivrScenarioTitle', itemIndex, '') as string,
				description: this.getNodeParameter('ivrScenarioDescription', itemIndex, '') as string,
				status: this.getNodeParameter('ivrScenarioStatus', itemIndex, true) as boolean,
			});
			const response = await mnotifyApiRequest.call(
				this,
				'PUT',
				mnPath('ivrScenarioById', { id: scenarioId }),
				{ body },
			);
			return [{ scenarioId, status: response.status ?? '', message: response.message ?? '' }];
		}
		case 'deleteScenario': {
			const scenarioId = this.getNodeParameter('ivrScenarioId', itemIndex, '') as string;
			const response = await mnotifyApiRequest.call(
				this,
				'DELETE',
				mnPath('ivrScenarioById', { id: scenarioId }),
			);
			return [{ scenarioId, status: response.status ?? '', message: response.message ?? '' }];
		}
		case 'launchScenario': {
			const scenarioId = this.getNodeParameter('ivrScenarioId', itemIndex, '') as string;
			const recipients = splitRecipients(this.getNodeParameter('ivrRecipients', itemIndex, '') as string);
			if (recipients.length === 0) {
				throw new NodeOperationError(this.getNode(), 'No destination number given.', { itemIndex });
			}
			const response = await mnotifyApiRequest.call(this, 'POST', mnPath('ivrScenarioSend'), {
				body: { id: scenarioId, recipients },
			});
			return emitRecords(response, ['summary', 'data']);
		}
		case 'initiateCall': {
			const response = await mnotifyApiRequest.call(this, 'POST', mnPath('initiateIvrCall'), {
				body: {
					fromNumber: this.getNodeParameter('ivrFromNumber', itemIndex, '') as string,
					toNumber: this.getNodeParameter('ivrToNumber', itemIndex, '') as string,
					uuid: this.getNodeParameter('ivrUuid', itemIndex, '') as string,
					uniqueId: this.getNodeParameter('ivrUniqueId', itemIndex, '') as string,
				},
			});
			return [
				{
					callId: response.callId ?? '',
					status: response.status ?? '',
					message: response.message ?? '',
				},
			];
		}
		case 'getFlow': {
			const flowId = this.getNodeParameter('ivrFlowId', itemIndex, '') as string;
			const response = await mnotifyApiRequest.call(
				this,
				'GET',
				mnPath('ivrScenariosFlowById', { id: flowId }),
			);
			return emitRecords(response, ['data', 'flow']);
		}
		case 'saveFlow': {
			const flowId = String(this.getNodeParameter('ivrFlowIdUpdate', itemIndex, '') ?? '').trim();
			const isUpdate = flowId !== '';

			let dtmf: IDataObject = {};
			const parsedDtmf = jsonObject(this.getNodeParameter('ivrFlowDtmf', itemIndex, {}));
			if (parsedDtmf === null) {
				throw new NodeOperationError(this.getNode(), 'Keypad Options (DTMF) must be a JSON object.', {
					itemIndex,
					description: 'For example {"1": "/sales", "2": "/support"}.',
				});
			}
			dtmf = parsedDtmf;

			const body = withoutEmptyValues({
				flow_name: this.getNodeParameter('ivrFlowName', itemIndex, '') as string,
				route: this.getNodeParameter('ivrFlowRoute', itemIndex, '') as string,
				audio: this.getNodeParameter('ivrFlowAudio', itemIndex, '') as string,
				dtmf: Object.keys(dtmf).length > 0 ? dtmf : undefined,
			});
			if (isUpdate) {
				body.id = flowId;
			} else {
				const scenarioId = String(
					this.getNodeParameter('ivrFlowScenarioId', itemIndex, '') ?? '',
				).trim();
				if (scenarioId !== '') {
					body.ivr_scenarios_id = scenarioId;
				}
			}

			const response = await mnotifyApiRequest.call(
				this,
				isUpdate ? 'PUT' : 'POST',
				isUpdate ? mnPath('ivrScenariosFlowById', { id: flowId }) : mnPath('ivrScenariosFlow'),
				{ body },
			);
			return [
				{
					flowId: isUpdate ? flowId : String(response.id ?? ''),
					status: response.status ?? '',
					message: response.message ?? '',
				},
			];
		}
		case 'deleteFlow': {
			const flowId = this.getNodeParameter('ivrFlowId', itemIndex, '') as string;
			const response = await mnotifyApiRequest.call(
				this,
				'DELETE',
				mnPath('ivrScenariosFlowById', { id: flowId }),
			);
			return [{ flowId, status: response.status ?? '', message: response.message ?? '' }];
		}
		default:
			throw new NodeOperationError(this.getNode(), `Unknown IVR operation "${operation}".`, {
				itemIndex,
			});
	}
}
