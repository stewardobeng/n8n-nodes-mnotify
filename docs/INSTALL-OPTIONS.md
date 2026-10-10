# Using mNotify in n8n: every install option

This covers every way to get the mNotify node into a workflow, including ways that work **right
now, before the package is published to npm**.

For each method: what it needs, the exact commands, and whether it was verified on a real n8n.

| Method | Works before publishing | Needs npm publish | Best for |
| --- | --- | --- | --- |
| 1. GUI install by name | No | Yes | The normal case once published |
| 2. Manual install from a tarball or folder | Yes | No | Using it today, offline, queue mode, private installs |
| 3. Managed by environment variables | Yes (with `file:` or a published name) | No | Rolling it out across many n8n instances |
| 4. Local dev preview from the source | Yes | No | Editing the node itself and testing changes live |

---

## Method 1: install by name from the npm registry (after publishing)

1. In n8n: **Settings > Community Nodes > Install**.
2. Enter the package name: `n8n-nodes-mnotify`
   - Pin a version: `n8n-nodes-mnotify@0.1.0`
   - Or a dist-tag you publish later: `n8n-nodes-mnotify@beta`
3. Tick *I understand the risks of installing unverified code from a public source*.
4. Install, then restart n8n if your instance does not reload automatically.

You must be the instance **owner or an admin**. The **Browse** button in that dialog opens an npm
search limited to packages tagged `n8n-community-node-package`, which is how this package is
tagged, so it will show up there too.

Note: installing with a dist-tag resolves the tag to a version at that moment. Later updates
compare versions, not the tag.

## Method 2: manual install from this tarball (works today, no publishing)

This is the documented path for private packages and for queue mode, and it is the method that was
verified end to end on a real n8n for this package.

**Docker on the n8n host:**

```bash
# copy the tarball into the container
docker cp n8n-nodes-mnotify-0.1.0.tgz n8n:/tmp/

# install it into the n8n user folder (~/.n8n/nodes is the manual install location)
docker exec n8n sh -c "mkdir -p /home/node/.n8n/nodes && cd /home/node/.n8n/nodes && \
  npm install --legacy-peer-deps --no-audit --no-fund /tmp/n8n-nodes-mnotify-0.1.0.tgz"

docker restart n8n
```

**Bare metal / non-Docker install:**

```bash
mkdir -p ~/.n8n/nodes && cd ~/.n8n/nodes
npm install --legacy-peer-deps --no-audit --no-fund /path/to/n8n-nodes-mnotify-0.1.0.tgz
# restart your n8n service
sudo systemctl restart n8n
```

**Why `--legacy-peer-deps`:** like every published community node, this package declares
`n8n-workflow` as a peer dependency, which n8n supplies at runtime. Without the flag npm may try to
fetch it from the registry and fail building its native dependency.

**Installing from an unpacked folder instead of a tarball** (useful while hacking on the source):

```bash
cd /path/to/n8n-nodes-mnotify && npm install && npm run build
cd ~/.n8n/nodes && npm install --legacy-peer-deps --no-audit --no-fund /path/to/n8n-nodes-mnotify
```

Then restart n8n. The node loads its compiled `dist/` output, so a rebuild requires a restart.

**Verify it loaded** (what I ran on the test instance):

```bash
docker exec n8n sh -lc 'n8n export:nodes --output=/tmp/nodes.json >/dev/null 2>&1; \
  node -e "const l=require(\"/tmp/nodes.json\"); \
  console.log(l.filter(x=>String(x.name).includes(\"mnotify\")).map(x=>x.name).join(\"\n\"))"'
```

Expected output: `n8n-nodes-mnotify.mNotify`, `n8n-nodes-mnotify.mNotifyTrigger`, and
`n8n-nodes-mnotify.mNotifyTool` (n8n generates the tool variant automatically because the node can
be used by AI Agent nodes).

## Method 3: managed by environment variables (for a fleet)

Available from n8n **2.21.0**. n8n reconciles installed packages against this list on every
startup: it installs missing ones, corrects versions, and **uninstalls any community package that
is not in the list**.

```bash
N8N_COMMUNITY_PACKAGES_ENABLED=true
N8N_COMMUNITY_PACKAGES_MANAGED_BY_ENV=true
N8N_COMMUNITY_PACKAGES=[{"name":"n8n-nodes-mnotify","version":"0.1.0"}]
```

Read the warning before you use this on an instance that already has community packages installed
from the GUI: the first start with `N8N_COMMUNITY_PACKAGES_MANAGED_BY_ENV=true` removes everything
that is not listed. The Community Nodes settings page becomes read-only while this is on.

This is the cleanest way to roll the node out to several of your servers: add it to the same
compose/env file that already carries each instance's settings.

## Method 4: live dev preview from the source

```bash
cd /path/to/n8n-nodes-mnotify
npm install
npm run dev          # n8n-node dev: boots a real n8n with this node linked, rebuilds on change
```

It installs its own n8n under `~/.n8n-node-cli` (about 2 GB, so it wants disk and RAM), and serves
the editor on port 5678. Use `--custom-user-folder` to move that data, or `--external-n8n` if you
run n8n elsewhere. This is the method for editing the node, not for using it.

---

## Using the node in a workflow

**1. Add the credential.** Once, per mNotify account: create a credential of type
**mNotify API** and paste the API key from the mNotify dashboard (Settings > API in mNotify). The
key travels as the `key` query parameter of every request; the node never logs it.

**2. Drag in the node.** Search the nodes panel for **mNotify**. Pick a resource (Account, SMS,
Voice, Contact, Group, Template, IVR, Report, Scheduled, Sender ID) and then an operation, for
example *Account > Get SMS Balance* or *SMS > Send*.

**3. Useful first checks.** *Account > Get SMS Balance* is free and proves the credential works.
Watch both numbers it returns: `balance` is the SMS purse, `wallet` is the main purse that OTP
sends are billed from.

**4. AI Agent use.** Because the node declares tool support, it also appears as **mNotify Tool**
inside an AI Agent node, so an agent can send an SMS or read a balance as a tool.

**5. Receive callbacks.** The **mNotify Trigger** node gives you two webhook URLs (production and
test). mNotify **cannot register callback URLs through its API**, so you copy the URL into the
mNotify dashboard by hand, and for USSD you have to ask mNotify support to register it on their
side. Do not expect the node to subscribe itself.

**6. Sender ID reminder.** Register a sender ID of letters and digits only, 11 characters max. A
hyphenated name is accepted at registration and then rejects every send, and a send billed as OTP
needs a funded `wallet` or the API refuses it with HTTP 402.

## What was verified for this package

- Method 2, end to end on a real n8n: tarball installed, all three node types registered, two
  workflows executed against the live mNotify API returning `{"balance":1222,"bonus":0,"wallet":0}`
  and five contacts. Reproduce with `MN_API_KEY=... bash test/manual/docker-load-verify.sh`.
- Method 4 boots and links the package, but it installs a second full n8n (about 2 GB), so it was
  stopped on a small host and is listed here as the development path rather than the deployment one.
- Method 1 is the documented npm path. It could not be run before publishing; it is the first
  thing to try after the package is on npm.
- Method 3 is documented behaviour from n8n 2.21.0 and was not exercised here because it needs an
  instance on the fleet; check `n8n --version` before relying on it.
