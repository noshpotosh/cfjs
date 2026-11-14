# Browser dependencies

These checked-in files are served directly. No install or build is needed to use the docs.

- `cfjs.js`: byte-identical copy of the root runtime. Update with `npm run docs:sync`; `npm test` checks equality.
- `codemirror.js`: minified ES module containing CodeMirror and its language packages. Loaded only when Edit example is selected. Licenses are in `codemirror.LICENSE`.

## CodeMirror provenance

Prepared with esbuild 0.28.2 (bundle, ESM, target es2022, minify), exporting basicSetup, EditorState, Prec, EditorView, keymap, html, javascript, and json. This is a vendor asset, not generated site output. No CDN or runtime package resolution is used.

Included packages:

- @codemirror/autocomplete@6.20.4
- @codemirror/commands@6.11.1
- @codemirror/lang-css@6.3.1
- @codemirror/lang-html@6.4.12
- @codemirror/lang-javascript@6.2.5
- @codemirror/lang-json@6.0.2
- @codemirror/language@6.13.1
- @codemirror/lint@6.9.7
- @codemirror/search@6.7.2
- @codemirror/state@6.7.6
- @codemirror/streamparser@6.0.0
- @codemirror/view@6.43.15
- @lezer/common@1.5.5
- @lezer/css@1.3.9
- @lezer/highlight@1.2.5
- @lezer/html@1.3.13
- @lezer/javascript@1.5.6
- @lezer/json@1.0.3
- @lezer/lr@1.4.12
- @marijn/find-cluster-break@1.0.4
- codemirror@6.0.2
- crelt@1.0.7
- style-mod@4.1.4
- w3c-keyname@2.2.8

To update this dependency, prepare the same exports in a temporary npm project using explicitly chosen package versions, bundle to one browser ES module, and replace the vendor file and collected package licenses together. Record the new versions here and run the full browser suite. Ordinary documentation edits never require this step.
