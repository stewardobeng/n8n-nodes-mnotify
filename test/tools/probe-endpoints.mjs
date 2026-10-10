/**
 * Probes every endpoint in nodes/MNotify/endpoints.ts against the live mNotify API and records
 * the result in test/fixtures/live-endpoints.json.
 *
 * How it works: mNotify answers a request to a route that exists with HTTP 401 and
 * `{"error":"invalid api key ..."}` before it looks at the payload, while a route that does not
 * exist falls through to the framework's HTML 404 page. That difference is enough to prove
 * which paths and methods are real without holding a working API key, and without sending or
 * spending anything.
 *
 * Run: node test/tools/probe-endpoints.mjs
 */
import { createRequire } from 'node:module';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..');

const { MN_ENDPOINTS } = require(join(root, 'dist', 'nodes', 'MNotify', 'endpoints.js'));

const API_BASE = 'https://api.mnotify.com/api/';
const METHODS = ['GET', 'POST', 'PUT', 'DELETE'];
const PROBE_KEY = 'invalid-probe-key';
const CONCURRENCY = 8;

/** Replaces :params with a plausible sample value. */
function samplePath(template) {
	return template.replace(/:([A-Za-z]+)/g, '1');
}

async function probe(method, path) {
	const url = `${API_BASE}${path}?key=${PROBE_KEY}`;
	try {
		const response = await fetch(url, {
			method,
			headers: { 'Content-Type': 'application/json' },
			body: method === 'GET' || method === 'DELETE' ? undefined : '{}',
			signal: AbortSignal.timeout(25000),
		});
		const text = await response.text();
		return { status: response.status, body: text.slice(0, 80) };
	} catch (error) {
		return { status: 0, body: String(error?.message ?? error) };
	}
}

async function run() {
	const records = {};
	const entries = Object.entries(MN_ENDPOINTS);
	const work = [];
	for (const [key, template] of entries) {
		for (const method of METHODS) {
			work.push({ key, template, method });
		}
	}

	let cursor = 0;
	async function worker() {
		while (cursor < work.length) {
			const job = work[cursor++];
			const path = samplePath(job.template);
			const result = await probe(job.method, path);
			const verdict =
				result.status === 401 ? 'exists' : result.status === 405 ? 'method-not-allowed' : 'missing';
			records[job.key] ??= { path: job.template, methods: {} };
			records[job.key].methods[job.method] = { status: result.status, verdict, body: result.body };
		}
	}
	await Promise.all(Array.from({ length: CONCURRENCY }, worker));

	const summary = {};
	for (const [key, record] of Object.entries(records)) {
		const accepted = Object.entries(record.methods)
			.filter(([, value]) => value.status === 401)
			.map(([method]) => method);
		const exists = accepted.length > 0;
		summary[key] = { path: record.path, exists, acceptedMethods: accepted, methods: record.methods };
	}

	const outDir = join(root, 'test', 'fixtures');
	mkdirSync(outDir, { recursive: true });
	const outFile = join(outDir, 'live-endpoints.json');
	writeFileSync(
		outFile,
		`${JSON.stringify(
			{
				probedAt: new Date().toISOString(),
				apiBase: API_BASE,
				method: 'HTTP 401 with a JSON invalid-key error means the route exists; an HTML 404 means it does not',
				endpoints: summary,
			},
			null,
			2,
		)}\n`,
	);

	const missing = Object.entries(summary).filter(([, value]) => !value.exists);
	console.log(`Probed ${Object.keys(summary).length} endpoints -> ${outFile}`);
	for (const [key, value] of Object.entries(summary)) {
		console.log(
			`${value.exists ? 'OK     ' : 'MISSING'} ${key.padEnd(22)} ${value.path.padEnd(26)} accepts: ${value.acceptedMethods.join(',') || '-'}`,
		);
	}
	if (missing.length > 0) {
		console.error(`\n${missing.length} endpoint(s) do not exist on the live API.`);
		process.exitCode = 1;
	}
}

await run();
