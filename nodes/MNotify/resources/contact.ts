import type { IDataObject, IExecuteFunctions, INodeProperties } from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';

import type { PaginationChoice } from '../GenericFunctions';
import { emitRecords, fetchPaginated, mnotifyApiRequest, withoutEmptyValues } from '../GenericFunctions';
import { mnPath } from '../endpoints';

const showOnlyForContacts = { resource: ['contact'] };

const contactDetailFields: INodeProperties[] = [
	{
		displayName: 'Phone Number',
		name: 'contactPhone',
		type: 'string',
		default: '',
		placeholder: '0241234567',
		displayOptions: {
			show: {
				resource: ['contact'],
				operation: ['create', 'update'],
			},
		},
		description: 'Phone number of the contact, in local or international format',
	},
	{
		displayName: 'Title',
		name: 'contactTitle',
		type: 'string',
		default: '',
		placeholder: 'e.g. Mr, Dr, Miss',
		displayOptions: {
			show: {
				resource: ['contact'],
				operation: ['create', 'update'],
			},
		},
		description: 'Honorific for the contact',
	},
	{
		displayName: 'First Name',
		name: 'contactFirstName',
		type: 'string',
		default: '',
		displayOptions: {
			show: {
				resource: ['contact'],
				operation: ['create', 'update'],
			},
		},
		description: 'First name of the contact. Replaces [fname] in a message template.',
	},
	{
		displayName: 'Last Name',
		name: 'contactLastName',
		type: 'string',
		default: '',
		displayOptions: {
			show: {
				resource: ['contact'],
				operation: ['create', 'update'],
			},
		},
		description: 'Last name of the contact. Replaces [lname] in a message template.',
	},
	{
		displayName: 'Email',
		name: 'contactEmail',
		type: 'string',
		placeholder: 'name@example.com',
		default: '',
		displayOptions: {
			show: {
				resource: ['contact'],
				operation: ['create', 'update'],
			},
		},
		description: 'Email address of the contact',
	},
	{
		displayName: 'Date of Birth',
		name: 'contactDob',
		type: 'string',
		default: '',
		placeholder: 'YYYY-MM-DD',
		displayOptions: {
			show: {
				resource: ['contact'],
				operation: ['create', 'update'],
			},
		},
		description: 'Date of birth of the contact, as YYYY-MM-DD',
	},
];

export const contactDescription: INodeProperties[] = [
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: {
			show: showOnlyForContacts,
		},
		options: [
			{
				name: 'Create',
				value: 'create',
				action: 'Create a contact',
				description: 'Add a contact to one of the groups on the account',
			},
			{
				name: 'Delete',
				value: 'delete',
				action: 'Delete a contact',
				description: 'Remove a contact from the mNotify account',
			},
			{
				name: 'Get',
				value: 'get',
				action: 'Get a contact',
				description: 'Retrieve one contact by ID',
			},
			{
				name: 'Get Many',
				value: 'getAll',
				action: 'Get many contacts',
				description: 'List every contact on the account',
			},
			{
				name: 'Get Many in Group',
				value: 'getByGroup',
				action: 'Get many contacts in a group',
				description: 'List the contacts that belong to one group',
			},
			{
				name: 'Update',
				value: 'update',
				action: 'Update a contact',
				description: 'Change the stored details of a contact',
			},
		],
		default: 'getAll',
	},
	{
		displayName: 'Contact ID',
		name: 'contactId',
		type: 'string',
		default: '',
		required: true,
		displayOptions: {
			show: {
				resource: ['contact'],
				operation: ['get', 'update', 'delete'],
			},
		},
		description: 'ID of the contact',
	},
	{
		displayName: 'Group Name or ID',
		name: 'contactGroupId',
		type: 'options',
		typeOptions: {
			loadOptionsMethod: 'getGroups',
		},
		default: '',
		required: true,
		displayOptions: {
			show: {
				resource: ['contact'],
				operation: ['getByGroup', 'create'],
			},
		},
		description:
			'Group to read from or add the contact to. Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.',
	},
	{
		displayName: 'Group Name or ID',
		name: 'contactUpdateGroupId',
		type: 'options',
		typeOptions: {
			loadOptionsMethod: 'getGroups',
		},
		default: '',
		displayOptions: {
			show: {
				resource: ['contact'],
				operation: ['update'],
			},
		},
		description: 'Group the contact should belong to. mNotify expects the group with every update, so pick it explicitly when moving a contact. Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.',
	},
	{
		displayName: 'Return All',
		name: 'contactReturnAll',
		type: 'boolean',
		default: false,
		displayOptions: {
			show: {
				resource: ['contact'],
				operation: ['getAll', 'getByGroup'],
			},
		},
		description:
			'Whether to follow every page mNotify reports. Contacts are paginated (10 per page by default), so a single page misses the rest of the list.',
	},
	{
		displayName: 'Limit',
		name: 'contactLimit',
		type: 'number',
		typeOptions: {
			minValue: 1,
		},
		default: 50,
		displayOptions: {
			show: {
				resource: ['contact'],
				operation: ['getAll', 'getByGroup'],
				contactReturnAll: [false],
			},
		},
		description: 'Max number of contacts to return',
	},
	...contactDetailFields,
];

function contactBody(this: IExecuteFunctions, itemIndex: number): IDataObject {
	return withoutEmptyValues({
		phone: (this.getNodeParameter('contactPhone', itemIndex, '') as string).trim(),
		title: (this.getNodeParameter('contactTitle', itemIndex, '') as string).trim(),
		firstname: (this.getNodeParameter('contactFirstName', itemIndex, '') as string).trim(),
		lastname: (this.getNodeParameter('contactLastName', itemIndex, '') as string).trim(),
		email: (this.getNodeParameter('contactEmail', itemIndex, '') as string).trim(),
		dob: (this.getNodeParameter('contactDob', itemIndex, '') as string).trim(),
	});
}

/** Reads the Return All / Limit pair for a paginated contact read. */
function readPaginationChoice(this: IExecuteFunctions, itemIndex: number): PaginationChoice {
	return {
		returnAll: this.getNodeParameter('contactReturnAll', itemIndex, false) as boolean,
		limit: this.getNodeParameter('contactLimit', itemIndex, 50) as number,
	};
}

export async function executeContactOperation(
	this: IExecuteFunctions,
	operation: string,
	itemIndex: number,
): Promise<IDataObject[]> {
	switch (operation) {
		case 'getAll': {
			return fetchPaginated.call(
				this,
				mnPath('contact'),
				{},
				['contacts_list', 'contact_list', 'data'],
				readPaginationChoice.call(this, itemIndex),
			);
		}
		case 'getByGroup': {
			const contactGroupId = this.getNodeParameter('contactGroupId', itemIndex, '') as string;
			return fetchPaginated.call(
				this,
				mnPath('contactByGroup', { groupId: contactGroupId }),
				{},
				['contacts_list', 'contact_list', 'contact', 'data'],
				readPaginationChoice.call(this, itemIndex),
			);
		}
		case 'get': {
			const contactId = this.getNodeParameter('contactId', itemIndex, '') as string;
			const response = await mnotifyApiRequest.call(
				this,
				'GET',
				mnPath('contactById', { id: contactId }),
			);
			return emitRecords(response, ['contact', 'contact_list', 'data']);
		}
		case 'create': {
			const contactGroupId = this.getNodeParameter('contactGroupId', itemIndex, '') as string;
			const body = contactBody.call(this, itemIndex);
			if (!body.phone) {
				throw new NodeOperationError(this.getNode(), 'The contact phone number is empty.', {
					itemIndex,
				});
			}
			const response = await mnotifyApiRequest.call(
				this,
				'POST',
				mnPath('contactByGroup', { groupId: contactGroupId }),
				{ body },
			);
			const created = (response.contact ?? {}) as IDataObject;
			return [
				{
					contactId: created._id ?? '',
					group_id: created._group_id ?? contactGroupId,
					...body,
					status: response.status ?? '',
				},
			];
		}
		case 'update': {
			const contactId = this.getNodeParameter('contactId', itemIndex, '') as string;
			const groupId = this.getNodeParameter('contactUpdateGroupId', itemIndex, '') as string;
			const body = withoutEmptyValues({
				id: contactId,
				group_id: String(groupId ?? '').trim(),
				...contactBody.call(this, itemIndex),
			});
			if (!body.group_id) {
				throw new NodeOperationError(this.getNode(), 'No group chosen for this contact.', {
					itemIndex,
					description:
						'mNotify expects the group with every contact update. Pick the Group field even when it is not changing.',
				});
			}
			const response = await mnotifyApiRequest.call(
				this,
				'PUT',
				mnPath('contactById', { id: contactId }),
				{ body },
			);
			return [{ contactId, status: response.status ?? '', message: response.message ?? '' }];
		}
		case 'delete': {
			const contactId = this.getNodeParameter('contactId', itemIndex, '') as string;
			// The documented /contact/<id>/<group_id> path does not exist on the live API;
			// DELETE /contact/<id> is the working route.
			const response = await mnotifyApiRequest.call(
				this,
				'DELETE',
				mnPath('contactById', { id: contactId }),
			);
			return [{ contactId, status: response.status ?? '', message: response.message ?? '' }];
		}
		default:
			throw new NodeOperationError(this.getNode(), `Unknown contact operation "${operation}".`, {
				itemIndex,
			});
	}
}
