# Releasing `socialcrawl`

No npm token is stored anywhere. Once trusted publishing is set up on npmjs.com, pushing a tag is the whole release and nothing is published from a laptop.

## Every release

1. In `CHANGELOG.md`, add and date the entry: `## 0.1.3 (DD/MM/YYYY)`. Set the same version in `package.json`, `package-lock.json` (its first two `"version"` fields) and `src/version.ts`. Commit and push.
2. Check it from a clean copy of `main`, since a working folder may hold changes that are not committed. Clone into your temp folder, never next to the other repositories:

   ```bash
   cd "$(node -p "require('os').tmpdir()")"
   git clone https://github.com/socialcrawl/cli socialcrawl-cli-release && cd socialcrawl-cli-release
   npm ci
   SOCIALCRAWL_LEAK_GATE=<path to scan-public.mjs> npm run release:check
   ```

   It runs the leak gate, the whole suite and the build, then checks the version, the changelog entry and the files the package would publish. Go on only when it ends with "is ready".
3. Tag and push:

   ```bash
   git tag -a v0.1.3 -m "socialcrawl 0.1.3" && git push origin v0.1.3
   ```

   The release workflow runs the tests and checks again, publishes to npm with provenance, and creates the GitHub release from the changelog entry. A version already on npm is not published again; the GitHub release is still created.
4. Delete the clone: `cd .. && rm -rf socialcrawl-cli-release`.

## Until trusted publishing is set up

The workflow cannot publish yet, so publish by hand from the clone of step 2, before step 3:

```bash
npm publish --access public --ignore-scripts --auth-type=web
```

npm opens a browser page to approve with the `ridiodevs` account's passkey. `--ignore-scripts` skips `prepublishOnly`, which `release:check` has already run.

To set up trusted publishing, once: on npmjs.com open the `socialcrawl` package, Settings, Trusted publishing, and add GitHub Actions with organization `socialcrawl`, repository `cli`, workflow `release.yml`. From then on, skip the manual publish.
