import type { IDataObject, IExecuteFunctions, INodeProperties } from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';

import { emitRecords, mnotifyApiRequest, withoutEmptyValues } from '../GenericFunctions';
import { mnPath } from '../endpoints';

const showOnlyForGroups = { resource: ['group'] };

export const groupDescription: INodeProperties[] = [
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: {
			show: showOnlyForGroups,
		},
		options: [
			{
				name: 'Create',
				value: 'create',
				action: 'Create a group',
				description: 'Add a new contact group to the mNotify account',
			},
			{
				name: 'Delete',
				value: 'delete',
				action: 'Delete a group',
				description: 'Remove a group and every contact inside it',
			},
			{
				name: 'Get',
				value: 'get',
				action: 'Get a group',
				description: 'Retrieve one group by ID',
			},
			{
				name: 'Get Many',
				value: 'getAll',
				action: 'Get many groups',
				description: 'List the contact groups on the account',
			},
			{
				name: 'Update',
				value: 'update',
				action: 'Update a group',
				description: 'Rename a contact group',
			},
		],
		default: 'getAll',
	},
	{
		displayName: 'Group ID',
		name: 'groupId',
		type: 'string',
		default: '',
		required: true,
		displayOptions: {
			show: {
				resource: ['group'],
				operation: ['get', 'update', 'delete'],
			},
		},
		description:
			'ID of the group. Choose from the list where a group picker is offered, or specify the ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.',
	},
	{
		displayName: 'Name',
		name: 'groupName',
		type: 'string',
		default: '',
		displayOptions: {
			show: {
				resource: ['group'],
				operation: ['create', 'update'],
			},
		},
		description: 'Name of the group',
	},
];

export async function executeGroupOperation(
	this: IExecuteFunctions,
	operation: string,
	itemIndex: number,
): Promise<IDataObject[]> {
	switch (operation) {
		case 'getAll': {
			const response = await mnotifyApiRequest.call(this, 'GET', mnPath('group'));
			return emitRecords(response, ['group_list', 'data']);
		}
		case 'get': {
			const groupId = this.getNodeParameter('groupId', itemIndex, '') as string;
			const response = await mnotifyApiRequest.call(this, 'GET', mnPath('groupById', { id: groupId }));
			return emitRecords(response, ['group', 'group_list', 'data']);
		}
		case 'create': {
			const body = withoutEmptyValues({
				group_name: this.getNodeParameter('groupName', itemIndex, '') as string,
			});
			if (!body.group_name) {
				throw new NodeOperationError(this.getNode(), 'The group name is empty.', { itemIndex });
			}
			const response = await mnotifyApiRequest.call(this, 'POST', mnPath('group'), { body });
			return [{ groupId: response._id ?? '', groupName: body.group_name, status: response.status ?? '' }];
		}
		case 'update': {
			const groupId = this.getNodeParameter('groupId', itemIndex, '') as string;
			const body = withoutEmptyValues({
				id: groupId,
				group_name: this.getNodeParameter('groupName', itemIndex, '') as string,
			});
			const response = await mnotifyApiRequest.call(
				this,
				'PUT',
				mnPath('groupById', { id: groupId }),
				{ body },
			);
			return [{ groupId, status: response.status ?? '', message: response.message ?? '' }];
		}
		case 'delete': {
			const groupId = this.getNodeParameter('groupId', itemIndex, '') as string;
			const response = await mnotifyApiRequest.call(
				this,
				'DELETE',
				mnPath('groupById', { id: groupId }),
			);
			return [{ groupId, status: response.status ?? '', message: response.message ?? '' }];
		}
		default:
			throw new NodeOperationError(this.getNode(), `Unknown group operation "${operation}".`, {
				itemIndex,
			});
	}
}
