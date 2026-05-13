# Static Content Runbook

This portfolio is generated from source templates and JSON data. Edit the data and templates, then run the build before committing generated pages.

## Content Sources

- `data/profile.json` controls hero copy, education, publication links, writing, honors, structured data, and contact copy.
- `data/experience.json` controls role history and impact bullets.
- `data/skills.json` controls skill groups.
- `data/certifications.json` controls credentials. `link` is optional when a public credential URL is not available yet.
- `data/featured-projects.json` controls featured work.
- `data/reading.json` controls the reading page.

## Update Flow

1. Edit the relevant file in `data/`.
2. Run `npm run build`.
3. Run `npm run test:security`.
4. Check `index.html`, `reading.html`, `offline.html`, and `_headers` for expected generated changes.
5. For navigation or accordion changes, run `npm install` once, then `npm run test:integration`.

## Safety Checks

The build validates URLs, asset paths, and expected schema keys before rendering. External links must use `https:`. Relative links cannot contain path traversal segments.

The content parity tests verify that LinkedIn-derived profile facts such as the current NCS and Public Service Commission Singapore context, Nanyang Polytechnic dates, articles, AI credentials, and honors remain visible on the generated page.

## CI

The build workflow uses Node 20, regenerates static pages, checks that generated outputs are committed, and runs the security/content test suite.
