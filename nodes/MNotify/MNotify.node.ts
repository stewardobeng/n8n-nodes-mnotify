import type {
	IDataObject,
	IExecuteFunctions,
	ILoadOptionsFunctions,
	INodeExecutionData,
	INodePropertyOptions,
	INodeType,
	INodeTypeDescription,
	JsonObject,
} from 'n8n-workflow';
import { NodeApiError, NodeConnectionTypes, NodeOperationError } from 'n8n-workflow';

import { mnPath } from './endpoints';
import { mnotifyApiRequest, pickList } from './GenericFunctions';
import { accountDescription, executeAccountOperation } from './resources/account';
import { contactDescription, executeContactOperation } from './resources/contact';
import { groupDescription, executeGroupOperation } from './resources/group';
import { executeIvrOperation, ivrDescription } from './resources/ivr';
import { executeReportOperation, reportDescription } from './resources/report';
import { executeScheduledOperation, scheduledDescription } from './resources/scheduled';
import { executeSenderIdOperation, senderIdDescription } from './resources/senderId';
import { executeSmsOperation, smsDescription } from './resources/sms';
import { executeTemplateOperation, templateDescription } from './resources/template';
import { executeVoiceOperation, voiceDescription } from './resources/voice';

export class MNotify implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'mNotify',
		name: 'mNotify',
		icon: { light: 'file:mnotify.svg', dark: 'file:mnotify.dark.svg' },
		group: ['transform'],
		version: 1,
		subtitle: '={{ $parameter["operation"] + " · " + $parameter["resource"] }}',
		description:
			'Send and manage SMS, scheduled SMS, bulk voice calls, IVR scenarios, templates, groups, contacts and delivery reports through mNotify (BMS)',
		defaults: {
			name: 'mNotify',
		},
		inputs: [NodeConnectionTypes.Main],
		outputs: [NodeConnectionTypes.Main],
		usableAsTool: true,
		credentials: [
			{
				name: 'mNotifyApi',
				required: true,
			},
		],
		properties: [
			{
				displayName: 'Resource',
				name: 'resource',
				type: 'options',
				noDataExpression: true,
				options: [
					{
						name: 'Account',
						value: 'account',
						description: 'SMS, bonus and wallet balances on the mNotify account',
					},
					{
						name: 'Contact',
						value: 'contact',
						description: 'Contacts stored in the groups on the mNotify account',
					},
					{
						name: 'Group',
						value: 'group',
						description: 'Contact groups on the mNotify account',
					},
					{
						name: 'IVR',
						value: 'ivr',
						description: 'Outbound IVR scenarios, their flows, and IVR calls',
					},
					{
						name: 'Message Template',
						value: 'template',
						description: 'Reusable message bodies stored on the mNotify account',
					},
					{
						name: 'Report',
						value: 'report',
						description: 'Delivery reports for sent messages and calls',
					},
					{
						name: 'Scheduled Message',
						value: 'scheduled',
						description: 'Messages mNotify is holding for a later send time',
					},
					{
						name: 'Sender ID',
						value: 'senderId',
						description: 'Register a Sender ID or check whether it is approved',
					},
					{
						name: 'SMS',
						value: 'sms',
						description: 'Send SMS to individual numbers or to groups',
					},
					{
						name: 'Voice',
						value: 'voice',
						description: 'Place recorded voice calls to individual numbers or to groups',
					},
				],
				default: 'sms',
			},
			...smsDescription,
			...voiceDescription,
			...ivrDescription,
			...templateDescription,
			...groupDescription,
			...contactDescription,
			...senderIdDescription,
			...scheduledDescription,
			...accountDescription,
			...reportDescription,
		],
	};

	methods = {
		loadOptions: {
			/** Groups for the group pickers. */
			async getGroups(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
				const response = await mnotifyApiRequest.call(this, 'GET', mnPath('group'));
				const groups = pickList(response, ['group_list', 'data']);
				return groups.map((group) => ({
					name: String(group.group_name ?? group.name ?? group._id ?? ''),
					value: String(group._id ?? group.id ?? ''),
					description:
						group.total_contacts === undefined
							? undefined
							: `${group.total_contacts} contact(s)`,
				}));
			},

			/** Message templates for the template pickers. */
			async getTemplates(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
				const response = await mnotifyApiRequest.call(this, 'GET', mnPath('template'));
				const templates = pickList(response, ['template_list', 'data']);
				return templates.map((template) => ({
					name: String(template.title ?? template._id ?? ''),
					value: String(template._id ?? template.id ?? ''),
					description: template.content === undefined ? undefined : String(template.content),
				}));
			},

			/** Outbound IVR scenarios for the flow pickers. */
			async getIvrScenarios(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
				const response = await mnotifyApiRequest.call(this, 'GET', mnPath('ivrScenarios'));
				const scenarios = pickList(response, ['data', 'scenario_list', 'ivr_scenarios', 'scenarios']);
				return scenarios.map((scenario) => ({
					name: String(scenario.title ?? scenario.name ?? scenario.id ?? ''),
					value: String(scenario.id ?? scenario._id ?? ''),
					description:
						scenario.description === undefined ? undefined : String(scenario.description),
				}));
			},
		},
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const items = this.getInputData();
		const returnData: INodeExecutionData[] = [];

		for (let itemIndex = 0; itemIndex < items.length; itemIndex++) {
			try {
				const results = await runOperation.call(this, itemIndex);

				for (const result of results) {
					returnData.push({
						json: result,
						pairedItem: { item: itemIndex },
					});
				}
			} catch (error) {
				if (this.continueOnFail()) {
					returnData.push({
						json: { error: (error as Error).message },
						pairedItem: { item: itemIndex },
					});
					continue;
				}
				// A NodeApiError or NodeOperationError already names the node and carries the
				// actionable hint; anything else is wrapped so the editor shows the HTTP detail.
				throw error instanceof NodeApiError || error instanceof NodeOperationError
					? (error as Error)
					: new NodeApiError(this.getNode(), error as JsonObject, { itemIndex });
			}
		}

		return [returnData];
	}
}

/** Runs one item's operation. Module scope so only `execute` owns the try/catch. */
async function runOperation(this: IExecuteFunctions, itemIndex: number): Promise<IDataObject[]> {
	const resource = this.getNodeParameter('resource', itemIndex, 'sms') as string;
	const operation = this.getNodeParameter('operation', itemIndex, '') as string;

	switch (resource) {
		case 'sms':
			return executeSmsOperation.call(this, operation, itemIndex);
		case 'voice':
			return executeVoiceOperation.call(this, operation, itemIndex);
		case 'ivr':
			return executeIvrOperation.call(this, operation, itemIndex);
		case 'template':
			return executeTemplateOperation.call(this, operation, itemIndex);
		case 'group':
			return executeGroupOperation.call(this, operation, itemIndex);
		case 'contact':
			return executeContactOperation.call(this, operation, itemIndex);
		case 'senderId':
			return executeSenderIdOperation.call(this, operation, itemIndex);
		case 'scheduled':
			return executeScheduledOperation.call(this, operation, itemIndex);
		case 'account':
			return executeAccountOperation.call(this, operation, itemIndex);
		case 'report':
			return executeReportOperation.call(this, operation, itemIndex);
		default:
			throw new NodeOperationError(this.getNode(), `Unknown resource "${resource}".`, {
				itemIndex,
			});
	}
}
