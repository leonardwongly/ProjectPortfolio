# Content Source Inventory

This inventory is the acceptance contract for profile and resume reconciliation. Public-facing claims should be traceable to one of the sources below before they are published.

## Source Classes

| Source class | Use for | Current repository surface | Validation |
| --- | --- | --- | --- |
| Resume artifacts | Current resume copy and downloadable resume links | `docs/resume.pdf`, `docs/resume.docx`, `data/profile.json`, `src/index.html` | Manual artifact review, `npm run build`, `npm run test:content` |
| Structured profile data | Hero copy, current role, education, writing, honors, community, contact copy | `data/profile.json` | `scripts/build.js` schema validation, `tests/security/content-parity.test.mjs` |
| Credentials data | Certification title, issuer, issue date, credential ID, public link, icon | `data/certifications.json` | `tests/security/content-parity.test.mjs`, unsafe URL/path tests |
| Work history data | Role chronology and impact bullets | `data/experience.json` | `scripts/build.js` schema validation, generated page review |
| Skills data | Skills grouped by theme | `data/skills.json` | `tests/security/content-parity.test.mjs` |
| Featured work data | Selected project cards and external project links | `data/featured-projects.json` | Unsafe URL/path tests and generated page review |
| Reading data | Reading page metadata and cover references | `data/reading.json`, `book/` | `npm run check:reading`, cover asset validation |

## Current Required Facts

| Fact | Source status | Target file | Rendered surface | Gate |
| --- | --- | --- | --- | --- |
| Name is Leonard Wong | Present | `data/profile.json` | Hero, schema.org Person | `npm run test:content` |
| Current role is Software Engineer | Present | `data/profile.json` | Hero, schema.org Person | `npm run test:content` |
| Current employer context includes NCS Group | Present | `data/profile.json`, `data/experience.json` | Hero, experience, schema.org | `npm run test:content` |
| Client context includes Public Service Commission Singapore as IT vendor | Present | `data/profile.json`, `data/experience.json` | Hero, experience, schema.org affiliation | `npm run test:content` |
| Nanyang Polytechnic diploma dates are 2014-2017 | Present | `data/profile.json` | Credentials section | `npm run test:content` |
| AI/security credentials remain visible and linked where public URLs exist | Present | `data/certifications.json` | Certifications grid | `npm run test:content` |
| Public articles remain visible with safe links | Present | `data/profile.json` | Writing section, schema.org Article | `npm run test:content` |
| Community/leadership entries are generated from data, not hardcoded HTML | Present | `data/profile.json` | Community accordion | `npm run test:security` |
| Reading records have non-empty title, author, year, ISBN, and valid cover references | Present | `data/reading.json` | Reading page | `npm run check:reading` |

## Blocked Or Owner-Confirmed Fields

- Languages are supported by the data model but intentionally left empty until an owner-approved public wording is available.
- New community, awards, publication, or credential claims should be added only after the source URL, artifact, or owner-approved wording is recorded in the implementation PR.
- Private credential URLs or internal-only evidence must not be added to generated pages. Leave the credential link empty and explain the reason in the PR if no public URL exists.

## Update Checklist

- [ ] Identify the source class before editing content.
- [ ] Update structured JSON rather than generated HTML when a tokenized section exists.
- [ ] Run `npm run build`.
- [ ] Run `npm run test:content` for profile or credential changes.
- [ ] Run `npm run check:reading` for reading changes.
- [ ] Confirm generated output changes are limited to expected files.
