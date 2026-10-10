import type { IDataObject, IExecuteFunctions, INodeProperties } from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';

import {
	emitRecords,
	mnotifyApiRequest,
	requireMNotifyDateTime,
	resolveSenderId,
} from '../GenericFunctions';
import { mnPath } from '../endpoints';

const showOnlyForScheduled = { resource: ['scheduled'] };

export const scheduledDescription: INodeProperties[] = [
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: {
			show: showOnlyForScheduled,
		},
		options: [
			{
				name: 'Get Many',
				value: 'getAll',
				action: 'Get many scheduled messages',
				description: 'List the messages mNotify is holding for later delivery',
			},
			{
				name: 'Update',
				value: 'update',
				action: 'Update a scheduled message',
				description: 'Change the text, sender or send time of a held message',
			},
		],
		default: 'getAll',
	},
	{
		displayName: 'Scheduled Message ID',
		name: 'scheduledId',
		type: 'string',
		default: '',
		required: true,
		displayOptions: {
			show: {
				resource: ['scheduled'],
				operation: ['update'],
			},
		},
		description:
			'ID of the held message. Use the Get Many operation to list the IDs mNotify has for the account.',
	},
	{
		displayName: 'Sender ID',
		name: 'scheduledSenderId',
		type: 'string',
		default: '',
		displayOptions: {
			show: {
				resource: ['scheduled'],
				operation: ['update'],
			},
		},
		description:
			'Sender ID to send the message from. Leave empty to use the default Sender ID of the credential.',
	},
	{
		displayName: 'Message',
		name: 'scheduledMessage',
		type: 'string',
		typeOptions: {
			rows: 4,
		},
		default: '',
		displayOptions: {
			show: {
				resource: ['scheduled'],
				operation: ['update'],
			},
		},
		description: 'New message body',
	},
	{
		displayName: 'Send At',
		name: 'scheduledDate',
		type: 'dateTime',
		default: '',
		displayOptions: {
			show: {
				resource: ['scheduled'],
				operation: ['update'],
			},
		},
		description:
			'New send time, in the workflow timezone. The value is passed to mNotify as-is and read as Ghana time (GMT).',
	},
];

export async function executeScheduledOperation(
	this: IExecuteFunctions,
	operation: string,
	itemIndex: number,
): Promise<IDataObject[]> {
	switch (operation) {
		case 'getAll': {
			const response = await mnotifyApiRequest.call(this, 'GET', mnPath('scheduled'));
			return emitRecords(response, ['summary', 'scheduled_list', 'data']);
		}
		case 'update': {
			const scheduledId = this.getNodeParameter('scheduledId', itemIndex, '') as string;
			const sender = await resolveSenderId.call(
				this,
				this.getNodeParameter('scheduledSenderId', itemIndex, '') as string,
			);
			const message = String(this.getNodeParameter('scheduledMessage', itemIndex, '')).trim();
			if (message === '') {
				throw new NodeOperationError(this.getNode(), 'The message is empty.', { itemIndex });
			}
			// mNotify documents the field as both scheduled_date and schedule_date; the value
			// sent here follows mNotify's own runnable example (schedule_date) because the
			// example is what a working integration used.
			const body: IDataObject = {
				sender,
				message,
				schedule_date: requireMNotifyDateTime.call(
					this,
					this.getNodeParameter('scheduledDate', itemIndex, ''),
					'Send At',
				),
			};
			const response = await mnotifyApiRequest.call(
				this,
				'PUT',
				mnPath('scheduledById', { id: scheduledId }),
				{ body },
			);
			const summary = (response.summary ?? {}) as IDataObject;
			return [
				{
					scheduledId: String(summary.id ?? scheduledId),
					sender: String(summary.sender_id ?? sender),
					message: String(summary.message ?? message),
					scheduleDate: String(summary.schedule_date ?? body.schedule_date),
					status: response.status ?? '',
				},
			];
		}
		default:
			throw new NodeOperationError(this.getNode(), `Unknown scheduled operation "${operation}".`, {
				itemIndex,
			});
	}
}
