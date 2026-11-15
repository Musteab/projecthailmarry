# Browser smoke checks

From the repository root after `pnpm install`:

```sh
node apps/web/node_modules/@playwright/test/cli.js install chromium
node apps/web/node_modules/@playwright/test/cli.js test --config e2e/playwright.config.mjs
```

Use `--repeat-each=3` for the rehearsal check. On macOS an installed Google Chrome is used; other systems use Playwright Chromium. The harness starts isolated services on 8799/5189 with a temporary database, cached intelligence and no external feeds. Failure screenshots and traces are printed under the temporary output directory.

The bundled mock journey covers grid isolation, manual work-order inspection/reopening and earthquake switching. Both bundled local scenes currently share repair roads; this check does not claim distinct repair priorities. The real Portland journey covers login, automatic response, isolation and automatic work-order reopening in both disasters, and verifies different repair roads. Scenario selection follows the returned catalogue until the UI owner adds stable IDs (issue #25).
