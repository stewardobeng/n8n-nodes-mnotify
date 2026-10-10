import type { IDataObject, IExecuteFunctions, INodeProperties } from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';

import {
	emitRecords,
	formatMNotifyDateTime,
	mnotifyApiRequest,
	requireMNotifyDate,
	requireMNotifyDateTime,
	resolveSenderId,
	withoutEmptyValues,
} from '../GenericFunctions';

const showOnlyForReports = { resource: ['report'] };

const smsStatusOptions = [
	{ name: 'All', value: '' },
	{ name: 'Delivered', value: 'delivered' },
	{ name: 'Undelivered', value: 'undelivered' },
	{ name: 'Submitted', value: 'submitted' },
	{ name: 'Failed', value: 'failed' },
	{ name: 'Rejected', value: 'rejected' },
];

const callStatusOptions = [
	{ name: 'All', value: '' },
	{ name: 'Pending', value: 'pending' },
	{ name: 'Received', value: 'received' },
	{ name: 'Missed', value: 'missed' },
];

const dateRangeFields = (operation: string, fromName: string, toName: string): INodeProperties[] => [
	{
		displayName: 'From',
		name: fromName,
		type: 'dateTime',
		default: '',
		required: true,
		displayOptions: {
			show: {
				resource: ['report'],
				operation: [operation],
			},
		},
		description: 'Start of the range. mNotify reads this as Ghana time (GMT).',
	},
	{
		displayName: 'To',
		name: toName,
		type: 'dateTime',
		default: '',
		required: true,
		displayOptions: {
			show: {
				resource: ['report'],
				operation: [operation],
			},
		},
		description: 'End of the range. mNotify reads this as Ghana time (GMT).',
	},
];

export const reportDescription: INodeProperties[] = [
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: {
			show: showOnlyForReports,
		},
		options: [
			{
				name: 'Get Call Report',
				value: 'getCallReport',
				action: 'Get a voice call report',
				description: 'List the calls placed in one voice campaign with their status',
			},
			{
				name: 'Get Call Status',
				value: 'getCallStatus',
				action: 'Get the status of one voice call',
				description: 'Retrieve one call record by its report ID',
			},
			{
				name: 'Get Delivery Report',
				value: 'getCampaignReport',
				action: 'Get a delivery report',
				description: 'List the per-recipient delivery results of one SMS campaign',
			},
			{
				name: 'Get Message Status',
				value: 'getMessageStatus',
				action: 'Get the status of one SMS',
				description: 'Retrieve one delivery record by its report ID',
			},
			{
				name: 'Get Periodic Call Report',
				value: 'getCallPeriod',
				action: 'Get calls sent between two dates',
				description: 'List voice calls placed in a date range',
			},
			{
				name: 'Get Periodic Delivery Report',
				value: 'getPeriodic',
				action: 'Get messages sent between two dates',
				description: 'List SMS delivery results in a date range',
			},
			{
				name: 'Get Summary',
				value: 'getSummary',
				action: 'Get a delivery summary',
				description: 'Count delivery results for one Sender ID over a range of up to 30 days',
			},
		],
		default: 'getCampaignReport',
	},
	{
		displayName: 'Campaign ID',
		name: 'reportCampaignId',
		type: 'string',
		default: '',
		required: true,
		displayOptions: {
			show: {
				resource: ['report'],
				operation: ['getCampaignReport'],
			},
		},
		description:
			'Campaign ID returned when the SMS was sent (also called the message ID). The Send SMS operation outputs it as Campaign ID.',
	},
	{
		displayName: 'Status',
		name: 'reportSmsStatus',
		type: 'options',
		options: smsStatusOptions,
		default: '',
		displayOptions: {
			show: {
				resource: ['report'],
				operation: ['getCampaignReport'],
			},
		},
		description: 'Only return recipients with this delivery status',
	},
	{
		displayName: 'Message Status ID',
		name: 'reportMessageId',
		type: 'string',
		default: '',
		required: true,
		displayOptions: {
			show: {
				resource: ['report'],
				operation: ['getMessageStatus'],
			},
		},
		description:
			'ID of a single delivery record. It is not the campaign ID: read it from the Report ID field of a delivery report row.',
	},
	...dateRangeFields('getPeriodic', 'periodicFrom', 'periodicTo'),
	{
		displayName: 'Sender ID',
		name: 'summarySenderId',
		type: 'string',
		default: '',
		displayOptions: {
			show: {
				resource: ['report'],
				operation: ['getSummary'],
			},
		},
		description:
			'Sender ID to summarise. Leave empty to use the default Sender ID of the credential.',
	},
	{
		displayName: 'From',
		name: 'summaryFrom',
		type: 'dateTime',
		default: '',
		required: true,
		displayOptions: {
			show: {
				resource: ['report'],
				operation: ['getSummary'],
			},
		},
		description: 'Start of the range. The span may not exceed 30 days.',
	},
	{
		displayName: 'To',
		name: 'summaryTo',
		type: 'dateTime',
		default: '',
		required: true,
		displayOptions: {
			show: {
				resource: ['report'],
				operation: ['getSummary'],
			},
		},
		description: 'End of the range. The span may not exceed 30 days.',
	},
	{
		displayName: 'Call Campaign ID',
		name: 'callCampaignId',
		type: 'string',
		default: '',
		required: true,
		displayOptions: {
			show: {
				resource: ['report'],
				operation: ['getCallReport'],
			},
		},
		description: 'Campaign ID returned when the voice call was sent',
	},
	{
		displayName: 'Status',
		name: 'callStatus',
		type: 'options',
		options: callStatusOptions,
		default: '',
		displayOptions: {
			show: {
				resource: ['report'],
				operation: ['getCallReport'],
			},
		},
		description: 'Only return calls with this status',
	},
	{
		displayName: 'Call Status ID',
		name: 'callMessageId',
		type: 'string',
		default: '',
		required: true,
		displayOptions: {
			show: {
				resource: ['report'],
				operation: ['getCallStatus'],
			},
		},
		description: 'ID of a single call record, read from a call report row',
	},
	...dateRangeFields('getCallPeriod', 'callPeriodFrom', 'callPeriodTo'),
];

export async function executeReportOperation(
	this: IExecuteFunctions,
	operation: string,
	itemIndex: number,
): Promise<IDataObject[]> {
	switch (operation) {
		case 'getCampaignReport': {
			const campaignId = this.getNodeParameter('reportCampaignId', itemIndex, '') as string;
			const status = String(this.getNodeParameter('reportSmsStatus', itemIndex, '') ?? '').trim();
			// The live API has no /campaign/<id>/<status> route; the status is passed as a query
			// parameter instead and is simply ignored when empty.
			const response = await mnotifyApiRequest.call(
				this,
				'GET',
				`campaign/${encodeURIComponent(campaignId)}`,
				{ qs: withoutEmptyValues({ status }) },
			);
			return emitRecords(response, ['report', 'data']);
		}
		case 'getMessageStatus': {
			const messageId = this.getNodeParameter('reportMessageId', itemIndex, '') as string;
			const response = await mnotifyApiRequest.call(
				this,
				'GET',
				`status/${encodeURIComponent(messageId)}`,
			);
			return emitRecords(response, ['report', 'data']);
		}
		case 'getPeriodic': {
			const from = requireMNotifyDate.call(
				this,
				this.getNodeParameter('periodicFrom', itemIndex, ''),
				'From',
			);
			const to = requireMNotifyDate.call(
				this,
				this.getNodeParameter('periodicTo', itemIndex, ''),
				'To',
			);
			const response = await mnotifyApiRequest.call(this, 'GET', 'report', { qs: { from, to } });
			return emitRecords(response, ['report', 'data']);
		}
		case 'getSummary': {
			const senderId = await resolveSenderId.call(
				this,
				this.getNodeParameter('summarySenderId', itemIndex, '') as string,
			);
			const from = requireMNotifyDateTime.call(
				this,
				this.getNodeParameter('summaryFrom', itemIndex, ''),
				'From',
			);
			const to = requireMNotifyDateTime.call(
				this,
				this.getNodeParameter('summaryTo', itemIndex, ''),
				'To',
			);
			const response = await mnotifyApiRequest.call(this, 'POST', 'report/summary', {
				body: {
					sender_id: senderId,
					// This endpoint wants seconds, unlike the other mNotify date fields.
					from: withSeconds(from),
					to: withSeconds(to),
				},
			});
			const records = emitRecords(response, ['report', 'data']);
			return records.map((record) => ({ sender_id: senderId, total: response.total ?? null, ...record }));
		}
		case 'getCallReport': {
			const campaignId = this.getNodeParameter('callCampaignId', itemIndex, '') as string;
			const status = String(this.getNodeParameter('callStatus', itemIndex, '') ?? '').trim();
			const response = await mnotifyApiRequest.call(
				this,
				'GET',
				`calls/${encodeURIComponent(campaignId)}`,
				{ qs: withoutEmptyValues({ status }) },
			);
			return emitRecords(response, ['report', 'call', 'data']);
		}
		case 'getCallStatus': {
			const callMessageId = this.getNodeParameter('callMessageId', itemIndex, '') as string;
			const response = await mnotifyApiRequest.call(
				this,
				'GET',
				`call-status/${encodeURIComponent(callMessageId)}`,
			);
			return emitRecords(response, ['call', 'report', 'data']);
		}
		case 'getCallPeriod': {
			const from = requireMNotifyDate.call(
				this,
				this.getNodeParameter('callPeriodFrom', itemIndex, ''),
				'From',
			);
			const to = requireMNotifyDate.call(
				this,
				this.getNodeParameter('callPeriodTo', itemIndex, ''),
				'To',
			);
			const response = await mnotifyApiRequest.call(this, 'GET', 'call-period', {
				qs: { from, to },
			});
			return emitRecords(response, ['call', 'report', 'data']);
		}
		default:
			throw new NodeOperationError(this.getNode(), `Unknown report operation "${operation}".`, {
				itemIndex,
			});
	}
}

/** mNotify's summary endpoint wants `YYYY-MM-DD HH:MM:SS`. */
function withSeconds(value: string): string {
	const formatted = formatMNotifyDateTime(value);
	return formatted === null ? value : `${formatted}:00`;
}
