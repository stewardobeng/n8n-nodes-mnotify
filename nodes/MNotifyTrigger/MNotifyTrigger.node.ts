import type {
	IDataObject,
	IHookFunctions,
	INodeExecutionData,
	INodeType,
	INodeTypeDescription,
	IWebhookFunctions,
	IWebhookResponseData,
} from 'n8n-workflow';
import { NodeConnectionTypes } from 'n8n-workflow';
import { timingSafeEqual } from 'node:crypto';

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
		subtitle: '={{ $parameter["callbackType"] }}',
		description: 'Start a workflow when mNotify sends a USSD session or IVR callback',
		defaults: {
			name: 'mNotify Trigger',
		},
		inputs: [],
		outputs: [NodeConnectionTypes.Main],
		credentials: [{ name: 'mNotifyApi', required: true }],
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
					'Add ?mnotify_token=YOUR_SECRET to the webhook URL before registering it with mNotify. Set the same secret in your mNotify API credential. Treat the full URL as a password.',
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
						description: 'MNotify calls IVR callbacks with GET and query parameters',
					},
					{
						name: 'POST',
						value: 'POST',
						description: 'MNotify posts USSD sessions as a JSON body',
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
					'Only accept the selected callback shape, or choose Any to accept all shapes. The detected kind is included in the output.',
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

	/**
	 * mNotify has no API to register or remove a callback URL: the URL is entered by hand in
	 * the mNotify dashboard (or requested from mNotify support for a USSD application), so
	 * there is nothing to create or tear down on activation. The hooks answer truthfully
	 * instead of pretending a registration happened.
	 */
	webhookMethods = {
		default: {
			async checkExists(this: IHookFunctions): Promise<boolean> {
				return true;
			},
			async create(this: IHookFunctions): Promise<boolean> {
				return true;
			},
			async delete(this: IHookFunctions): Promise<boolean> {
				return true;
			},
		},
	};

	async webhook(this: IWebhookFunctions): Promise<IWebhookResponseData> {
		const body = (this.getBodyData() ?? {}) as IDataObject;
		const query = (this.getQueryData() ?? {}) as IDataObject;
		const reject = (status: number, message: string): IWebhookResponseData => {
			const response = this.getResponseObject();
			response.writeHead(status, { 'Content-Type': 'text/plain' });
			response.end(message);
			return { noWebhookResponse: true };
		};
		let secret: unknown;
		try {
			secret = (await this.getCredentials('mNotifyApi')).webhookSecret;
		} catch {
			return reject(401, 'Unauthorized');
		}
		const token = query.mnotify_token;
		if (typeof secret !== 'string' || !/^[A-Za-z0-9_-]{32,}$/.test(secret) || typeof token !== 'string') {
			return reject(401, 'Unauthorized');
		}
		const expected = Buffer.from(secret, 'utf8');
		const supplied = Buffer.from(token, 'utf8');
		if (expected.length !== supplied.length || !timingSafeEqual(expected, supplied)) {
			return reject(401, 'Unauthorized');
		}

		// GET callbacks arrive as query parameters, POST callbacks as a JSON body. Both are
		// merged so a workflow can read one flat object whichever way mNotify called.
		const kind = detectKind(body, query);
		const selected = this.getNodeParameter('callbackType', 'any') as string;
		if (selected !== 'any' && selected !== kind) {
			return reject(400, 'Unexpected callback type');
		}
		const payload: IDataObject = { ...query, ...body };
		delete payload.mnotify_token;

		const item: INodeExecutionData = {
			json: {
				...payload,
				callbackType: kind,
				httpMethod: this.getRequestObject().method,
			},
		};

		return {
			workflowData: [[item]],
		};
	}
}
