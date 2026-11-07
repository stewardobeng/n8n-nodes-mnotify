import assert from 'node:assert/strict';
import { test } from 'node:test';
import { MNotify } from '../dist/nodes/MNotify/MNotify.node.js';

function context(response) {
	const params = { resource: 'contact', operation: 'delete', contactId: '123' };
	return {
		getInputData: () => [{ json: {} }],
		getNodeParameter: (name, _index, fallback) => params[name] ?? fallback,
		getNode: () => ({ name: 'mNotify', type: 'n8n-nodes-mnotify.mNotify', typeVersion: 1 }),
		continueOnFail: () => false,
		helpers: { httpRequestWithAuthentication: async () => response },
	};
}

test('contact deletion returns n8n confirmation only after the API succeeds', async () => {
	const node = new MNotify();
	assert.deepEqual(await node.execute.call(context({ status: 'success', code: '2000' })),
		[[{ json: { deleted: true }, pairedItem: { item: 0 } }]]);
	await assert.rejects(node.execute.call(context({ status: 'error', message: 'Denied' })));
});
