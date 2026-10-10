import type { IDataObject, IExecuteFunctions, INodeProperties } from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';

import type { PaginationChoice } from '../GenericFunctions';
import {
	emitRecords,
	formatMNotifyDateTime,
	fetchPaginated,
	mnotifyApiRequest,
	reportItemsOrReason,
	requireMNotifyDate,
	requireMNotifyDateTime,
	resolveSenderId,
	withoutEmptyValues,
} from '../GenericFunctions';
import { mnPath } from '../endpoints';

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
			'The Message ID of a delivery report row (the message_id column), not the campaign ID and not the row ID. mNotify answers "No delivery report found" for an ID it does not hold.',
	},
	{
		displayName: 'Return All',
		name: 'reportReturnAll',
		type: 'boolean',
		default: false,
		displayOptions: {
			show: {
				resource: ['report'],
				operation: ['getPeriodic', 'getCampaignReport', 'getCallReport'],
			},
		},
		description:
			'Whether to follow every page mNotify reports. Delivery reports are paginated (10 rows per page by default), so a single page misses most of the period.',
	},
	{
		displayName: 'Limit',
		name: 'reportLimit',
		type: 'number',
		typeOptions: {
			minValue: 1,
		},
		default: 50,
		displayOptions: {
			show: {
				resource: ['report'],
				operation: ['getPeriodic', 'getCampaignReport', 'getCallReport'],
				reportReturnAll: [false],
			},
		},
		description: 'Max number of report rows to return',
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
			const rows = await fetchPaginated.call(
				this,
				mnPath('campaignById', { campaignId }),
				withoutEmptyValues({ status }),
				['report', 'data'],
				readReportPagination.call(this, itemIndex),
			);
			return rows.length > 0
				? rows
				: [
						{
							found: false,
							campaignId,
							message: 'mNotify returned no delivery rows for this campaign.',
						},
					];
		}
		case 'getMessageStatus': {
			const messageId = this.getNodeParameter('reportMessageId', itemIndex, '') as string;
			const response = await mnotifyApiRequest.call(
				this,
				'GET',
				mnPath('statusById', { id: messageId }),
			);
			// This endpoint answers {status: success, message: 'No delivery report found ...',
			// report: []} for IDs it does not hold, so an empty list is turned into one item
			// that says so rather than leaving the workflow with no output.
			return reportItemsOrReason(response, ['report', 'data']);
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
			const rows = await fetchPaginated.call(
				this,
				mnPath('report'),
				{ from, to },
				['report', 'data'],
				readReportPagination.call(this, itemIndex),
			);
			return rows.length > 0
				? rows
				: [
						{
							found: false,
							from,
							to,
							message: 'mNotify has no delivery reports for this period.',
						},
					];
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
			const response = await mnotifyApiRequest.call(this, 'POST', mnPath('reportSummary'), {
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
			const rows = await fetchPaginated.call(
				this,
				mnPath('callsById', { campaignId }),
				withoutEmptyValues({ status }),
				['report', 'call', 'data'],
				readReportPagination.call(this, itemIndex),
			);
			return rows.length > 0
				? rows
				: [
						{
							found: false,
							campaignId,
							message: 'mNotify returned no call rows for this campaign.',
						},
					];
		}
		case 'getCallStatus': {
			const callMessageId = this.getNodeParameter('callMessageId', itemIndex, '') as string;
			const response = await mnotifyApiRequest.call(
				this,
				'GET',
				mnPath('callStatusById', { id: callMessageId }),
			);
			return reportItemsOrReason(response, ['call', 'report', 'data']);
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
			const rows = await fetchPaginated.call(
				this,
				mnPath('callPeriod'),
				{ from, to },
				['call', 'report', 'data'],
				readReportPagination.call(this, itemIndex),
			);
			return rows.length > 0
				? rows
				: [
						{
							found: false,
							from,
							to,
							message: 'mNotify has no call reports for this period.',
						},
					];
		}
		default:
			throw new NodeOperationError(this.getNode(), `Unknown report operation "${operation}".`, {
				itemIndex,
			});
	}
}

/** Reads the Return All / Limit pair for a paginated report read. */
function readReportPagination(this: IExecuteFunctions, itemIndex: number): PaginationChoice {
	return {
		returnAll: this.getNodeParameter('reportReturnAll', itemIndex, false) as boolean,
		limit: this.getNodeParameter('reportLimit', itemIndex, 50) as number,
	};
}

/** mNotify's summary endpoint wants `YYYY-MM-DD HH:MM:SS`. */
function withSeconds(value: string): string {
	const formatted = formatMNotifyDateTime(value);
	return formatted === null ? value : `${formatted}:00`;
}
