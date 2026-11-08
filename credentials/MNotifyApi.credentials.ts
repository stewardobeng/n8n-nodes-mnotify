import type {
	IAuthenticateGeneric,
	ICredentialTestRequest,
	ICredentialType,
	INodeProperties,
} from 'n8n-workflow';

/**
 * mNotify (BMS) API credential.
 *
 * mNotify authenticates with the API key as a **query parameter** (`?key=...`), not as a
 * header, so it cannot be modelled as a bearer/header credential. The `authenticate` block
 * below therefore injects `qs.key` into every request made through
 * `httpRequestWithAuthentication`, which also keeps the key out of the node code and lets
 * n8n apply its own credential redaction and domain rules.
 */
export class MNotifyApi implements ICredentialType {
	name = 'mNotifyApi';

	displayName = 'mNotify API';

	icon = { light: 'file:mnotify.svg', dark: 'file:mnotify.dark.svg' } as const;

	documentationUrl = 'https://developer.bms.africa/';

	authenticate: IAuthenticateGeneric = {
		type: 'generic',
		properties: {
			qs: {
				key: '={{$credentials.apiKey}}',
			},
		},
	};

	test: ICredentialTestRequest = {
		request: {
			baseURL: 'https://api.mnotify.com/api/',
			url: 'balance/sms',
			method: 'GET',
		},
	};

	properties: INodeProperties[] = [
		{
			displayName: 'API Key',
			name: 'apiKey',
			type: 'string',
			typeOptions: { password: true },
			default: '',
			required: true,
			description:
				'API key from the mNotify dashboard (app.bms.africa -> Settings -> Developer). Only an enabled key works.',
		},
		{
			displayName: 'Webhook Shared Secret',
			name: 'webhookSecret',
			type: 'string',
			typeOptions: { password: true },
			default: '',
			description: 'A unique, randomly generated secret for authenticating trigger callback URLs. Use at least 32 URL-safe characters.',
		},
		{
			displayName: 'Default Sender ID',
			name: 'senderId',
			type: 'string',
			default: '',
			placeholder: 'e.g. SteProOTP',
			description:
				'Sender ID used when a node leaves its own Sender ID empty. Must be registered and approved on the mNotify account and at most 11 characters. Hyphens in a Sender ID are rejected by mNotify, so use letters and digits only.',
		},
	];
}
