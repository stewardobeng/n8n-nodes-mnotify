# n8n-nodes-mnotify

An [n8n](https://n8n.io) community node package for **mNotify (BMS)**, the Ghanaian SMS, voice and
IVR platform. It wraps the whole public mNotify API surface that the live service actually
answers on, not just the two calls in the getting-started guide.

- Base URL: `https://api.mnotify.com/api`
- Authentication: a single API key, sent as the `key` query parameter of every request
- Verified against the live API on 2026-10-10 (see [Verification](#verification))

## Installation

Two guides ship with this package:

- [`docs/INSTALL-OPTIONS.md`](docs/INSTALL-OPTIONS.md): every way to get the node into a workflow -
  by name from npm, from this tarball by hand (works before publishing), managed by environment
  variables across many instances, or as a live dev preview.
- [`docs/PUBLISHING.md`](docs/PUBLISHING.md): the npm publishing runbook, including the token and
  two-factor settings, version discipline, and what n8n requires for verification.

### From n8n's Community Nodes UI (self-hosted)

1. Open **Settings > Community Nodes > Install a community node**.
2. Enter the package name `n8n-nodes-mnotify` (or a URL to the packed `.tgz`).
3. Accept the risk notice and install. The node appears in the palette as **mNotify** and
   **mNotify Trigger**.

Community nodes are only available on self-hosted n8n, and the owner must have enabled
community packages (`N8N_COMMUNITY_PACKAGES_ENABLED=true`, the default).

### From a local tarball (manual, no registry needed)

```bash
npm pack                                     # produces n8n-nodes-mnotify-0.1.0.tgz
# on the n8n host, inside the n8n user folder (~/.n8n by default):
mkdir -p ~/.n8n/nodes && cd ~/.n8n/nodes
npm install /path/to/n8n-nodes-mnotify-0.1.0.tgz
# then restart n8n
```

In Docker, the n8n user folder is `/home/node/.n8n`, so the same commands run as:

```bash
docker cp n8n-nodes-mnotify-0.1.0.tgz n8n:/tmp/
docker exec n8n sh -c "mkdir -p /home/node/.n8n/nodes && cd /home/node/.n8n/nodes && npm install --legacy-peer-deps --no-audit --no-fund /tmp/n8n-nodes-mnotify-0.1.0.tgz"
docker restart n8n
```

Like every published community node, this package declares `n8n-workflow` as a peer dependency,
which n8n supplies at runtime. A plain `npm install` may try to fetch it from the registry and
fail building its native optional dependency; `--legacy-peer-deps` skips that fetch. The
Community Nodes UI install does not need the flag.

## Credentials

Create one credential per mNotify account: **mNotify API**, with a single field, the API key.
Find it in the mNotify dashboard under your account's API settings. The key doubles as the
account identity, so one credential cannot reach another account's data.

The node does not use a bearer token and does not send the key in a header: mNotify expects it as
the `key` query parameter, which the credential adds to every request automatically. The key is
never written to logs by this package.

## Resources and operations

| Resource | Operations |
| --- | --- |
| **Account** | Get SMS Balance, Get Voice Balance |
| **Contact** | Create, Delete, Get, Get Many, Get Many by Group, Update |
| **Group** | Create, Delete, Get, Get Many, Update |
| **IVR** | Create Scenario, Delete Scenario, Update Scenario, Get Scenario, Get Scenarios, Save Flow, Get Flow, Delete Flow, Launch Scenario, Initiate Call |
| **Report** | Get Message Status, Get Campaign Report, Get Periodic Report, Get Summary, Get Call Report, Get Call Status, Get Call Report for a Period |
| **Scheduled** | Get Many, Update |
| **Sender ID** | Register, Get Status |
| **SMS** | Send, Send to Group |
| **Template** | Create, Delete, Get, Get Many, Update |
| **Voice** | Send, Send to Group |

Successful delete operations return `{ "deleted": true }`. This replaces the previous
service-specific response fields; workflows using those fields should be updated.

Three operations are deliberately absent because the live API does not serve them, even though
the published documentation lists them: `POST /sms/send` as a "quick" alias, the
`/voice/ivr/scenario...` paths, and `/schedule` as a standalone collection. The equivalents are
`SMS > Send`, the `IVR` resource and `SMS > Send` with a schedule, respectively.

## Trigger

**mNotify Trigger** receives callbacks for **USSD** sessions and **IVR** events. The workflow's
last node supplies the response to mNotify. A specific Callback Type rejects other callback shapes;
choose Any to accept all shapes.

### Secure callback setup

1. Generate a unique random URL-safe secret of at least 32 characters, for example with
   `node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"`.
2. Put it in **Webhook Shared Secret** in the **mNotify API** credential and select that credential
   in the trigger. This secret is separate from your API key.
3. Append `?mnotify_token=YOUR_SECRET` to the trigger's Test or Production URL before giving it to
   mNotify. If the URL already has a query string, use `&mnotify_token=YOUR_SECRET` instead.
   Never post the full URL publicly. Query secrets can appear in proxy, access and service logs;
   redact query strings, restrict access to logs, and use HTTPS. Rotate a leaked secret and update
   the callback URL with mNotify.
4. Verify with your mNotify integration that it preserves the query string when invoking the
   callback. The published mNotify documentation does not specify a callback signature or guarantee
   query-string preservation. This shared token authenticates possession of the URL, not the
   sender's identity, and does not prevent replay of a captured request.

Requests with a missing, invalid, or too-short secret receive HTTP 401 without running the workflow;
requests with a nonmatching callback type receive HTTP 400. The token and raw request headers are
not emitted into the workflow output.

**Migration from 0.2.0:** Existing trigger callbacks will be rejected until the credential has a
secret and the URL registered with mNotify includes it. Raw `headers` are no longer in trigger output.
API action nodes continue to use the same credential without requiring a webhook secret.

mNotify has **no API to register or manage callback URLs**. The callback URL to paste into the
dashboard (or to send to mNotify support for USSD) is shown on the trigger's node, and it must
be reachable from the internet. For USSD, mNotify also requires the URL to be registered on
their side before they will call it.

## What this package knows about the live API

Everything below was observed against the live service, and where it contradicts the public
documentation, the live behaviour won.

**Response envelopes.** Most endpoints answer `{ "status": "success", "code": "2000", ... }`, but
not all: `/ivr-scenarios` answers HTTP 201 with `{ "message": ..., "data": [...] }` and no
`status` field at all, and the balance endpoints carry no `code`. The node therefore treats a
reply as failed only when it actually looks failed (an `error` field, a non-success status, or a
code other than 2000) instead of demanding every field be present.

**Pagination.** `/contact`, `/contact/group/<id>`, `/report` and the call reports are paginated
with `page` and `per_page` (10 rows per page by default) and return a `pagination` object with
`last_page`. The contact and report reads in this node offer **Return All** and **Limit** so a
workflow is not silently limited to the first ten rows. `/group` and `/template` return
everything in one response.

**Delivery status lookups are weak.** `GET /status/<id>` answers
`{ "status": "success", "message": "No delivery report found for this campaign.", "report": [] }`
for IDs it does not hold, which is what it does for ordinary quick sends. The reliable paths for
delivery data are **Get Periodic Report**, which returns one row per recipient with `message_id`,
`campaign_id`, `status`, `date_sent` and `retries`, and **Get Campaign Report** for a single
campaign. When one of these returns no rows, the node emits a single explanatory item instead of
an empty output, so a workflow never fails silently.

**Sender IDs.** Register only letters and digits. A hyphenated sender ID (`StePro-OTP`) is
accepted by the registration endpoint and then silently rejects every send, while the same name
without the hyphen (`SteProOTP`) delivers. Sender ID names are also limited to 11 characters.
Registration does not mean approval: check **Sender ID > Get Status** and expect the status to be
lowercase `approved` before sending.

**Two purses.** `GET /balance/sms` returns `balance` (the SMS purse), `bonus`, and `wallet`. OTP
sends billed as `sms_type: otp` are charged from the **main wallet**, which is a different purse
from `balance`. With `wallet` at 0 the API refuses the send and no campaign is created, which
looks like the send silently doing nothing. Check both numbers before blaming the workflow.

**Time formats.** mNotify expects `YYYY-MM-DD hh:mm` for scheduled sends and the report summary
wants `YYYY-MM-DD HH:MM:SS`. Values are sent exactly as the workflow clock reads them: this
package performs **no timezone conversion**, so schedule from a workflow whose timezone matches
the account's expectation.

**Request encoding.** The voice and IVR endpoints take multipart form bodies (`file`,
`voice_file`); the JSON endpoints take a JSON body. The node picks the right encoding per
operation. Voice file fields accept binary data from an earlier node
in the workflow, which suits Drive or HTTP download steps.

## Verification

The package ships its own verification, and the results are reproducible:

```bash
npm run build
npm test                          # structure, endpoints and helper unit tests (no network, no key)
MN_API_KEY=... MN_SENDER_ID=... node --test test/live-api.test.mjs   # read-only live checks
node test/tools/probe-endpoints.mjs                                  # re-probe every path the node calls
```

- `test/node-structure.test.mjs` loads the compiled node the way n8n does and asserts the
  resource and operation inventory, that a parameter name may only repeat when the copies can
  never both be shown, and that every parameter and operation is documented.
- `test/endpoints.test.mjs` checks the single source of truth for paths
  (`nodes/MNotify/endpoints.ts`) against recorded live probe results and fails if a path that the
  live API does not serve creeps back in.
- `test/fixtures/live-endpoints.json` is the recorded probe output: for each path, which HTTP
  methods exist. It was produced by `test/tools/probe-endpoints.mjs` against the live API on
  2026-10-10, where a JSON `401` (bad key, route exists) is distinguished from an HTML `404` (no
  such route).
- `test/live-api.test.mjs` runs the real compiled node code against the real API using a harness
  that fakes only n8n's own plumbing, and covers balances, sender ID status, groups, templates,
  contacts, IVR scenarios, scheduled messages, a periodic report and the wrong-key error message.
  It performs no writes: nothing is sent, created or charged.
- `test/manual/docker-load-verify.sh` is the end-to-end check: it builds and packs the package,
  starts a throwaway n8n in Docker, installs the tarball the way a self-hosted user does, asserts
  that n8n registered `n8n-nodes-mnotify.mNotify` (plus the tool and trigger variants), imports a
  credential and two workflows, then executes them and prints the real payloads. Run it with
  `MN_API_KEY=... bash test/manual/docker-load-verify.sh`. The key is substituted inside the
  container and never touches this repository.

## Development

```bash
npm install
npm run build      # compile TypeScript to dist/ (what n8n loads)
npm run lint       # the official n8n community-node ruleset
npm run dev        # n8n-node dev, a scratch n8n with this node loaded
npm test
```

## Attribution

This is an unofficial community node. It is not published by, endorsed by, or supported by mNotify or
Bulk Messaging Solutions. The mNotify and BMS names and marks belong to their owners and are used here
only to identify the service the node connects to. The bundled icon is the BMS logo as published on
mnotify.com.

## License

[MIT](LICENSE)
