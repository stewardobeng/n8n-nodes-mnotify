import type { IDataObject, IExecuteFunctions, INodeProperties } from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';

import { mnotifyApiRequest } from '../GenericFunctions';

const showOnlyForAccount = { resource: ['account'] };

export const accountDescription: INodeProperties[] = [
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: {
			show: showOnlyForAccount,
		},
		options: [
			{
				name: 'Get SMS Balance',
				value: 'getSmsBalance',
				action: 'Get the SMS balance',
				description: 'Read the SMS credit balance, bonus credits and wallet balance',
			},
			{
				name: 'Get Voice Balance',
				value: 'getVoiceBalance',
				action: 'Get the voice balance',
				description: 'Read the voice call credit balance',
			},
		],
		default: 'getSmsBalance',
	},
	{
		displayName:
			'mNotify keeps three purses: SMS credits, bonus credits and the main wallet. An SMS Type of OTP is billed from the main wallet, so a healthy SMS balance alone does not mean an OTP campaign can go out.',
		name: 'accountBalanceNotice',
		type: 'notice',
		default: '',
		displayOptions: {
			show: showOnlyForAccount,
		},
	},
];

function toNumber(value: unknown): number | null {
	if (value === null || value === undefined || value === '') {
		return null;
	}
	const parsed = Number(value);
	return Number.isFinite(parsed) ? parsed : null;
}

export async function executeAccountOperation(
	this: IExecuteFunctions,
	operation: string,
	itemIndex: number,
): Promise<IDataObject[]> {
	switch (operation) {
		case 'getSmsBalance': {
			const response = await mnotifyApiRequest.call(this, 'GET', 'balance/sms');
			return [
				{
					balance: toNumber(response.balance),
					bonus: toNumber(response.bonus ?? response.bonus_balance),
					wallet: toNumber(response.wallet),
					status: response.status ?? '',
				},
			];
		}
		case 'getVoiceBalance': {
			const response = await mnotifyApiRequest.call(this, 'GET', 'balance/voice');
			return [
				{
					balance: toNumber(response.balance),
					status: response.status ?? '',
				},
			];
		}
		default:
			throw new NodeOperationError(this.getNode(), `Unknown account operation "${operation}".`, {
				itemIndex,
			});
	}
}
