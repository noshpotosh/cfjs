import { basicSetup, EditorState, Prec, EditorView, keymap, html, javascript, json } from '../vendor/codemirror.js';
import { createPreview } from './preview.js';

let dependencies;
let runSequence = 0;
async function fixedDependencies() {
  dependencies ||= Promise.all(['./vendor/cfjs.js', './styles/examples.css'].map(async path => {
    const url = new URL(path, location.href).href;
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Could not load preview dependency: ${path}`);
    return [url, await response.text()];
  })).then(Object.fromEntries).catch(error => { dependencies = null; throw error; });
  return dependencies;
}

export async function openEditor(example) {
  if (example.exampleEditor) { example.exampleEditor.enter(); return; }
  const supplied = await fixedDependencies();
  const panels = [...example.querySelectorAll('[role="tabpanel"]')];
  const originals = panels.map(panel => panel.querySelector('code').textContent);
  const paths = JSON.parse(example.dataset.files);
  const entry = new URL('./examples/' + paths[0], location.href).href;
  const controls = example.querySelector('.editor-controls');
  const status = example.querySelector('.preview-status');
  const dirty = example.querySelector('.draft-status');
  const edit = example.querySelector('.edit-example');
  let views = [], lastRun = [...originals], currentRun, editing = false, errors = [];
  const values = () => views.map(view => view.state.doc.toString());
  function markDraft() {
    dirty.textContent = values().some((value, i) => value !== lastRun[i]) ? 'Unrun edits — click Run to update the preview.' : 'Preview matches these files.';
  }
  function run() {
    const snapshot = values();
    const files = Object.fromEntries(paths.map((path, i) => [new URL(path, entry).href, snapshot[i]]));
    currentRun = String(++runSequence);
    errors = [];
    status.textContent = 'Loading snapshot…';
    try {
      const source = createPreview(files, entry, supplied, currentRun);
      const previous = example.querySelector('iframe');
      const frame = document.createElement('iframe');
      frame.title = previous.title;
      frame.setAttribute('sandbox', 'allow-scripts');
      frame.srcdoc = source;
      previous.replaceWith(frame);
      lastRun = snapshot;
      markDraft();
    } catch (error) { status.textContent = `Preview could not run: ${error.message}`; }
  }
  addEventListener('message', event => {
    const data = event.data;
    if (event.source !== example.querySelector('iframe').contentWindow || data?.type !== 'cfjs-preview' || data.run !== currentRun) return;
    if (data.kind === 'error' && typeof data.message === 'string') {
      if (errors.length < 6 && !errors.includes(data.message)) errors.push(data.message);
      status.textContent = errors.join('\n');
    } else if (data.kind === 'loaded' && !errors.length) status.textContent = 'Snapshot loaded.';
  });
  const extensions = index => [
    Prec.highest(keymap.of([
      { key: 'Mod-Enter', run: () => { run(); return true; } },
      { key: 'Escape', run: () => { controls.querySelector('.run-example').focus(); return true; } }
    ])),
    basicSetup, paths[index].endsWith('.js') ? javascript() : paths[index].endsWith('.json') ? json() : html(),
    EditorView.lineWrapping,
    EditorView.contentAttributes.of({ 'aria-label': `Edit ${paths[index]}` }),
    EditorView.updateListener.of(update => { if (update.docChanged) markDraft(); })];
  views = panels.map((panel, index) => {
    const host = document.createElement('div');
    host.className = 'editor-host';
    panel.append(host);
    const view = new EditorView({ parent: host, state: EditorState.create({ doc: originals[index], extensions: extensions(index) }) });
    panel.editorView = view;
    return view;
  });
  controls.querySelector('.run-example').addEventListener('click', run);
  controls.querySelector('.reset-example').addEventListener('click', () => {
    views.forEach((view, index) => view.setState(EditorState.create({ doc: originals[index], extensions: extensions(index) })));
    run();
  });
  controls.querySelector('.exit-editor').addEventListener('click', () => {
    editing = false;
    example.classList.remove('editing');
    controls.hidden = true;
    edit.hidden = false;
    panels.forEach((panel, index) => { panel.querySelector('code').textContent = values()[index]; });
    edit.focus();
  });
  example.exampleEditor = {
    enter() {
      editing = true;
      example.classList.add('editing');
      controls.hidden = false;
      edit.hidden = true;
      markDraft();
      this.select();
    },
    select() {
      const index = panels.findIndex(panel => !panel.hidden);
      if (editing && index >= 0) { views[index].requestMeasure(); views[index].focus(); }
    }
  };
  example.exampleEditor.enter();
}
