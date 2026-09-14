# Preinstalled browser tools

Playwright and its matching Chromium, browser system libraries, Noto CJK fonts,
`jq`, `zip`, and `unzip` are already installed. Do not reinstall or upgrade them
during a playable build. Keep this directory unchanged.

In a CommonJS acceptance script, use:

```js
const { chromium } = require('/opt/playable-tools/playwright.cjs')
```

In an ES module, use:

```js
import playwright from '/opt/playable-tools/playwright.cjs'
const { chromium } = playwright
```

The wrapper selects the bundled browser cache automatically; plain
`require('playwright')` from your workspace does not resolve this installation.
Use `chromium.launch({ headless: true })`. Write custom acceptance scripts,
screenshots and collected evidence under the task's `work/` directory.

Collect network requests, console errors, actual gameplay state and both
viewport screenshots in one browser session. Use real input and bounded
state-based waits. The environment check only verifies browser availability;
it is not a gameplay acceptance result. Follow the selected template's checks.
