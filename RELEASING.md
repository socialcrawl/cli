# Releasing `socialcrawl`

No npm token is stored anywhere. The first version is published by hand; after that, a tag publishes through npm's trusted publishing.

## Every release

1. In `CHANGELOG.md`, date the entry: `## 0.1.0 (DD/MM/YYYY)`. Set the same version in `package.json` and `src/version.ts`. Commit and push.
2. On the maintainer's machine, in this folder:

   ```bash
   SOCIALCRAWL_LEAK_GATE=<path to scan-public.mjs> npm run release:check
   ```

   It runs the leak gate, the whole suite and the build, then checks the version, the changelog entry and the files the package would publish. Go on only when it ends with "is ready".

## The first release only (0.1.0)

3. Sign in to npm as `ridiodevs` (`npm login`), then publish from this folder and enter the one-time code npm asks for:

   ```bash
   npm publish --access public
   ```

4. On npmjs.com, open the `socialcrawl` package, Settings, Trusted publishing, and add GitHub Actions with organization `socialcrawl`, repository `cli`, workflow `release.yml`.

## Every release, last step

5. Tag and push:

   ```bash
   git tag v0.1.0 && git push origin v0.1.0
   ```

   The release workflow runs the tests and checks again, publishes to npm with provenance (or logs that the version is already on npm, as after step 3), and creates the GitHub release from the changelog entry.
