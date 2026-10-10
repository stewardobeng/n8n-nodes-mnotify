/**
 * Structural tests that load the compiled node the way n8n does, so a broken description or a
 * missing dist artifact fails here rather than in a user's instance.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');

const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const { MNotify } = require(join(root, 'dist', 'nodes', 'MNotify', 'MNotify.node.js'));
const { MNotifyTrigger } = require(join(root, 'dist', 'nodes', 'MNotifyTrigger', 'MNotifyTrigger.node.js'));
const { MNotifyApi } = require(join(root, 'dist', 'credentials', 'MNotifyApi.credentials.js'));

const node = new MNotify();
const trigger = new MNotifyTrigger();
const credentialType = new MNotifyApi();

/** The operations this package claims to implement, per resource. */
const EXPECTED_INVENTORY = {
	account: ['getSmsBalance', 'getVoiceBalance'],
	contact: ['create', 'delete', 'get', 'getAll', 'getByGroup', 'update'],
	group: ['create', 'delete', 'get', 'getAll', 'update'],
	ivr: [
		'createScenario',
		'deleteFlow',
		'deleteScenario',
		'getFlow',
		'getScenario',
		'getScenarios',
		'initiateCall',
		'launchScenario',
		'saveFlow',
		'updateScenario',
	],
	report: [
		'getCallPeriod',
		'getCallReport',
		'getCallStatus',
		'getCampaignReport',
		'getMessageStatus',
		'getPeriodic',
		'getSummary',
	],
	scheduled: ['getAll', 'update'],
	senderId: ['getStatus', 'register'],
	sms: ['send', 'sendGroup'],
	template: ['create', 'delete', 'get', 'getAll', 'update'],
	voice: ['send', 'sendGroup'],
};

/** Operations that need no further input from the user. */
const PARAMETERLESS = [
	'account:getSmsBalance',
	'account:getVoiceBalance',
	'contact:getAll',
	'group:getAll',
	'ivr:getScenarios',
	'scheduled:getAll',
	'template:getAll',
];

function operationOptions(properties) {
	const selector = properties.find((property) => property.name === 'operation');
	assert.ok(selector, 'the node must have an operation selector');
	return selector.options;
}

function resourceOptions(properties) {
	const selector = properties.find((property) => property.name === 'resource');
	assert.ok(selector, 'the node must have a resource selector');
	return selector.options.map((option) => option.value);
}

function collectParameters(properties, collected = []) {
	for (const property of properties) {
		collected.push(property);
		if (Array.isArray(property.options) && property.type === 'collection') {
			collectParameters(property.options, collected);
		}
	}
	return collected;
}

function shownOperations(properties) {
	const shown = new Set();
	for (const property of properties) {
		const show = property.displayOptions?.show;
		if (!show?.operation) continue;
		for (const value of show.operation) {
			shown.add(value);
		}
	}
	return shown;
}

test('package.json points n8n at files that exist in dist', () => {
	for (const relative of [...pkg.n8n.nodes, ...pkg.n8n.credentials]) {
		assert.ok(existsSync(join(root, relative)), `${relative} is listed in package.json but missing`);
	}
	assert.ok(pkg.keywords.includes('n8n-community-node-package'));
	assert.ok(pkg.name.startsWith('n8n-nodes-'));
	assert.ok(!pkg.dependencies || Object.keys(pkg.dependencies).length === 0, 'community nodes must have no runtime dependencies');
});

test('a parameter name may repeat only when the copies can never both be shown', () => {
	// n8n resolves repeated names by checking which copy is displayed, so the real invariant is
	// mutual exclusivity: two parameters of the same name must differ in their show conditions.
	const byName = new Map();
	for (const property of node.description.properties) {
		if (!byName.has(property.name)) byName.set(property.name, []);
		byName.get(property.name).push(property);
	}

	const problems = [];
	for (const [name, copies] of byName) {
		for (let i = 0; i < copies.length; i++) {
			for (let j = i + 1; j < copies.length; j++) {
				const a = copies[i].displayOptions?.show ?? {};
				const b = copies[j].displayOptions?.show ?? {};
				const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
				const mutuallyExclusive = [...keys].some((key) => {
					const valuesA = (a[key] ?? []).map(String).sort().join('|');
					const valuesB = (b[key] ?? []).map(String).sort().join('|');
					return valuesA !== '' && valuesB !== '' && valuesA !== valuesB;
				});
				if (!mutuallyExclusive) {
					problems.push(
						`"${name}" appears twice with overlapping conditions (copies ${i + 1} and ${j + 1})`,
					);
				}
			}
		}
	}
	assert.deepEqual([...new Set(problems)], []);
});

test('every parameter documents itself, every operation is labelled, every icon exists', () => {
	const missingDescriptions = [];
	for (const property of collectParameters(node.description.properties)) {
		// Notices carry their text in displayName, collections are a container, and the two
		// selectors are labelled by their options.
		if (property.type === 'notice' || property.type === 'collection') continue;
		if (property.name === 'resource' || property.name === 'operation') continue;
		if (!property.description) {
			missingDescriptions.push(property.name);
		}
	}
	assert.deepEqual(missingDescriptions, [], `parameters without a description: ${missingDescriptions.join(', ')}`);

	for (const option of operationOptions(node.description.properties)) {
		assert.ok(option.action, `operation ${option.value} needs an "action" so the node works as a tool`);
		assert.ok(option.description, `operation ${option.value} needs a description`);
	}

	const icons = [
		join(root, 'dist', 'nodes', 'MNotify', 'mnotify.svg'),
		join(root, 'dist', 'nodes', 'MNotify', 'mnotify.dark.svg'),
		join(root, 'dist', 'nodes', 'MNotifyTrigger', 'mnotify.svg'),
		join(root, 'dist', 'credentials', 'mnotify.svg'),
	];
	for (const icon of icons) {
		assert.ok(existsSync(icon), `missing icon ${icon}`);
	}
});

test('the resource and operation inventory is exactly what this package implements', () => {
	const properties = node.description.properties;
	assert.deepEqual(resourceOptions(properties).sort(), Object.keys(EXPECTED_INVENTORY).sort());

	// Each resource module declares its own operation selector; that list is the inventory.
	const modules = {
		account: require(join(root, 'dist', 'nodes', 'MNotify', 'resources', 'account.js')).accountDescription,
		contact: require(join(root, 'dist', 'nodes', 'MNotify', 'resources', 'contact.js')).contactDescription,
		group: require(join(root, 'dist', 'nodes', 'MNotify', 'resources', 'group.js')).groupDescription,
		ivr: require(join(root, 'dist', 'nodes', 'MNotify', 'resources', 'ivr.js')).ivrDescription,
		report: require(join(root, 'dist', 'nodes', 'MNotify', 'resources', 'report.js')).reportDescription,
		scheduled: require(join(root, 'dist', 'nodes', 'MNotify', 'resources', 'scheduled.js')).scheduledDescription,
		senderId: require(join(root, 'dist', 'nodes', 'MNotify', 'resources', 'senderId.js')).senderIdDescription,
		sms: require(join(root, 'dist', 'nodes', 'MNotify', 'resources', 'sms.js')).smsDescription,
		template: require(join(root, 'dist', 'nodes', 'MNotify', 'resources', 'template.js')).templateDescription,
		voice: require(join(root, 'dist', 'nodes', 'MNotify', 'resources', 'voice.js')).voiceDescription,
	};

	for (const [resource, description] of Object.entries(modules)) {
		const selector = description.find((property) => property.name === 'operation');
		assert.ok(selector, `${resource} has no operation selector`);
		assert.deepEqual(
			selector.options.map((option) => option.value).sort(),
			EXPECTED_INVENTORY[resource],
			`the ${resource} operations differ from the documented inventory`,
		);
	}

	// Every operation must either collect input or be known to take none.
	for (const [resource, operations] of Object.entries(EXPECTED_INVENTORY)) {
		for (const operation of operations) {
			const applicable = properties.filter((property) => {
				if (property.name === 'resource' || property.name === 'operation') return false;
				const show = property.displayOptions?.show;
				if (show?.resource && !show.resource.includes(resource)) return false;
				if (show?.operation && !show.operation.includes(operation)) return false;
				return true;
			});
			assert.ok(
				applicable.length > 0 || PARAMETERLESS.includes(`${resource}:${operation}`),
				`${resource}.${operation} has no input and is not documented as taking none`,
			);
		}
	}

	const total = Object.values(EXPECTED_INVENTORY).reduce((sum, list) => sum + list.length, 0);
	assert.equal(total, 43, 'the inventory changed; update this test and the README together');
});

test('operations that take input show that input for their resource and operation only', () => {
	const properties = node.description.properties;
	const sendSmsFields = properties.filter(
		(property) =>
			property.name === 'recipients' &&
			property.displayOptions?.show?.resource?.includes('sms'),
	);
	assert.equal(sendSmsFields.length, 1);

	// recipients is an SMS-only field: it must not appear for voice.
	assert.ok(!sendSmsFields[0].displayOptions.show.resource.includes('voice'));

	// The scheduled date field is inside the SMS collection and only appears when scheduling.
	const smsCollection = properties.find((property) => property.name === 'smsAdditionalFields');
	const scheduleDate = smsCollection.options.find((option) => option.name === 'scheduleDate');
	assert.deepEqual(scheduleDate.displayOptions.show.isScheduled, [true]);
});

test('the node can be used as a tool and requests the mNotify credential', () => {
	assert.equal(node.description.usableAsTool, true);
	assert.deepEqual(node.description.credentials, [{ name: 'mNotifyApi', required: true }]);
	assert.ok(node.description.subtitle.includes('operation'));
});

test('loadOptions methods are declared for every dynamic picker', () => {
	const dynamicFields = collectParameters(node.description.properties).filter(
		(property) => property.typeOptions?.loadOptionsMethod,
	);
	const declared = Object.keys(node.methods.loadOptions);
	for (const field of dynamicFields) {
		assert.ok(
			declared.includes(field.typeOptions.loadOptionsMethod),
			`${field.name} asks for ${field.typeOptions.loadOptionsMethod}, which is not implemented`,
		);
	}
	assert.deepEqual(declared.sort(), ['getGroups', 'getIvrScenarios', 'getTemplates']);
});

test('the trigger node answers with the workflow output', () => {
	assert.deepEqual(trigger.description.group, ['trigger']);
	assert.deepEqual(trigger.description.inputs, []);
	assert.ok(trigger.description.subtitle);
	const webhook = trigger.description.webhooks[0];
	assert.equal(webhook.responseMode, 'lastNode');
	assert.equal(webhook.responseData, 'firstEntryJson');
	assert.equal(webhook.httpMethod, '={{$parameter["httpMethod"]}}');
	assert.deepEqual(Object.keys(trigger.webhookMethods), ['default']);
	for (const hook of ['checkExists', 'create', 'delete']) {
		assert.equal(typeof trigger.webhookMethods.default[hook], 'function');
	}
});

test('the credential authenticates with the mNotify query parameter and tests itself', () => {
	assert.equal(credentialType.name, 'mNotifyApi');
	assert.equal(credentialType.authenticate.type, 'generic');
	assert.deepEqual(credentialType.authenticate.properties.qs, { key: '={{$credentials.apiKey}}' });
	assert.equal(credentialType.test.request.url, 'balance/sms');
	assert.equal(credentialType.test.request.method, 'GET');
	assert.equal(credentialType.test.request.baseURL, 'https://api.mnotify.com/api/');

	const apiKey = credentialType.properties.find((property) => property.name === 'apiKey');
	assert.equal(apiKey.required, true);
	assert.equal(apiKey.typeOptions.password, true);
});

test('every icon reference resolves to a shipped, square asset', () => {
	// n8n resolves 'file:x' next to the compiled file, so an asset that is not copied into dist,
	// or one renamed without updating the reference, loads as a node with no icon.
	const folders = [
		join(root, 'dist', 'nodes', 'MNotify'),
		join(root, 'dist', 'nodes', 'MNotifyTrigger'),
		join(root, 'dist', 'credentials'),
	];
	const referenced = [];

	for (const folder of folders) {
		for (const file of readdirSync(folder).filter((name) => name.endsWith('.js'))) {
			const source = readFileSync(join(folder, file), 'utf8');
			for (const match of source.matchAll(/file:([A-Za-z0-9_.-]+\.(?:svg|png))/g)) {
				const asset = join(folder, match[1]);
				assert.ok(existsSync(asset), `${file} references ${match[1]}, which is not shipped beside it`);

				const bytes = readFileSync(asset);
				if (match[1].endsWith('.png')) {
					assert.equal(bytes.subarray(1, 4).toString(), 'PNG', `${match[1]} is not a PNG file`);
					const width = bytes.readUInt32BE(16);
					const height = bytes.readUInt32BE(20);
					assert.equal(width, height, `${match[1]} should be square, found ${width}x${height}`);
				} else {
					const markup = bytes.toString('utf8');
					const viewBox = /\bviewBox="0 0 (\d+) (\d+)"/.exec(markup);
					assert.ok(viewBox, `${match[1]} has no viewBox`);
					assert.equal(viewBox[1], viewBox[2], `${match[1]} viewBox is not square: ${viewBox[0]}`);
					// the brand artwork is a raster carried inside the SVG, so assert it fills the box
					assert.match(
						markup,
						new RegExp(`<image[^>]*width="${viewBox[1]}"[^>]*height="${viewBox[2]}"`),
						`${match[1]} does not carry a square image matching its viewBox`,
					);
				}
				referenced.push(`${folder.split('/').pop()}/${match[1]}`);
			}
		}
	}

	assert.equal(referenced.length, 6, `expected a light and a dark icon for each of the node, the trigger and the credential, found ${referenced.join(', ')}`);
});
