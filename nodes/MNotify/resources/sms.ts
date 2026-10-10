import type { IDataObject, IExecuteFunctions, INodeProperties } from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';

import {
	mnotifyApiRequest,
	requireMNotifyDateTime,
	resolveSenderId,
	splitRecipients,
} from '../GenericFunctions';
import { mnPath } from '../endpoints';

const showOnlyForSms = { resource: ['sms'] };

const senderIdField: INodeProperties = {
	displayName: 'Sender ID',
	name: 'senderId',
	type: 'string',
	default: '',
	placeholder: 'e.g. SteProOTP',
	description:
		'Sender ID shown on the handset. Leave empty to use the default Sender ID of the credential. Must be at most 11 characters and letters/digits only, because mNotify rejects a hyphenated Sender ID.',
};

const schedulingFields: INodeProperties[] = [
	{
		displayName: 'SMS Type',
		name: 'smsType',
		type: 'options',
		options: [
			{
				name: 'Transactional',
				value: 'transactional',
				description: 'Normal bulk SMS, billed from the SMS credit balance',
			},
			{
				name: 'OTP',
				value: 'otp',
				description: 'Routed for one-time codes, billed 0.035 per campaign from the main wallet',
			},
		],
		default: 'transactional',
		description:
			'Whether this blast is a one-time-code campaign. mNotify bills OTP-typed campaigns 0.035 each from the main wallet, separately from SMS credits, and refuses the send when that wallet is empty.',
	},
	{
		displayName: 'Schedule',
		name: 'isScheduled',
		type: 'boolean',
		default: false,
		description: 'Whether mNotify should hold the message and send it at the given date and time',
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
			'When to send, in the workflow timezone. The value is passed to mNotify as-is and read as Ghana time (GMT). Only used when Schedule is enabled.',
	},
];

export const smsDescription: INodeProperties[] = [
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: {
			show: showOnlyForSms,
		},
		options: [
			{
				name: 'Send SMS',
				value: 'send',
				action: 'Send an SMS',
				description: 'Send the same message to one or more phone numbers',
			},
			{
				name: 'Send SMS to Groups',
				value: 'sendGroup',
				action: 'Send an SMS to groups',
				description: 'Send a message to every contact in one or more saved groups',
			},
		],
		default: 'send',
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
				resource: ['sms'],
				operation: ['send'],
			},
		},
		description:
			'One or more destination numbers, separated by commas, spaces or new lines. Local (0241234567) and international (233241234567 or +233241234567) formats are accepted. Each number is charged.',
	},
	{
		displayName: 'Group Names or IDs',
		name: 'groupIds',
		type: 'multiOptions',
		typeOptions: {
			loadOptionsMethod: 'getGroups',
		},
		default: [],
		required: true,
		displayOptions: {
			show: {
				resource: ['sms'],
				operation: ['sendGroup'],
			},
		},
		description:
			'Groups whose contacts should receive the message. Choose from the list, or specify IDs using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.',
	},
	{
		displayName: 'Message Source',
		name: 'messageSource',
		type: 'options',
		options: [
			{
				name: 'Text',
				value: 'text',
				description: 'Type the message in this node',
			},
			{
				name: 'Message Template',
				value: 'template',
				description: 'Use a message template stored on the mNotify account',
			},
		],
		default: 'text',
		displayOptions: {
			show: {
				resource: ['sms'],
				operation: ['sendGroup'],
			},
		},
		description: 'Whether the message comes from this node or from a stored message template',
	},
	{
		displayName: 'Message',
		name: 'message',
		type: 'string',
		typeOptions: {
			rows: 4,
		},
		default: '',
		placeholder: 'Your message here',
		displayOptions: {
			show: {
				resource: ['sms'],
				operation: ['send'],
			},
		},
		description:
			'Message body. Anything longer than 160 characters is split into several parts and charged per part.',
	},
	{
		displayName: 'Message',
		name: 'groupMessage',
		type: 'string',
		typeOptions: {
			rows: 4,
		},
		default: '',
		placeholder: 'Your message here',
		displayOptions: {
			show: {
				resource: ['sms'],
				operation: ['sendGroup'],
				messageSource: ['text'],
			},
		},
		description:
			'Message body. Anything longer than 160 characters is split into several parts and charged per part.',
	},
	{
		displayName: 'Message Template Name or ID',
		name: 'messageId',
		type: 'options',
		typeOptions: {
			loadOptionsMethod: 'getTemplates',
		},
		default: '',
		displayOptions: {
			show: {
				resource: ['sms'],
				operation: ['sendGroup'],
				messageSource: ['template'],
			},
		},
		description:
			'Message template to send. Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.',
	},
	senderIdField,
	{
		displayName: 'Additional Fields',
		name: 'smsAdditionalFields',
		type: 'collection',
		placeholder: 'Add Field',
		default: {},
		displayOptions: {
			show: showOnlyForSms,
		},
		options: schedulingFields,
	},
];

async function sendSms(this: IExecuteFunctions, itemIndex: number): Promise<IDataObject[]> {
	const recipients = splitRecipients(this.getNodeParameter('recipients', itemIndex, '') as string);
	if (recipients.length === 0) {
		throw new NodeOperationError(this.getNode(), 'No destination number given.', {
			itemIndex,
			description: 'Add at least one phone number to Phone Numbers.',
		});
	}

	const message = String(this.getNodeParameter('message', itemIndex, '')).trim();
	if (message === '') {
		throw new NodeOperationError(this.getNode(), 'The message is empty.', { itemIndex });
	}

	const sender = await resolveSenderId.call(
		this,
		this.getNodeParameter('senderId', itemIndex, '') as string,
	);

	const additionalFields = this.getNodeParameter('smsAdditionalFields', itemIndex, {}) as IDataObject;
	const isScheduled = additionalFields.isScheduled === true;
	const scheduleDate = isScheduled
		? requireMNotifyDateTime.call(this, additionalFields.scheduleDate, 'Schedule Date and Time')
		: '';

	// is_schedule and schedule_date are always sent, even when empty: that is the shape
	// mNotify documents and the shape its own account dashboard sends.
	const body: IDataObject = {
		recipient: recipients,
		sender,
		message,
		is_schedule: isScheduled,
		schedule_date: scheduleDate,
	};
	if (additionalFields.smsType === 'otp') {
		body.sms_type = 'otp';
	}

	const response = await mnotifyApiRequest.call(this, 'POST', mnPath('smsQuick'), { body });
	return [buildSendResult(response, sender)];
}

async function sendSmsToGroups(this: IExecuteFunctions, itemIndex: number): Promise<IDataObject[]> {
	const groupIds = this.getNodeParameter('groupIds', itemIndex, []) as Array<string | number>;
	if (!Array.isArray(groupIds) || groupIds.length === 0) {
		throw new NodeOperationError(this.getNode(), 'No group selected.', {
			itemIndex,
			description: 'Choose at least one group to send to.',
		});
	}

	const messageSource = this.getNodeParameter('messageSource', itemIndex, 'text') as string;
	const body: IDataObject = {
		group_id: groupIds.map((id) => String(id)),
	};

	if (messageSource === 'template') {
		const messageId = this.getNodeParameter('messageId', itemIndex, '') as string;
		if (String(messageId).trim() === '') {
			throw new NodeOperationError(this.getNode(), 'No message template selected.', { itemIndex });
		}
		body.message_id = String(messageId).trim();
	} else {
		const message = String(this.getNodeParameter('groupMessage', itemIndex, '')).trim();
		if (message === '') {
			throw new NodeOperationError(this.getNode(), 'The message is empty.', { itemIndex });
		}
		body.message = message;
	}

	const sender = await resolveSenderId.call(
		this,
		this.getNodeParameter('senderId', itemIndex, '') as string,
	);
	body.sender = sender;

	const additionalFields = this.getNodeParameter('smsAdditionalFields', itemIndex, {}) as IDataObject;
	const isScheduled = additionalFields.isScheduled === true;
	body.is_schedule = isScheduled;
	body.schedule_date = isScheduled
		? requireMNotifyDateTime.call(this, additionalFields.scheduleDate, 'Schedule Date and Time')
		: '';

	const response = await mnotifyApiRequest.call(this, 'POST', mnPath('smsGroup'), { body });
	return [buildSendResult(response, sender)];
}

/** Flattens the campaign summary mNotify returns into one workflow item. */
function buildSendResult(response: IDataObject, sender: string): IDataObject {
	const summary = (response.summary ?? {}) as IDataObject;
	return {
		campaignId: summary._id ?? '',
		type: summary.type ?? '',
		totalSent: summary.total_sent ?? 0,
		contacts: summary.contacts ?? 0,
		totalRejected: summary.total_rejected ?? 0,
		numbersSent: summary.numbers_sent ?? [],
		creditUsed: summary.credit_used ?? 0,
		creditLeft: summary.credit_left ?? 0,
		sender,
		status: response.status ?? '',
		message: response.message ?? '',
	};
}

export async function executeSmsOperation(
	this: IExecuteFunctions,
	operation: string,
	itemIndex: number,
): Promise<IDataObject[]> {
	switch (operation) {
		case 'send':
			return sendSms.call(this, itemIndex);
		case 'sendGroup':
			return sendSmsToGroups.call(this, itemIndex);
		default:
			throw new NodeOperationError(this.getNode(), `Unknown SMS operation "${operation}".`, {
				itemIndex,
			});
	}
}
