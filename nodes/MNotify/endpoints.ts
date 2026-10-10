/**
 * Every mNotify endpoint this package calls, in one place.
 *
 * Each entry is relative to `https://api.mnotify.com/api/` and marks its parameters with
 * `:name`. Keeping them here means the paths can be audited (and probed) as a set, instead of
 * being scattered as string literals through the resources.
 *
 * Verification: `test/endpoints.test.mjs` probes every entry here against the live API and
 * fails if one stops existing. `node test/tools/probe-endpoints.mjs` refreshes the recorded
 * result in `test/fixtures/live-endpoints.json`.
 */
export const MN_ENDPOINTS = {
	// SMS
	smsQuick: 'sms/quick',
	smsGroup: 'sms/group',
	// Scheduled messages
	scheduled: 'scheduled',
	scheduledById: 'scheduled/:id',
	// Voice
	voiceQuick: 'voice/quick',
	voiceGroup: 'voice/group',
	// Sender IDs
	senderIdRegister: 'senderid/register',
	senderIdStatus: 'senderid/status/',
	// Message templates
	template: 'template',
	templateById: 'template/:id',
	// Groups
	group: 'group',
	groupById: 'group/:id',
	// Contacts
	contact: 'contact',
	contactById: 'contact/:id',
	contactByGroup: 'contact/group/:groupId',
	// Balances
	balanceSms: 'balance/sms',
	balanceVoice: 'balance/voice',
	// Reports
	campaignById: 'campaign/:campaignId',
	statusById: 'status/:id',
	report: 'report',
	reportSummary: 'report/summary',
	callsById: 'calls/:campaignId',
	callStatusById: 'call-status/:id',
	callPeriod: 'call-period',
	// IVR
	initiateIvrCall: 'initiate-ivr-call',
	ivrScenarios: 'ivr-scenarios',
	ivrScenarioById: 'ivr-scenarios/:id',
	ivrScenarioSend: 'ivr-scenarios/send',
	ivrScenariosFlow: 'ivr-scenarios/flow',
	ivrScenariosFlowById: 'ivr-scenarios/flow/:id',
} as const;

export type MnEndpointKey = keyof typeof MN_ENDPOINTS;

/**
 * Builds a request path, substituting `:params` with URL-encoded values.
 *
 * Throws when a parameter is missing, which would otherwise send a literal `:id` to mNotify.
 */
export function mnPath(key: MnEndpointKey, params: Record<string, string | number> = {}): string {
	const template: string = MN_ENDPOINTS[key];
	return template.replace(/:([A-Za-z]+)/g, (_match, name: string) => {
		const value = params[name];
		if (value === undefined) {
			throw new Error(`Missing value for ":${name}" in the mNotify path "${template}"`);
		}
		return encodeURIComponent(String(value));
	});
}
