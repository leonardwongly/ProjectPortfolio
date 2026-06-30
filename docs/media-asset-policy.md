# Media Asset Policy

This project intentionally keeps book covers, profile images, vendor scripts, and generated pages under explicit size and safety budgets. The goal is a portfolio that remains inspectable, fast to build, and reliable on mobile connections.

## Source Rules

- Keep book covers under `book/<year>/`.
- Keep profile and logo images under `images/`.
- Keep vendored runtime libraries under `js/vendor/` and update them only through the vendor governance scripts.
- Do not reference external image URLs from generated content unless the build validation is extended to allow and monitor that source.
- Do not add archive files, originals, or design exports to web-served directories unless they are required for production rendering.
- Do not keep unused Bootstrap bundles, source maps, OTF fallbacks, icon fonts, or oversized unrendered book originals in the deployed web root.

## Validation Rules

Run these before committing media changes:

```bash
npm run build
npm run check:reading
npm run check:performance
npm run test:security
```

`npm run check:reading` confirms that every declared reading cover exists and that reading records do not regress into missing authors, ISBNs, years, or duplicate identifiers.

`npm run check:performance` enforces the current budgets:

| Surface | Budget |
| --- | ---: |
| `index.html` | 90 KiB |
| `reading.html` | 140 KiB |
| `offline.html` | 20 KiB |
| `css/custom.css` | 50 KiB |
| `js/main.js` | 32 KiB |
| `js/site.js` | 8 KiB |
| `pwabuilder-sw.js` | 8 KiB |
| `book/` | 80 MiB |
| `fonts/` | 512 KiB |
| `images/` | 8 MiB |
| `js/vendor/` | 2 MiB |
| Single book/image/font asset | 20 MiB |
| Unreferenced book asset | 512 KiB |
| Rendered reading media | 12 MiB |
| Rendered reading 2x media | 6 MiB |

## Cover Handling

The reading renderer caps high-DPI cover variants so the generated `srcset` does not encourage oversized downloads, and `npm run check:performance` enforces aggregate rendered reading-media budgets in addition to per-file, directory, and unreferenced-source budgets. When adding a cover:

1. Add the original only if it is needed for production.
2. Generate or provide the optimized `-300` and WebP variants when practical.
3. Run `npm run build` and confirm the rendered `reading.html` references the expected responsive assets.
4. Run `npm run check:performance` and lower asset weight if a budget fails.

## Budget Changes

Budget increases must be deliberate. A PR that raises a budget should explain:

- the asset or page driving the increase,
- why compression or removal is not sufficient,
- the expected user impact,
- and the follow-up plan if the increase is temporary.
