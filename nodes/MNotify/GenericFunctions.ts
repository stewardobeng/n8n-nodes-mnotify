import type {
	IDataObject,
	IExecuteFunctions,
	IHttpRequestMethods,
	IHttpRequestOptions,
	ILoadOptionsFunctions,
	JsonObject,
} from 'n8n-workflow';
import { NodeApiError, NodeOperationError } from 'n8n-workflow';

/**
 * Shared plumbing for every mNotify call.
 *
 * Facts about the mNotify API that shape this file (all verified against the live API):
 *
 * - The API key travels as the query parameter `key`, so authentication is done by the
 *   credential's `authenticate` block and requests go out through
 *   `httpRequestWithAuthentication`.
 * - Every response is JSON shaped `{ status: 'success', code: '2000', ... }`. A successful
 *   response always has `status: "success"`; `code` is `"2000"` when present at all — the
 *   balance endpoints return no `code`, so a code is only judged when one is present.
 * - mNotify wraps API errors in `{"error": "..."}` with an HTTP status, so both the HTTP
 *   layer and the body need checking.
 * - The API base is fixed: https://api.mnotify.com/api
 */

export const MN_API_BASE = 'https://api.mnotify.com/api/';

export const MN_CREDENTIAL_NAME = 'mNotifyApi';

export const MN_SENDER_ID_MAX_LENGTH = 11;

export type MNotifyApiContext = IExecuteFunctions | ILoadOptionsFunctions;

export interface MNotifyRequestOptions {
	/** JSON body for POST/PUT requests. */
	body?: IDataObject;
	/** Extra query parameters. The API key is added automatically by the credential. */
	qs?: IDataObject;
	/** Pre-built multipart body (voice call uploads) with the matching Content-Type header. */
	multipart?: { body: Buffer; contentType: string };
	/** True for endpoints that answer with a bare list, where `status` may be absent. */
	allowMissingStatus?: boolean;
}

/** Extracts the most useful message out of whatever n8n hands us as an error. */
function errorDetails(error: unknown): { message: string; httpCode?: number } {
	const err = error as {
		message?: string;
		httpCode?: number | string;
		response?: { status?: number; data?: unknown };
		cause?: { response?: { status?: number; data?: unknown } };
	};

	const response = err?.response ?? err?.cause?.response;
	const httpCode = typeof response?.status === 'number' ? response.status : undefined;

	let message = '';
	const data = response?.data;
	if (typeof data === 'string' && data.trim() !== '') {
		message = data.trim();
	} else if (data && typeof data === 'object') {
		const body = data as IDataObject;
		message = String(body.error ?? body.message ?? '').trim();
	}
	if (message === '') {
		message = String(err?.message ?? 'Unknown error').trim();
	}
	// HTML error pages are useless to a workflow author.
	if (message.startsWith('<')) {
		message = `mNotify answered with an HTML page (HTTP ${httpCode ?? 'unknown'}). This usually means the endpoint path is wrong.`;
	}
	return { message, httpCode };
}

/**
 * Turns a failed mNotify call into an n8n error. The description carries the causes we have
 * actually run into with this API so a workflow author is not left guessing.
 */
function hintFor(message: string, httpCode?: number): string | undefined {
	const text = `${message} ${httpCode ?? ''}`.toLowerCase();

	if (/invalid api key|unauthor|not enabled|api key is valid/.test(text)) {
		return 'Check the API key in the mNotify API credential and make sure the key is enabled in the mNotify dashboard (app.bms.africa -> Settings -> Developer).';
	}
	if (/sender|senderid/.test(text)) {
		return 'The Sender ID must be registered and approved on the mNotify account, at most 11 characters, and made of letters and digits only. A Sender ID containing a hyphen is rejected by mNotify.';
	}
	if (/wallet|insufficient|balance/.test(text)) {
		return 'A mNotify OTP-typed campaign (SMS Type = OTP) is billed from the main wallet at 0.035 per campaign, separately from SMS credits. An empty wallet refuses the send while the SMS balance still looks healthy.';
	}
	if (httpCode === 402) {
		return 'mNotify refused the send for lack of funds. Check the SMS balance and the main wallet in the mNotify dashboard.';
	}
	if (/validation|required/.test(text)) {
		return 'mNotify rejected one of the payload fields. Compare the values in this node against the mNotify API documentation (developer.bms.africa).';
	}
	return undefined;
}

/**
 * Performs one authenticated mNotify call and validates the envelope.
 *
 * @returns the parsed JSON body of a successful response.
 */
export async function mnotifyApiRequest(
	this: MNotifyApiContext,
	method: IHttpRequestMethods,
	endpoint: string,
	options: MNotifyRequestOptions = {},
): Promise<IDataObject> {
	const requestOptions: IHttpRequestOptions = {
		method,
		baseURL: MN_API_BASE,
		url: endpoint.replace(/^\//, ''),
		json: true,
	};

	if (options.qs && Object.keys(options.qs).length > 0) {
		requestOptions.qs = options.qs;
	}
	if (options.multipart) {
		requestOptions.body = options.multipart.body;
		requestOptions.headers = { 'Content-Type': options.multipart.contentType };
	} else if (options.body) {
		requestOptions.body = options.body;
	}

	let response: unknown;
	try {
		response = await this.helpers.httpRequestWithAuthentication.call(
			this,
			MN_CREDENTIAL_NAME,
			requestOptions,
		);
	} catch (error) {
		const { message, httpCode } = errorDetails(error);
		throw new NodeApiError(this.getNode(), error as JsonObject, {
			message: `mNotify request failed: ${message}`,
			description: hintFor(message, httpCode),
		});
	}

	if (response === null || typeof response !== 'object' || Array.isArray(response)) {
		throw new NodeOperationError(
			this.getNode(),
			'mNotify answered with an unexpected payload (expected a JSON object).',
		);
	}

	const data = response as IDataObject;
	const status = String(data.status ?? '').toLowerCase();
	const code = String(data.code ?? '').trim();

	if (status === 'success' && (code === '' || code === '2000')) {
		return data;
	}

	if (status === '' && !data.error && options.allowMissingStatus) {
		return data;
	}

	const apiMessage = String(data.message ?? data.error ?? '').trim();
	const label = apiMessage !== '' ? apiMessage : `mNotify refused the request (code ${code || 'unknown'})`;
	throw new NodeOperationError(this.getNode(), `mNotify error: ${label}`, {
		description: hintFor(apiMessage, undefined),
	});
}

/** Splits a user-typed recipient list on commas, semicolons, spaces and new lines. */
export function splitRecipients(value: string): string[] {
	return String(value ?? '')
		.split(/[\s,;]+/)
		.map((entry) => entry.trim())
		.filter((entry) => entry !== '');
}

/**
 * Resolves the Sender ID for a send: the node value when given, otherwise the credential
 * default. mNotify rejects anything longer than 11 characters.
 */
export async function resolveSenderId(
	this: MNotifyApiContext,
	provided: string,
): Promise<string> {
	let senderId = String(provided ?? '').trim();

	if (senderId === '') {
		const credentials = await this.getCredentials(MN_CREDENTIAL_NAME);
		senderId = String(credentials.senderId ?? '').trim();
	}

	if (senderId === '') {
		throw new NodeOperationError(
			this.getNode(),
			'No Sender ID given.',
			{
				description:
					'Enter a Sender ID in this node or set a default Sender ID on the mNotify API credential. The Sender ID must be approved on the mNotify account.',
			},
		);
	}

	if (senderId.length > MN_SENDER_ID_MAX_LENGTH) {
		throw new NodeOperationError(
			this.getNode(),
			`The Sender ID "${senderId}" is ${senderId.length} characters long.`,
			{
				description: `mNotify allows at most ${MN_SENDER_ID_MAX_LENGTH} characters in a Sender ID. Use a shorter registered Sender ID.`,
			},
		);
	}

	return senderId;
}

/**
 * Formats an n8n date/time value as the `YYYY-MM-DD hh:mm` string mNotify expects.
 *
 * The value is passed through exactly as the workflow's clock reads it, with no timezone
 * conversion: mNotify reads the string as Ghana local time (GMT), which is what a workflow
 * running in Africa/Accra already holds.
 *
 * @returns the formatted string, or null when the value is not a usable date.
 */
export function formatMNotifyDateTime(value: unknown): string | null {
	const raw = String(value ?? '').trim();
	const match = /^(\d{4}-\d{2}-\d{2})(?:[T ](\d{2}:\d{2}))?/.exec(raw);
	if (!match) {
		return null;
	}
	return `${match[1]} ${match[2] ?? '00:00'}`;
}

/** Formats a date/time value for mNotify, failing the node item with a readable message. */
export function requireMNotifyDateTime(
	this: MNotifyApiContext,
	value: unknown,
	fieldName: string,
): string {
	const formatted = formatMNotifyDateTime(value);
	if (formatted === null) {
		throw new NodeOperationError(
			this.getNode(),
			`"${String(value ?? '')}" is not a usable value for ${fieldName}.`,
			{
				description:
					'mNotify expects YYYY-MM-DD hh:mm (for example 2026-10-24 14:30). Use the date picker or provide an ISO value.',
			},
		);
	}
	return formatted;
}

/** Formats a date (no time) as `YYYY-MM-DD` for mNotify's report endpoints. */
export function requireMNotifyDate(
	this: MNotifyApiContext,
	value: unknown,
	fieldName: string,
): string {
	return requireMNotifyDateTime.call(this, value, fieldName).slice(0, 10);
}

/** Converts a value to `true`/`false` as mNotify expects in multipart forms. */
export function toFormBoolean(value: unknown): string {
	return value === true || String(value).toLowerCase() === 'true' ? 'true' : 'false';
}

export interface MultipartFile {
	fieldName?: string;
	filename: string;
	contentType: string;
	data: Buffer;
}

export interface MultipartBody {
	body: Buffer;
	contentType: string;
	boundary: string;
}

/**
 * Builds a multipart/form-data body by hand.
 *
 * The voice endpoints take a file upload; building the body explicitly keeps this node free
 * of runtime dependencies and gives a deterministic, testable payload.
 */
export function buildMultipartBody(
	fields: Record<string, string | string[]>,
	file?: MultipartFile,
): MultipartBody {
	const boundary = `----n8nMNotifyBoundary${Date.now().toString(16)}${Math.random()
		.toString(16)
		.slice(2, 10)}`;
	const chunks: Buffer[] = [];

	for (const [name, value] of Object.entries(fields)) {
		const values = Array.isArray(value) ? value : [value];
		for (const entry of values) {
			chunks.push(
				Buffer.from(
					`--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${entry}\r\n`,
					'utf8',
				),
			);
		}
	}

	if (file) {
		const fieldName = file.fieldName ?? 'file';
		chunks.push(
			Buffer.from(
				`--${boundary}\r\nContent-Disposition: form-data; name="${fieldName}"; filename="${file.filename}"\r\nContent-Type: ${file.contentType}\r\n\r\n`,
				'utf8',
			),
		);
		chunks.push(file.data);
		chunks.push(Buffer.from('\r\n', 'utf8'));
	}

	chunks.push(Buffer.from(`--${boundary}--\r\n`, 'utf8'));

	return {
		body: Buffer.concat(chunks),
		contentType: `multipart/form-data; boundary=${boundary}`,
		boundary,
	};
}

/**
 * Pulls a list out of a response, trying each key in turn. mNotify is inconsistent about the
 * wrapper key (`template_list`, `group_list`, `contacts_list`, `report`, `call`, `data`, ...).
 */
export function pickList(response: IDataObject, keys: string[]): IDataObject[] {
	for (const key of keys) {
		const value = response[key];
		if (Array.isArray(value)) {
			return value as IDataObject[];
		}
	}
	return [];
}

/**
 * Turns a mNotify response into workflow items.
 *
 * mNotify wraps collections in different keys from endpoint to endpoint and sometimes returns
 * a single object where the documentation shows a list, so each candidate key is accepted as
 * either shape. When nothing matches, the whole response is emitted so no data is lost.
 */
export function emitRecords(response: IDataObject, keys: string[]): IDataObject[] {
	for (const key of keys) {
		const value = response[key];
		if (Array.isArray(value)) {
			return value as IDataObject[];
		}
		if (value !== null && typeof value === 'object') {
			return [value as IDataObject];
		}
	}
	return [response];
}

/** Removes empty-string and undefined entries so mNotify never sees blank fields. */
export function withoutEmptyValues(input: IDataObject): IDataObject {
	const output: IDataObject = {};
	for (const [key, value] of Object.entries(input)) {
		if (value === undefined || value === null || value === '') {
			continue;
		}
		output[key] = value;
	}
	return output;
}
