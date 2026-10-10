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

## Do you need a GitHub account? No

Publishing to npm needs only:

- an npm account with a **verified email address**,
- a token with publish permission (and the 2FA bypass if your account has 2FA enabled for writes),
- a package name that is free. `n8n-nodes-mnotify` is free.

GitHub is not involved in publishing, and a suspended GitHub account does not block it.

GitHub matters for two optional things:

1. **The `repository` link on the npm page.** `package.json` currently points at
   `github.com/steprotech/n8n-nodes-mnotify`. That is only a hyperlink; it does not have to resolve.
   Point it at wherever the code actually lives (your GitLab, say) or drop the field until the repo
   exists.
2. **Verification through n8n's Creator Portal**, which since 1 May 2026 requires a package to be
   published from **GitHub Actions** with a provenance statement. That specific track needs GitHub
   back.

Worth knowing: npm's own provenance feature supports **GitHub Actions and GitLab CI/CD**, so a
GitLab pipeline can produce a signed provenance statement for the package. It satisfies npm, but it
does not satisfy n8n's GitHub-specific verification rule. So the sequence that fits your situation
is: publish to npm now without GitHub, use the node everywhere, and add the GitHub Actions publish
workflow later if you decide you want the verified badge.

## Updating after publishing

Yes, you can update it as often as you like, and you should expect to: a first release almost always
turns up something.

- **A published version is immutable.** You cannot change 0.1.0 once it is up. You publish 0.1.1.
- **Bump the version, then publish again:**

  ```bash
  npm version patch --no-git-tag-version   # 0.1.0 -> 0.1.1
  npm publish                              # runs the guard, then uploads
  npm view n8n-nodes-mnotify version       # confirm what the registry holds
  ```

- **How your instances get the update:**
  - GUI install: Settings > Community Nodes shows an update button for the package.
  - Manual install: `docker exec -it n8n sh -c "cd ~/.n8n/nodes && npm update n8n-nodes-mnotify"`, then restart n8n.
  - Environment-variable managed: change the `version` (or the name) in `N8N_COMMUNITY_PACKAGES` and
    restart; n8n reconciles it on startup.
- **If a version turns out to be broken:** mark it and ship a fix.

  ```bash
  npm deprecate n8n-nodes-mnotify@0.1.1 "Broken sender ID handling, use 0.1.2"
  npm version patch --no-git-tag-version && npm publish
  ```

  Installs of a deprecated version print the warning; existing users are not deleted or changed.
- **Unpublishing** is deliberately restricted: within **72 hours** of a publish you can unpublish a
  version, after that only if it meets npm's criteria (for example, no dependents). Deprecate is
  usually the better tool. Unpublishing an entire package that people already depend on can also
  break their installs, which is why npm makes it hard.

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
