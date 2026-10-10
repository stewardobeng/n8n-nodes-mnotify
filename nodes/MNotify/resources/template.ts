import type { IDataObject, IExecuteFunctions, INodeProperties } from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';

import { emitRecords, mnotifyApiRequest, withoutEmptyValues } from '../GenericFunctions';
import { mnPath } from '../endpoints';

const showOnlyForTemplates = { resource: ['template'] };

export const templateDescription: INodeProperties[] = [
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: {
			show: showOnlyForTemplates,
		},
		options: [
			{
				name: 'Create',
				value: 'create',
				action: 'Create a message template',
				description: 'Store a reusable message body on the mNotify account',
			},
			{
				name: 'Delete',
				value: 'delete',
				action: 'Delete a message template',
				description: 'Remove a message template from the account',
			},
			{
				name: 'Get',
				value: 'get',
				action: 'Get a message template',
				description: 'Retrieve one message template by ID',
			},
			{
				name: 'Get Many',
				value: 'getAll',
				action: 'Get many message templates',
				description: 'List the message templates on the account',
			},
			{
				name: 'Update',
				value: 'update',
				action: 'Update a message template',
				description: 'Change the title or body of a stored message template',
			},
		],
		default: 'getAll',
	},
	{
		displayName: 'Template ID',
		name: 'templateId',
		type: 'string',
		default: '',
		required: true,
		displayOptions: {
			show: {
				resource: ['template'],
				operation: ['get', 'update', 'delete'],
			},
		},
		description: 'ID of the message template, as returned when it was created',
	},
	{
		displayName: 'Template Name',
		name: 'templateTitle',
		type: 'string',
		default: '',
		displayOptions: {
			show: {
				resource: ['template'],
				operation: ['create', 'update'],
			},
		},
		description: 'Short name for the template, used to find it again in the mNotify dashboard',
	},
	{
		displayName: 'Template Body',
		name: 'templateBody',
		type: 'string',
		typeOptions: {
			rows: 4,
		},
		default: '',
		displayOptions: {
			show: {
				resource: ['template'],
				operation: ['create', 'update'],
			},
		},
		description:
			'Message body. mNotify substitutes [fname], [lname] and [fullname] with the contact\'s names when the template is used for a group send.',
	},
];

export async function executeTemplateOperation(
	this: IExecuteFunctions,
	operation: string,
	itemIndex: number,
): Promise<IDataObject[]> {
	switch (operation) {
		case 'getAll': {
			const response = await mnotifyApiRequest.call(this, 'GET', mnPath('template'));
			return emitRecords(response, ['template_list', 'data']);
		}
		case 'get': {
			const templateId = this.getNodeParameter('templateId', itemIndex, '') as string;
			const response = await mnotifyApiRequest.call(this, 'GET', mnPath('templateById', { id: templateId }));
			return emitRecords(response, ['template_list', 'template', 'data']);
		}
		case 'create': {
			const body = withoutEmptyValues({
				title: this.getNodeParameter('templateTitle', itemIndex, '') as string,
				body: this.getNodeParameter('templateBody', itemIndex, '') as string,
			});
			if (!body.body) {
				throw new NodeOperationError(this.getNode(), 'The template body is empty.', { itemIndex });
			}
			const response = await mnotifyApiRequest.call(this, 'POST', mnPath('template'), { body });
			return [{ templateId: response._id ?? '', status: response.status ?? '', ...body }];
		}
		case 'update': {
			const templateId = this.getNodeParameter('templateId', itemIndex, '') as string;
			// mNotify validates the id against the URL, so it must be in both places.
			const body = withoutEmptyValues({
				id: templateId,
				title: this.getNodeParameter('templateTitle', itemIndex, '') as string,
				body: this.getNodeParameter('templateBody', itemIndex, '') as string,
			});
			const response = await mnotifyApiRequest.call(
				this,
				'PUT',
				mnPath('templateById', { id: templateId }),
				{ body },
			);
			return [{ templateId, status: response.status ?? '', message: response.message ?? '' }];
		}
		case 'delete': {
			const templateId = this.getNodeParameter('templateId', itemIndex, '') as string;
			const response = await mnotifyApiRequest.call(
				this,
				'DELETE',
				mnPath('templateById', { id: templateId }),
			);
			return [{ templateId, status: response.status ?? '', message: response.message ?? '' }];
		}
		default:
			throw new NodeOperationError(this.getNode(), `Unknown template operation "${operation}".`, {
				itemIndex,
			});
	}
}
