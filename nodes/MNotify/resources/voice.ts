import type { IDataObject, IExecuteFunctions, INodeProperties } from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';

import {
	buildMultipartBody,
	mnotifyApiRequest,
	requireMNotifyDateTime,
	splitRecipients,
	toFormBoolean,
} from '../GenericFunctions';

const voiceSourceField: INodeProperties = {
	displayName: 'Voice Source',
	name: 'voiceSource',
	type: 'options',
	options: [
		{
			name: 'Audio File',
			value: 'file',
			description: 'Upload an audio file with this call',
		},
		{
			name: 'Existing Voice ID',
			value: 'voiceId',
			description: 'Reuse an audio file already uploaded to the mNotify account',
		},
	],
	default: 'file',
	description: 'Whether to upload an audio file or reuse a voice file already on the account',
};

const voiceFileField: INodeProperties = {
	displayName: 'Input Binary Field',
	name: 'binaryPropertyName',
	type: 'string',
	default: 'data',
	displayOptions: {
		show: {
			voiceSource: ['file'],
		},
	},
	hint: 'The name of the input binary field holding the audio file',
	description:
		'Name of the binary field that holds the recording, for example the output of a Read Binary File node. MP3 and WAV both work.',
};

const voiceIdField: INodeProperties = {
	displayName: 'Voice ID',
	name: 'voiceId',
	type: 'string',
	default: '',
	placeholder: 'e.g. 20180308134708',
	displayOptions: {
		show: {
			voiceSource: ['voiceId'],
		},
	},
	description:
		'ID of a voice file already uploaded to the mNotify account. mNotify returns it the first time you send a recording.',
};

const voiceSchedulingFields: INodeProperties[] = [
	{
		displayName: 'Schedule',
		name: 'isScheduled',
		type: 'boolean',
		default: false,
		description: 'Whether mNotify should hold the call and place it at the given date and time',
	},
	{
		displayName: 'Schedule Date and Time',
		name: 'scheduleDate',
		type: 'dateTime',
		default: '',
		displayOptions: {
			show: {
				isScheduled: [true],
			},
		},
		description:
			'When to place the calls, in the workflow timezone. The value is passed to mNotify as-is and read as Ghana time (GMT).',
	},
];

export const voiceDescription: INodeProperties[] = [
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: {
			show: {
				resource: ['voice'],
			},
		},
		options: [
			{
				name: 'Send Voice Call',
				value: 'send',
				action: 'Send a voice call',
				description: 'Place the same recorded voice call to one or more phone numbers',
			},
			{
				name: 'Send Voice Call to Groups',
				value: 'sendGroup',
				action: 'Send a voice call to groups',
				description: 'Place a recorded voice call to every contact in one or more saved groups',
			},
		],
		default: 'send',
	},
	{
		displayName: 'Campaign Name',
		name: 'campaign',
		type: 'string',
		default: '',
		required: true,
		placeholder: 'e.g. Service reminder',
		displayOptions: {
			show: {
				resource: ['voice'],
			},
		},
		description: 'Title of the voice campaign. It is how the campaign is named in mNotify reports.',
	},
	{
		displayName: 'Phone Numbers',
		name: 'recipients',
		type: 'string',
		typeOptions: {
			rows: 2,
		},
		default: '',
		required: true,
		placeholder: '0241234567, 0201234567',
		displayOptions: {
			show: {
				resource: ['voice'],
				operation: ['send'],
			},
		},
		description:
			'One or more destination numbers, separated by commas, spaces or new lines. Local (0241234567) and international (233241234567) formats are accepted. Each call is charged.',
	},
	{
		displayName: 'Groups',
		name: 'groupIds',
		type: 'multiOptions',
		typeOptions: {
			loadOptionsMethod: 'getGroups',
		},
		default: [],
		required: true,
		displayOptions: {
			show: {
				resource: ['voice'],
				operation: ['sendGroup'],
			},
		},
		description:
			'Groups whose contacts should receive the call. Choose from the list, or specify IDs using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.',
	},
	voiceSourceField,
	voiceFileField,
	voiceIdField,
	{
		displayName: 'Additional Fields',
		name: 'voiceAdditionalFields',
		type: 'collection',
		placeholder: 'Add Field',
		default: {},
		displayOptions: {
			show: {
				resource: ['voice'],
			},
		},
		options: voiceSchedulingFields,
	},
];

async function buildVoiceForm(
	this: IExecuteFunctions,
	itemIndex: number,
	target: 'quick' | 'group',
): Promise<{ body: Buffer; contentType: string }> {
	const campaign = String(this.getNodeParameter('campaign', itemIndex, '')).trim();
	if (campaign === '') {
		throw new NodeOperationError(this.getNode(), 'The campaign name is empty.', { itemIndex });
	}

	const fields: Record<string, string | string[]> = { campaign };

	if (target === 'quick') {
		const recipients = splitRecipients(this.getNodeParameter('recipients', itemIndex, '') as string);
		if (recipients.length === 0) {
			throw new NodeOperationError(this.getNode(), 'No destination number given.', {
				itemIndex,
				description: 'Add at least one phone number to Phone Numbers.',
			});
		}
		// PHP (Laravel) multipart parsing expects the array-bracket form mNotify documents.
		fields['recipient[]'] = recipients;
	} else {
		const groupIds = this.getNodeParameter('groupIds', itemIndex, []) as Array<string | number>;
		if (!Array.isArray(groupIds) || groupIds.length === 0) {
			throw new NodeOperationError(this.getNode(), 'No group selected.', {
				itemIndex,
				description: 'Choose at least one group to call.',
			});
		}
		fields['group_id[]'] = groupIds.map((id) => String(id));
	}

	const voiceSource = this.getNodeParameter('voiceSource', itemIndex, 'file') as string;
	let file: { fieldName: string; filename: string; contentType: string; data: Buffer } | undefined;

	if (voiceSource === 'voiceId') {
		const voiceId = String(this.getNodeParameter('voiceId', itemIndex, '')).trim();
		if (voiceId === '') {
			throw new NodeOperationError(this.getNode(), 'No Voice ID given.', {
				itemIndex,
				description:
					'Enter the ID of a voice file already on the mNotify account, or switch Voice Source to Audio File.',
			});
		}
		fields.voice_id = voiceId;
		fields.file = '';
	} else {
		const binaryPropertyName = String(
			this.getNodeParameter('binaryPropertyName', itemIndex, 'data'),
		).trim();
		const binaryData = this.helpers.assertBinaryData(itemIndex, binaryPropertyName);
		const buffer = await this.helpers.getBinaryDataBuffer(itemIndex, binaryPropertyName);
		file = {
			fieldName: 'file',
			filename: binaryData.fileName ?? 'recording.mp3',
			contentType: binaryData.mimeType || 'application/octet-stream',
			data: buffer,
		};
		fields.voice_id = '';
	}

	const additionalFields = this.getNodeParameter('voiceAdditionalFields', itemIndex, {}) as IDataObject;
	const isScheduled = additionalFields.isScheduled === true;
	fields.is_schedule = toFormBoolean(isScheduled);
	fields.schedule_date = isScheduled
		? requireMNotifyDateTime.call(this, additionalFields.scheduleDate, 'Schedule Date and Time')
		: '';

	// No sender field is sent: mNotify's voice endpoints do not document a caller-ID override
	// and an unexpected field risks a validation error on the call.
	const multipart = buildMultipartBody(fields, file);
	return { body: multipart.body, contentType: multipart.contentType };
}

async function sendVoice(this: IExecuteFunctions, itemIndex: number): Promise<IDataObject[]> {
	const form = await buildVoiceForm.call(this, itemIndex, 'quick');
	const response = await mnotifyApiRequest.call(this, 'POST', 'voice/quick', { multipart: form });
	return [buildCallResult(response)];
}

async function sendVoiceToGroups(this: IExecuteFunctions, itemIndex: number): Promise<IDataObject[]> {
	const form = await buildVoiceForm.call(this, itemIndex, 'group');
	const response = await mnotifyApiRequest.call(this, 'POST', 'voice/group', { multipart: form });
	return [buildCallResult(response)];
}

function buildCallResult(response: IDataObject): IDataObject {
	const summary = (response.summary ?? {}) as IDataObject;
	return {
		campaignId: summary._id ?? '',
		voiceId: summary.voice_id ?? '',
		type: summary.type ?? '',
		totalSent: summary.total_sent ?? 0,
		contacts: summary.contacts ?? 0,
		totalRejected: summary.total_rejected ?? 0,
		numbersSent: summary.numbers_sent ?? [],
		creditUsed: summary.credit_used ?? 0,
		status: response.status ?? '',
		message: response.message ?? '',
	};
}

export async function executeVoiceOperation(
	this: IExecuteFunctions,
	operation: string,
	itemIndex: number,
): Promise<IDataObject[]> {
	switch (operation) {
		case 'send':
			return sendVoice.call(this, itemIndex);
		case 'sendGroup':
			return sendVoiceToGroups.call(this, itemIndex);
		default:
			throw new NodeOperationError(this.getNode(), `Unknown voice operation "${operation}".`, {
				itemIndex,
			});
	}
}
