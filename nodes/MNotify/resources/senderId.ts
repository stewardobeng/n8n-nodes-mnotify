import type { IDataObject, IExecuteFunctions, INodeProperties } from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';

import { mnotifyApiRequest } from '../GenericFunctions';

const showOnlyForSenderIds = { resource: ['senderId'] };

export const senderIdDescription: INodeProperties[] = [
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: {
			show: showOnlyForSenderIds,
		},
		options: [
			{
				name: 'Get Status',
				value: 'getStatus',
				action: 'Get the status of a sender ID',
				description: 'Check whether a Sender ID is approved, pending or rejected',
			},
			{
				name: 'Register',
				value: 'register',
				action: 'Register a sender ID',
				description: 'Request a new Sender ID from mNotify',
			},
		],
		default: 'getStatus',
	},
	{
		displayName: 'Sender ID',
		name: 'senderName',
		type: 'string',
		default: '',
		required: true,
		placeholder: 'e.g. SteProOTP',
		displayOptions: {
			show: showOnlyForSenderIds,
		},
		description:
			'Sender ID to register or look up. At most 11 characters, letters and digits only: mNotify rejects a Sender ID containing a hyphen.',
	},
	{
		displayName: 'Purpose',
		name: 'senderPurpose',
		type: 'string',
		default: '',
		required: true,
		placeholder: 'e.g. Sending delivery notices to my clients',
		displayOptions: {
			show: {
				resource: ['senderId'],
				operation: ['register'],
			},
		},
		description:
			'Why this Sender ID is needed. The registered purpose decides which traffic the gateway lets through, so describe the real use (for example one-time codes, newsletters, payment reminders).',
	},
];

export async function executeSenderIdOperation(
	this: IExecuteFunctions,
	operation: string,
	itemIndex: number,
): Promise<IDataObject[]> {
	const senderName = (this.getNodeParameter('senderName', itemIndex, '') as string).trim();

	if (senderName === '') {
		throw new NodeOperationError(this.getNode(), 'No Sender ID given.', { itemIndex });
	}
	if (senderName.length > 11) {
		throw new NodeOperationError(
			this.getNode(),
			`The Sender ID "${senderName}" is longer than 11 characters.`,
			{ itemIndex, description: 'mNotify allows at most 11 characters in a Sender ID.' },
		);
	}

	switch (operation) {
		case 'getStatus': {
			// Trailing slash matters: mNotify answers on /senderid/status/ .
			const response = await mnotifyApiRequest.call(this, 'POST', 'senderid/status/', {
				body: { sender_name: senderName },
			});
			const summary = (response.summary ?? {}) as IDataObject;
			const status = String(summary.status ?? summary.sender_status ?? '');
			return [
				{
					senderName: String(summary.sender_name ?? senderName),
					status,
					approved: status.toLowerCase() === 'approved',
					purpose: String(summary.purpose ?? ''),
					message: response.message ?? '',
				},
			];
		}
		case 'register': {
			const purpose = (this.getNodeParameter('senderPurpose', itemIndex, '') as string).trim();
			const response = await mnotifyApiRequest.call(this, 'POST', 'senderid/register', {
				body: { sender_name: senderName, purpose },
			});
			const summary = (response.summary ?? {}) as IDataObject;
			return [
				{
					senderName: String(summary.sender_name ?? senderName),
					purpose: String(summary.purpose ?? purpose),
					status: String(summary.status ?? 'Pending'),
					message: response.message ?? '',
				},
			];
		}
		default:
			throw new NodeOperationError(this.getNode(), `Unknown Sender ID operation "${operation}".`, {
				itemIndex,
			});
	}
}
