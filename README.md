
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
[Twitter](https://twitter.leonardwong.tech)
<br/>
[Linkedin](https://linkedin.leonardwong.tech)

---

## Development notes

- Source HTML lives in `src/` with shared partials in `partials/`.
- Regenerate the production pages after edits:
  ```bash
  node scripts/build.js
  ```
- Local vendor scripts are stored in `js/vendor/` (PWA update + Workbox).
- Font WOFF2 files are generated from the OTF sources via FontTools.
