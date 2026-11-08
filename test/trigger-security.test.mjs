import assert from 'node:assert/strict';
import { test } from 'node:test';
import { MNotifyTrigger } from '../dist/nodes/MNotifyTrigger/MNotifyTrigger.node.js';

const secret = 'aB3_7x9ZpL2mQ4rS6tV8wY0cD1eF5gH7';
function makeContext({ token = secret, configuredSecret = secret, callbackType = 'any', body = {}, query = {}, credentialError = false } = {}) {
	const response = { status: 0, body: '', writeHead(status) { this.status = status; }, end(body) { this.body = body; } };
	const context = {
		getBodyData: () => body,
		getQueryData: () => ({ ...query, ...(token === null ? {} : { mnotify_token: token }) }),
		getCredentials: async () => { if (credentialError) throw new Error('missing credential'); return { webhookSecret: configuredSecret }; },
		getNodeParameter: () => callbackType,
		getRequestObject: () => ({ method: 'POST' }),
		getResponseObject: () => response,
	};
	return { context, response };
}

test('valid secret and matching callback execute without leaking the token', async () => {
	const { context } = makeContext({ callbackType: 'ussdShared', body: { msisdn: '123', sequenceID: '1', mnotify_token: 'spoofed' } });
	const result = await new MNotifyTrigger().webhook.call(context);
	assert.equal(result.workflowData[0][0].json.callbackType, 'ussdShared');
	assert.equal(result.workflowData[0][0].json.msisdn, '123');
	assert.equal('mnotify_token' in result.workflowData[0][0].json, false);
	assert.equal('headers' in result.workflowData[0][0].json, false);
});

test('invalid, missing or weak secrets do not execute the workflow', async () => {
	for (const options of [{ token: 'wrong' }, { token: null }, { configuredSecret: 'short' }, { credentialError: true }, { token: [secret] }]) {
		const { context, response } = makeContext(options);
		assert.deepEqual(await new MNotifyTrigger().webhook.call(context), { noWebhookResponse: true });
		assert.equal(response.status, 401);
	}
});

test('a mismatched type is rejected, while Any accepts an IVR callback', async () => {
	const bad = makeContext({ callbackType: 'ussdDedicated', body: { msisdn: '123', sequenceID: '1' } });
	assert.deepEqual(await new MNotifyTrigger().webhook.call(bad.context), { noWebhookResponse: true });
	assert.equal(bad.response.status, 400);
	const ivr = makeContext({ query: { CallerId: '123' } });
	assert.equal((await new MNotifyTrigger().webhook.call(ivr.context)).workflowData[0][0].json.callbackType, 'ivr');
});
