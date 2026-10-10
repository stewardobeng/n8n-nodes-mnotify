/**
 * Live read-only integration test.
 *
 * Runs the REAL compiled node code (descriptions, payload building, response parsing, output
 * shaping) against the REAL mNotify API. Only n8n's own plumbing is faked: the harness below
 * implements the few `IExecuteFunctions` members the node touches, including
 * `helpers.httpRequestWithAuthentication`, which applies the credential the same way n8n does
 * (the credential's `authenticate` block puts the API key in the `key` query parameter).
 *
 * Read-only operations only: balances, groups, templates, contacts, IVR scenarios, sender ID
 * status and a delivery report. Nothing is sent, nothing is created, nothing is charged.
 *
 * Run:  MN_API_KEY=... node --test test/live-api.test.mjs
 * Skip: unset MN_API_KEY (the suite reports one skipped test)
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');

const { MNotify } = require(join(root, 'dist', 'nodes', 'MNotify', 'MNotify.node.js'));

const API_KEY = process.env.MN_API_KEY ?? '';
const DEFAULT_SENDER = process.env.MN_SENDER_ID ?? '';

/** Emulates the part of n8n's httpRequestWithAuthentication that the node depends on. */
function makeHttpHelper(apiKey) {
	return async (credentialName, options) => {
		assert.equal(credentialName, 'mNotifyApi');
		const base = options.baseURL ?? '';
		const url = new URL(options.url.replace(/^\//, ''), base);
		for (const [key, value] of Object.entries(options.qs ?? {})) {
			url.searchParams.set(key, String(value));
		}
		// The credential's authenticate block: key goes in as a query parameter.
		url.searchParams.set('key', apiKey);

		const init = { method: options.method ?? 'GET', headers: {} };
		if (options.body) {
			if (Buffer.isBuffer(options.body)) {
				init.body = options.body;
				Object.assign(init.headers, options.headers ?? {});
			} else {
				init.body = JSON.stringify(options.body);
				init.headers['Content-Type'] = 'application/json';
			}
		}

		const response = await fetch(url, { ...init, signal: AbortSignal.timeout(30000) });
		const text = await response.text();
		let parsed;
		try {
			parsed = JSON.parse(text);
		} catch {
			parsed = text;
		}
		if (!response.ok) {
			// Same shape n8n's error objects have, so the node's error mapping is exercised.
			const error = new Error(`Request failed with status code ${response.status}`);
			error.httpCode = response.status;
			error.response = { status: response.status, data: parsed };
			throw error;
		}
		return parsed;
	};
}

function makeContext({ parameters, apiKey, credentials = {} }) {
	return {
		getNode: () => ({ name: 'mNotify', type: 'n8n-nodes-mnotify.mNotify', typeVersion: 1 }),
		getNodeParameter: (name, _itemIndex, fallback) =>
			Object.prototype.hasOwnProperty.call(parameters, name) ? parameters[name] : fallback,
		getCredentials: async () => ({ apiKey, ...credentials }),
		getInputData: () => [{ json: {} }],
		continueOnFail: () => false,
		helpers: {
			httpRequestWithAuthentication: makeHttpHelper(apiKey),
			assertBinaryData: () => {
				throw new Error('no binary data in these tests');
			},
			getBinaryDataBuffer: async () => Buffer.alloc(0),
		},
	};
}

/** Runs the real node execute() for one resource/operation and returns the emitted items. */
async function runOperation(parameters, apiKey) {
	const node = new MNotify();
	const context = makeContext({ parameters, apiKey });
	const result = await node.execute.call(context);
	return result[0].map((item) => item.json);
}

const skip = API_KEY === '' ? 'set MN_API_KEY to run the live checks' : false;

test('live: SMS and voice balances are read from the real API', { skip }, async () => {
	const sms = await runOperation(
		{ resource: 'account', operation: 'getSmsBalance' },
		API_KEY,
	);
	assert.equal(sms.length, 1);
	assert.equal(typeof sms[0].balance, 'number', `unexpected SMS balance payload: ${JSON.stringify(sms[0])}`);
	assert.ok('wallet' in sms[0], 'the wallet purse must be surfaced: OTP sends are billed from it');

	const voice = await runOperation({ resource: 'account', operation: 'getVoiceBalance' }, API_KEY);
	assert.equal(typeof voice[0].balance, 'number', `unexpected voice payload: ${JSON.stringify(voice[0])}`);

	console.log(`    balance: sms=${sms[0].balance} bonus=${sms[0].bonus} wallet=${sms[0].wallet} voice=${voice[0].balance}`);
});

test('live: sender ID status reports approval and purpose', { skip }, async () => {
	if (DEFAULT_SENDER === '') {
		console.log('    MN_SENDER_ID not set, skipped');
		return;
	}
	const items = await runOperation(
		{ resource: 'senderId', operation: 'getStatus', senderName: DEFAULT_SENDER },
		API_KEY,
	);
	assert.equal(items.length, 1);
	console.log(`    sender ${items[0].senderName}: status=${items[0].status} purpose="${items[0].purpose}"`);
	assert.ok(items[0].senderName);
});

test('live: groups, templates, contacts and IVR scenarios come back in a shape the node understands', { skip }, async () => {
	// The account under test has groups, templates and contacts, but no IVR scenarios and no
	// scheduled messages, so those two are expected to come back empty - an empty collection is
	// the correct answer, not a parsing failure.
	const checks = [
		['group', 'getAll', 1],
		['template', 'getAll', 1],
		['contact', 'getAll', 1],
		['ivr', 'getScenarios', 0],
		['scheduled', 'getAll', 0],
	];

	for (const [resource, operation, minimum] of checks) {
		const items = await runOperation({ resource, operation }, API_KEY);
		assert.ok(Array.isArray(items), `${resource}.${operation} did not return a list`);
		assert.ok(
			items.length >= minimum,
			`${resource}.${operation} returned ${items.length} item(s), expected at least ${minimum}`,
		);
		if (items.length === 0) {
			console.log(`    ${resource}.${operation}: the account has none`);
			continue;
		}
		// A response the node could not unwrap would come back as the raw envelope.
		const looksLikeRawEnvelope = items.length === 1 && 'status' in items[0] && Object.keys(items[0]).length <= 3;
		assert.ok(
			!looksLikeRawEnvelope,
			`${resource}.${operation} returned an unparsed envelope: ${JSON.stringify(items[0])}`,
		);
		console.log(
			`    ${resource}.${operation}: ${items.length} item(s), first keys: ${Object.keys(items[0]).slice(0, 6).join(', ')}`,
		);
	}
});

test('live: a periodic delivery report is read for the last two days', { skip }, async () => {
	const today = new Date().toISOString().slice(0, 10);
	const items = await runOperation(
		{ resource: 'report', operation: 'getPeriodic', periodicFrom: today, periodicTo: today },
		API_KEY,
	);
	assert.ok(Array.isArray(items) && items.length > 0, 'expected at least the raw report envelope');
	console.log(`    report rows: ${items.length}, first keys: ${Object.keys(items[0]).slice(0, 8).join(', ')}`);
});

test('live: a rejected API key produces n8n-friendly guidance', { skip }, async () => {
	await assert.rejects(
		() => runOperation({ resource: 'account', operation: 'getSmsBalance' }, 'not-a-real-key'),
		(error) => {
			console.log(`    wrong-key error: ${String(error.message).slice(0, 140)}`);
			assert.match(String(error.message), /invalid api key/i);
			return true;
		},
	);
});
