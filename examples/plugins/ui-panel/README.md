# ui-panel example

Reference plugin demonstrating a contributed UI panel — declares
`contributions.panels` in `opencodex.plugin.json` and ships a `panel.html`
that the host renders inside a sandboxed renderer iframe.

## Manifest

```json
{
  "name": "ui-panel",
  "displayName": "UI Panel Example",
  "entry": "dist/index.js",
  "engines": { "opencodex": "^0.1.0" },
  "permissions": ["ui.panel"],
  "contributions": {
    "panels": [{ "id": "ui-panel-hello", "title": "Hello Panel", "entry": "panel.html" }]
  }
}
```

## Activate snippet

```ts
import { definePlugin } from '@opencodex/plugin-sdk';

export default definePlugin({
  activate(host) {
    host.logger.info('ui-panel example plugin activated');
  },
});
```

## Iframe trust model

`panel.html` is loaded inside a renderer iframe. The example ships a strict
Content-Security-Policy `<meta>` tag (`default-src 'none'; script-src 'none';
connect-src 'none'; ...`) so a freshly-installed panel cannot run scripts or
make network requests — even before the host-side sandbox lands. Relax these
directives deliberately when you add JavaScript or remote assets, and review
[`docs/security-model.md`](../../../docs/security-model.md) before shipping a
panel that opts out of any directive.
