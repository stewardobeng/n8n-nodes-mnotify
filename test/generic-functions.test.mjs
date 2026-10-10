/**
 * Unit tests for the shared mNotify helpers, run against the compiled output in dist/ so the
 * tests exercise exactly what ships.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');

const {
	buildMultipartBody,
	emitRecords,
	formatMNotifyDateTime,
	pickList,
	splitRecipients,
	withoutEmptyValues,
} = require(join(root, 'dist', 'nodes', 'MNotify', 'GenericFunctions.js'));

test('splitRecipients accepts the separators a user actually types', () => {
	assert.deepEqual(splitRecipients('0241234567, 0201234567'), ['0241234567', '0201234567']);
	assert.deepEqual(splitRecipients('0241234567\n0201234567\n'), ['0241234567', '0201234567']);
	assert.deepEqual(splitRecipients('0241234567;0201234567,+233241234567'), [
		'0241234567',
		'0201234567',
		'+233241234567',
	]);
	assert.deepEqual(splitRecipients('   '), []);
	assert.deepEqual(splitRecipients(''), []);
});

test('formatMNotifyDateTime produces the YYYY-MM-DD hh:mm mNotify expects', () => {
	assert.equal(formatMNotifyDateTime('2026-10-24T14:30:00.000+00:00'), '2026-10-24 14:30');
	assert.equal(formatMNotifyDateTime('2026-10-24 14:30'), '2026-10-24 14:30');
	assert.equal(formatMNotifyDateTime('2026-10-24'), '2026-10-24 00:00');
	assert.equal(formatMNotifyDateTime('24/10/2026'), null);
	assert.equal(formatMNotifyDateTime(''), null);
	assert.equal(formatMNotifyDateTime(undefined), null);
});

test('buildMultipartBody builds a body PHP (Laravel) can parse as arrays', () => {
	const file = {
		fieldName: 'file',
		filename: 'greeting.mp3',
		contentType: 'audio/mpeg',
		data: Buffer.from([0x49, 0x44, 0x33]),
	};
	const multipart = buildMultipartBody(
		{ campaign: 'Reminder', 'recipient[]': ['0241234567', '0201234567'], is_schedule: 'false', schedule_date: '' },
		file,
	);

	const text = multipart.body.toString('binary');
	assert.match(multipart.contentType, /^multipart\/form-data; boundary=----n8nMNotifyBoundary[0-9a-f]+$/);
	assert.ok(
		multipart.contentType.endsWith(multipart.boundary),
		'the content type must carry the boundary that is in the body',
	);

	for (const part of [
		'name="campaign"',
		'name="recipient[]"',
		'name="is_schedule"',
		'name="schedule_date"',
		'filename="greeting.mp3"',
		'Content-Type: audio/mpeg',
	]) {
		assert.ok(text.includes(part), `body is missing ${part}`);
	}
	// Two recipients, each with its own repeat of the same field name.
	assert.equal(text.split('name="recipient[]"').length - 1, 2);
	assert.ok(text.includes('0241234567'));
	assert.ok(text.includes('0201234567'));
	assert.ok(text.startsWith(`------n8nMNotifyBoundary`));
	assert.ok(text.endsWith('--\r\n'), 'the body must end with the closing boundary');
	assert.ok(text.trimEnd().endsWith('--'), 'the closing boundary needs its trailing dashes');

	// The file bytes must be intact between the part header and the closing boundary.
	const marker = text.indexOf('Content-Type: audio/mpeg\r\n\r\n') + 'Content-Type: audio/mpeg\r\n\r\n'.length;
	assert.deepEqual(Buffer.from(text.slice(marker, marker + 3), 'binary'), file.data);
});

test('buildMultipartBody works without a file', () => {
	const multipart = buildMultipartBody({ campaign: 'Reminder', 'group_id[]': ['1'] });
	const text = multipart.body.toString('binary');
	assert.ok(text.includes('name="group_id[]"'));
	assert.ok(!text.includes('filename='));
});

test('emitRecords copes with the wrapper keys mNotify actually uses', () => {
	assert.deepEqual(emitRecords({ template_list: [{ _id: 1 }, { _id: 2 }] }, ['template_list']), [
		{ _id: 1 },
		{ _id: 2 },
	]);
	// A single object where the documentation shows a list.
	assert.deepEqual(emitRecords({ contact: { _id: 5 } }, ['contact_list', 'contact']), [{ _id: 5 }]);
	// Nothing recognisable: the whole response is kept rather than dropped.
	assert.deepEqual(emitRecords({ status: 'success' }, ['report']), [{ status: 'success' }]);
});

test('pickList returns an empty array instead of throwing on an unexpected shape', () => {
	assert.deepEqual(pickList({ group_list: [{ _id: 1 }] }, ['group_list']), [{ _id: 1 }]);
	assert.deepEqual(pickList({ group_list: {} }, ['group_list']), []);
	assert.deepEqual(pickList({}, ['group_list']), []);
});

test('withoutEmptyValues keeps meaningful falsy values', () => {
	assert.deepEqual(
		withoutEmptyValues({ a: '', b: null, c: undefined, d: false, e: 0, f: 'x' }),
		{ d: false, e: 0, f: 'x' },
	);
});
