# Publishing n8n-nodes-mnotify to npm

## Status

- The package name **`n8n-nodes-mnotify` is free** on the public registry (checked: 404 Not Found).
- This machine is **not logged in to npm** (`npm whoami` returns `ENEEDAUTH`), and there is no token
  in `~/.npmrc`, so publishing needs a one-time credential step by you.
- The publish payload is built and verified: `npm publish --dry-run` runs the pre-publish guard
  (build, lint, tests), packs 55 files, **41 kB packed / 228 kB unpacked**, and stops only at the
  login check.
- What gets published is the compiled `dist/` output plus `package.json`, `README.md` and
  `LICENSE`. Sources and tests are intentionally not shipped in the npm tarball; they are in the zip
  bundle and in git.

## One-time: create an npm token

1. Sign in at npmjs.com, click your avatar, then **Access Tokens > Generate New Token**.
2. Choose **Granular Access Token**, with:
   - **Bypass two-factor authentication**: ticked. Without this, publishing from a script needs a
     2FA code typed at the prompt every time. (Since August 2026 this bypass does not cover
     account-identity or account-governance actions, only package publishing.)
   - **Permissions**: `Read and write (publish and stage)`. This is what allows publishing new
     versions.
   - **Select Packages**: all packages, or just `n8n-nodes-mnotify` if you want the token scoped to
     this package only.
   - Optional: an **Allowed IP Ranges** entry to limit where the token can be used.
3. Copy the token. npm shows it once.

Then put it where npm reads it, **in your own shell, so the token never passes through chat**:

```bash
npm config set //registry.npmjs.org/:_authToken=YOUR_TOKEN_HERE --location=user
npm whoami        # should print your npm username
```

`npm whoami` printing your username is the proof the credential works. I can run the publish after
that without ever reading the token file.

## Publishing

```bash
cd /home/ubuntu/projects/n8n-nodes-mnotify

# pick the next version (0.1.0 for the first release, then 0.1.1, 0.2.0, ...)
npm version patch --no-git-tag-version     # or: npm version 0.1.1

# this runs the guard (build + lint + full test suite) and uploads
npm publish

# verify what the registry now holds
npm view n8n-nodes-mnotify version dist.tarball
```

A first publish of an unscoped package is public automatically. Use `npm publish --tag beta` if you
want a pre-release that does not take over `latest`.

Because the guard runs the whole test suite, a broken build cannot be published by accident. The
live API tests skip themselves when `MN_API_KEY` is not set, so publishing does not require the key.

## After publishing: installing it in n8n

Settings > Community Nodes > Install > enter `n8n-nodes-mnotify` > accept the unverified-code
notice. Details, plus the manual and environment-variable methods, are in
[docs/INSTALL-OPTIONS.md](INSTALL-OPTIONS.md).

## Version discipline

- Bump the **patch** for fixes that keep workflows working (0.1.1).
- Bump the **minor** for new operations or fields (0.2.0).
- Bump the **major** only when a change would break existing workflows, and note it in the README.
- npm versions are permanent: you cannot overwrite 0.1.0 once it is published, you can only
  deprecate it (`npm deprecate n8n-nodes-mnotify@0.1.0 "message"`) and publish a new version.

## Optional later: verification through n8n's Creator Portal

Any published npm package can be installed by name or from a tarball. **Verification** is a
separate, stricter track, and since 1 May 2026 n8n requires a package submitted for verification to
be published from **GitHub Actions with a provenance statement**; a publish from a local machine is
not accepted for verification. If you want that badge later, the steps are:

1. Push this repository to GitHub (the package already points at
   `github.com/steprotech/n8n-nodes-mnotify`).
2. Add a publish workflow (GitHub Actions, using `npm publish --provenance` with the npm token as a
   repository secret) and a `release` script, in the shape that `npm create @n8n/node` scaffolds.
3. Publish a release through the workflow, then submit the package in the n8n Creator Portal.

Say the word and I will set that up: repo, workflow, secret wiring, and the release run.

## Small print worth knowing

- The package must keep the `n8n-community-node-package` keyword and the `n8n` block in
  `package.json`; n8n's own linter (`npm run lint`) enforces the rest of the community-node rules.
- `prepublishOnly` in this package runs `build && lint && test`. If you ever delete that, a stale
  `dist/` could be published.
- `dist/tsconfig.tsbuildinfo` is excluded from the published files on purpose: it is a 211 kB build
  artefact that has no use to consumers and tripled the tarball size.
