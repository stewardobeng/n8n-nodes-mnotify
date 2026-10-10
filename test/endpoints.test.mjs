/**
 * Endpoint verification.
 *
 * Every path this package can call is listed once in nodes/MNotify/endpoints.ts. This suite
 * checks that list against recorded live probe results (test/fixtures/live-endpoints.json,
 * produced by test/tools/probe-endpoints.mjs) and guards against re-introducing paths that
 * mNotify documents but does not actually serve.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');

const { MN_ENDPOINTS, mnPath } = require(join(root, 'dist', 'nodes', 'MNotify', 'endpoints.js'));
const fixture = JSON.parse(readFileSync(join(here, 'fixtures', 'live-endpoints.json'), 'utf8'));

test('every endpoint the node can call exists on the live mNotify API', () => {
	const failures = [];
	for (const [key, template] of Object.entries(MN_ENDPOINTS)) {
		const recorded = fixture.endpoints[key];
		if (!recorded) {
			failures.push(`${key} (${template}) has no recorded probe`);
			continue;
		}
		if (!recorded.exists) {
			failures.push(`${key} (${template}) did not answer 401 on any method`);
		}
	}
	assert.deepEqual(failures, [], `Unverified endpoints:\n${failures.join('\n')}`);
});

test('the recorded probe fixture covers exactly the endpoints in the code', () => {
	assert.deepEqual(
		Object.keys(fixture.endpoints).sort(),
		Object.keys(MN_ENDPOINTS).sort(),
		'run `node test/tools/probe-endpoints.mjs` to refresh the fixture',
	);
});

test('paths documented by mNotify but absent from the live API are not used', () => {
	// Each of these appears in mNotify's API documentation and answered HTTP 404 on the live API
	// (recorded 2026-10-10 by test/tools/probe-endpoints.mjs). Calling any of them would fail at
	// run time, so the node must never build a path that is, or extends, one of them.
	const documentedButMissing = [
		'sms/send',
		'voice/ivr/scenarios',
		'voice/ivr/scenario',
		'voice/ivr/scenario/launch',
		'ivr-scenario',
		'ivr-scenario/send',
		'ivr-scenario/launch',
		'schedule',
		'campaign/:campaignId/delivered',
		'contact/:id/:groupId',
	];

	const collisions = [];
	for (const used of Object.values(MN_ENDPOINTS)) {
		for (const missing of documentedButMissing) {
			if (used === missing || used.startsWith(`${missing}/`)) {
				collisions.push(`${used} is a documented-but-missing route (${missing})`);
			}
		}
	}
	assert.deepEqual(collisions, []);
});

test('the delete-contact path is the one the live API answers', () => {
	// mNotify documents DELETE /contact/<id>/<group_id>; the live API only serves DELETE
	// /contact/<id>, which is what the fixture shows.
	const contactDelete = fixture.endpoints.contactById;
	assert.ok(contactDelete, 'contactById must be probed');
	assert.equal(contactDelete.methods.DELETE?.status, 401);
	assert.equal(contactDelete.path, 'contact/:id');
});

test('mnPath substitutes and encodes parameters', () => {
	assert.equal(mnPath('groupById', { id: 12 }), 'group/12');
	assert.equal(mnPath('contactById', { id: '40' }), 'contact/40');
	assert.equal(mnPath('templateById', { id: 'a b/c' }), 'template/a%20b%2Fc');
	assert.equal(mnPath('balanceSms'), 'balance/sms');
	assert.equal(mnPath('senderIdStatus'), 'senderid/status/');
	assert.throws(() => mnPath('groupById', {}), /Missing value for ":id"/);
});

test('no resource builds an API path by hand any more', () => {
	const resourcesDir = join(root, 'nodes', 'MNotify', 'resources');
	const offenders = [];
	for (const file of readdirSync(resourcesDir)) {
		const source = readFileSync(join(resourcesDir, file), 'utf8');
		const calls = source.match(/mnotifyApiRequest\.call\([^;]*?\);/gs) ?? [];
		for (const call of calls) {
			if (!call.includes('mnPath(')) {
				offenders.push(`${file}: ${call.replace(/\s+/g, ' ').slice(0, 120)}`);
			}
		}
	}
	assert.deepEqual(offenders, [], `Calls without a verified endpoint:\n${offenders.join('\n')}`);
});
