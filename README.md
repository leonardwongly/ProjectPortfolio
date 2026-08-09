
# ProjectPortfolio

This is the main version of [ProjectPortfolio](https://github.com/leonardwongly/ProjectPortfolio)

---

The idea is to convert my resume into a viewable portfolio web page. *Also it is fun to do it*
<br/>There isn't much difference between the beta & main codebase. 
Usually updates are done to the beta before it is committed to the main codebase. Hence, more commits are at the beta codebase than the main codebase AKA all the rough edges


[Click here to check out the Main Website](https://leonardwong.tech)
<br/>


**Feedback are welcome**

---

Feel free to follow me on my socials 😶‍🌫️<br/>
[Mastodon](https://mastodon.leonardwong.tech)
<br/>
[Linkedin](https://linkedin.leonardwong.tech)

---

## Development notes

- Source HTML lives in `src/` with shared partials in `partials/`.
- Profile, writing, honors, skills, experience, certifications, featured work, and reading content live in `data/`.
- Regenerate the production pages after edits:
  ```bash
  npm run build
  ```
- Run the static validation suite:
  ```bash
  npm run test:security
  ```
- Run the full local release gate after source and generated files are in sync:
  ```bash
  npm run validate:full
  ```
- Audit reading metadata, link health, and size budgets independently:
  ```bash
  npm run check:reading
  npm run check:links
  npm run check:links:preflight
  npm run check:performance
  npm run check:assets
  npm run check:telemetry
  ```
- Local vendor scripts are stored in `js/vendor/` and governed by:
  ```bash
  node scripts/check-vendor-governance.mjs
  node scripts/check-vendor-upstream.mjs
  node scripts/update-vendor.mjs
  ```
- Font WOFF2 files are generated from the OTF sources via FontTools.
- See `docs/static-content-runbook.md` for the content update workflow and validation gates.
- See `docs/content-source-inventory.md` for owner-verified content sources and `docs/media-asset-policy.md` for cover/image budget rules.
