import type {
	IDataObject,
	INodeExecutionData,
	INodeType,
	INodeTypeDescription,
	IWebhookFunctions,
	IWebhookResponseData,
} from 'n8n-workflow';
import { NodeConnectionTypes } from 'n8n-workflow';

/**
 * Receives the callbacks mNotify sends for USSD sessions and IVR calls.
 *
 * mNotify calls a URL you configure in its dashboard. Two families of callback exist:
 *
 * - USSD (shared or dedicated shortcode): mNotify POSTs the session data and expects the
 *   response body to be the next menu step.
 * - IVR: mNotify GETs the callback with the interaction as query parameters and expects a
 *   JSON object naming the next action.
 *
 * This node responds with the last node's first output item (response mode "last node"), so a
 * workflow ends by producing exactly the object mNotify expects for that callback.
 */

type CallbackKind = 'ussdShared' | 'ussdDedicated' | 'ivr' | 'unknown';

function detectKind(body: IDataObject, query: IDataObject): CallbackKind {
	if (body.shortCode !== undefined || body.msIsdn !== undefined || body.ussdGwId !== undefined) {
		return 'ussdDedicated';
	}
	if (body.msisdn !== undefined && (body.sequenceID !== undefined || body.data !== undefined)) {
		return 'ussdShared';
	}
	if (
		query.CallerId !== undefined ||
		query.SequenceID !== undefined ||
		query.DTMF !== undefined ||
		query.action !== undefined
	) {
		return 'ivr';
	}
	return 'unknown';
}

export class MNotifyTrigger implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'mNotify Trigger',
		name: 'mNotifyTrigger',
		icon: { light: 'file:mnotify.svg', dark: 'file:mnotify.dark.svg' },
		group: ['trigger'],
		version: 1,
		description: 'Start a workflow when mNotify sends a USSD session or IVR callback',
		defaults: {
			name: 'mNotify Trigger',
		},
		inputs: [],
		outputs: [NodeConnectionTypes.Main],
		webhooks: [
			{
				name: 'default',
				httpMethod: '={{$parameter["httpMethod"]}}',
				path: '={{$parameter["path"]}}',
				// The workflow's last node produces the body mNotify reads as the next menu step.
				responseMode: 'lastNode',
				responseData: 'firstEntryJson',
			},
		],
		properties: [
			{
				displayName:
					'Copy the Production URL of this node into the callback setting in the mNotify dashboard (USSD application or IVR callback URL). While the workflow is inactive, use the Test URL and press "Listen for test event" here first.',
				name: 'callbackNotice',
				type: 'notice',
				default: '',
			},
			{
				displayName: 'Path',
				name: 'path',
				type: 'string',
				default: 'mnotify',
				required: true,
				placeholder: 'e.g. mnotify-ussd',
				description:
					'Path part of the callback URL. Make it hard to guess, because anyone who knows the full URL can post to this workflow.',
			},
			{
				displayName: 'HTTP Method',
				name: 'httpMethod',
				type: 'options',
				options: [
					{
						name: 'GET',
						value: 'GET',
						description: 'mNotify calls IVR callbacks with GET and query parameters',
					},
					{
						name: 'POST',
						value: 'POST',
						description: 'mNotify posts USSD sessions as a JSON body',
					},
				],
				default: 'POST',
				description: 'HTTP method mNotify uses when calling this URL',
			},
			{
				displayName: 'Callback Type',
				name: 'callbackType',
				type: 'options',
				options: [
					{ name: 'Any', value: 'any', description: 'Accept every callback shape' },
					{ name: 'Dedicated USSD', value: 'ussdDedicated', description: 'Dedicated shortcode session' },
					{ name: 'IVR', value: 'ivr', description: 'IVR interaction callback' },
					{ name: 'Shared USSD', value: 'ussdShared', description: 'Shared shortcode session' },
				],
				default: 'any',
				description:
					'Which callback this workflow expects. Detection of the actual callback kind is always added to the output as Callback Type.',
			},
			{
				displayName:
					'The workflow must end with a node whose first output item is the answer. Shared USSD expects {msisdn, sequenceID, message, timestamp, continueFlag}. Dedicated USSD expects {responseExitCode: 200, shouldClose, ussdMenu, responseMessage}. IVR expects {playback: {url}} or {get_digits: {...}}. Use a Set node or a Code node as the last node to shape it.',
				name: 'responseShapeNotice',
				type: 'notice',
				default: '',
			},
		],
	};

	async webhook(this: IWebhookFunctions): Promise<IWebhookResponseData> {
		const body = (this.getBodyData() ?? {}) as IDataObject;
		const query = (this.getQueryData() ?? {}) as IDataObject;
		const headers = this.getHeaderData() as unknown as IDataObject;

		// GET callbacks arrive as query parameters, POST callbacks as a JSON body. Both are
		// merged so a workflow can read one flat object whichever way mNotify called.
		const payload: IDataObject = { ...query, ...body };
		const kind = detectKind(body, query);

		const item: INodeExecutionData = {
			json: {
				...payload,
				callbackType: kind,
				httpMethod: this.getRequestObject().method,
				headers,
			},
		};

		return {
			workflowData: [[item]],
		};
	}
}
