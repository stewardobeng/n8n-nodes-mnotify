> **For n8n Creator Portal verification:** do not use local publishing instructions in this historical guide. Use the GitHub Actions process in [PUBLISHING.md](PUBLISHING.md) to publish with provenance.

# Publishing n8n-nodes-mnotify from your Windows machine

This is the route where the npm credential exists only on your computer. Nothing here needs SSH to
any server, and no token or one-time code is ever sent to anyone.

## Before you start

- Node.js 22 or newer. Check with `node -v`. If it is missing:
  `winget install OpenJS.NodeJS.LTS`, then open a new PowerShell window.
- An npm account with a verified email address.
- Run everything in PowerShell. Commands below are safe to copy one line at a time.

## Route A: publish from the repository (recommended)

```powershell
# 1. Get the code. Either clone (needs your GitLab SSH key on this machine):
git clone git@gitlab.com:steprotech/n8n-nodes-mnotify.git
cd n8n-nodes-mnotify
#    or, without git: open the project in GitLab, Code > Download source code (zip), then extract it
#    and cd into the extracted folder.

# 2. Install exactly the locked dependencies, skipping native build scripts.
npm ci --ignore-scripts

# 3. Build. n8n loads dist/, so this has to run before publishing.
npm run build

# 4. Sign in. This is the only credential step, and it happens in your browser or with a one-time
#    code typed here, never in a chat.
npm login

# 5. Confirm you are the right account, and that the name is still free.
npm whoami
npm view n8n-nodes-mnotify version        # expect a 404 / "Not found" while it is unpublished

# 6. Publish. The prepublishOnly guard rebuilds, lints and tests first, so a broken package
#    cannot go out.
npm publish --access public

# 7. Verify what the registry actually holds. Do not trust the publish message alone.
npm view n8n-nodes-mnotify version dist.tarball
```

## Route B: publish the prebuilt tarball (fastest)

The tarball was built here and verified end to end: installed into a real n8n, all three node types
registered, two workflows executed against the live mNotify API. Publishing that file uploads the
exact same bytes and needs no dev dependencies and no build.

```powershell
npm login
npm publish C:\path\to\n8n-nodes-mnotify-0.1.0.tgz --access public
npm view n8n-nodes-mnotify version dist.tarball
```

## After publishing

- Confirm on the registry: `npm view n8n-nodes-mnotify version dist.tarball`. There is no approval
  step on npm and nothing to wait for.
- Install it anywhere by name: in n8n, Settings > Community Nodes > Install, and enter
  `n8n-nodes-mnotify`. Manual installs use `npm install n8n-nodes-mnotify` inside `~/.n8n/nodes`.
- Updates are new versions, because a published version is immutable:
  `npm version patch --no-git-tag-version` then `npm publish`. If a release is bad, use
  `npm deprecate n8n-nodes-mnotify@0.1.1 "reason"` rather than unpublishing.

## If something goes wrong

- `npm ci` tries to compile `isolated-vm` or `cpu-features` and fails on missing build tools:
  use `npm ci --ignore-scripts`. Those native addons are never built or loaded here, and n8n
  supplies them at runtime.
- The publish aborts in the guard (build, lint or test): that is the `prepublishOnly` guard doing its
  job. Run `npm run build`, `npm run lint` and `npm test` individually to see which one fails and
  send the error. To publish the already-built `dist/` anyway:
  `npm publish --ignore-scripts --access public`.
- `npm test` cannot find `test/*.test.mjs`: your Node is older than 22, which is what expands that
  pattern. Install current LTS, or run the files explicitly:
  `node --test test/endpoints.test.mjs test/generic-functions.test.mjs test/node-structure.test.mjs test/live-api.test.mjs`
- `E403` asking you to log in: run `npm login` again. With 2FA enabled, publish asks for the
  one-time code.
- `E403` name taken or too similar: check with `npm view n8n-nodes-mnotify`.

## Credential hygiene

- Never paste an npm token, password or one-time code into a chat, including this one, and never
  into a file that leaves your machine.
- `npm login` stores a session token in your own npm config (`%USERPROFILE%\.npmrc`). To remove it
  when you are done: `npm logout`.
- A granular access token, if you prefer one over an interactive login, can be limited to this one
  package, given an expiry, and restricted by IP range.
