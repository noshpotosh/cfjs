import { prepareExamples, prepareHeadings, createSearchIndex } from './content.js';

let initialized = false;
async function initialize() {
  if (initialized || !document.querySelector('#main')) return;
  initialized = true;
  let searchIndex;
  let editorModule;
  let searchOpener;
  const mobile = matchMedia('(max-width: 767px)');
  const sidebar = document.querySelector('#sidebar');
  const main = document.querySelector('main');
  const closeNavigation = document.createElement('button');
  closeNavigation.type = 'button';
  closeNavigation.className = 'close-navigation';
  closeNavigation.textContent = 'Close navigation';
  sidebar.prepend(closeNavigation);
  function setNavigation(open, restore = true) {
    document.body.classList.toggle('navigation-open', open);
    sidebar.inert = mobile.matches && !open;
    main.inert = mobile.matches && open;
    if (mobile.matches && open) {
      sidebar.setAttribute('role', 'dialog');
      sidebar.setAttribute('aria-modal', 'true');
    } else {
      sidebar.removeAttribute('role');
      sidebar.removeAttribute('aria-modal');
    }
    document.querySelector('.menu-button')?.setAttribute('aria-expanded', String(open));
    if (open) closeNavigation.focus();
    else if (restore) document.querySelector('.menu-button')?.focus();
  }
  mobile.addEventListener('change', () => setNavigation(false, false));
  setNavigation(false, false);
  function updateChrome() {
    document.querySelectorAll('[data-nav-topic]').forEach(link => {
      if (link.dataset.navTopic === document.body.dataset.topic) link.setAttribute('aria-current', 'page');
    });
    document.querySelector('.menu-button')?.setAttribute('aria-expanded', String(document.body.classList.contains('navigation-open')));
  }
  document.addEventListener('cf:load', updateChrome);
  updateChrome();
  async function legacyLink() {
    if (document.body.dataset.topic !== 'index' || !location.hash) return;
    const links = await fetch('./data/legacy-links.json').then(response => response.json());
    const destination = links[decodeURIComponent(location.hash.slice(1))];
    // index's own new anchor is intentionally not in the old map.
    if (destination) {
      location.replace('./' + destination);
      return true;
    }
  }
  // Resolve legacy redirects before starting example fetches on the old page.
  if (await legacyLink().catch(() => false)) return;
  window.addEventListener('hashchange', () => legacyLink().catch(() => {}));
  function closeSearch() {
    document.querySelector('#search-dialog').close();
    searchOpener?.focus();
  }
  async function openSearch(opener) {
    const dialog = document.querySelector('#search-dialog');
    if (!dialog) return;
    searchOpener = opener;
    if (!dialog.open) dialog.showModal();
    document.querySelector('#search-input').focus();
    await search();
  }
  let searchVersion = 0;
  async function search() {
    const version = ++searchVersion;
    const status = document.querySelector('#search-status');
    const list = document.querySelector('#search-results');
    try {
      searchIndex ||= createSearchIndex().catch(error => { searchIndex = null; throw error; });
      const index = await searchIndex;
      if (version !== searchVersion) return;
      const query = document.querySelector('#search-input').value.trim().toLowerCase();
      const words = query.split(/\s+/).filter(Boolean);
      const results = words.length ? index.filter(item => words.every(word => `${item.title} ${item.heading} ${item.text}`.toLowerCase().includes(word))).sort((a, b) => {
        const score = item => (item.heading.toLowerCase().includes(query) ? 4 : 0) + (item.title.toLowerCase().includes(query) ? 2 : 0);
        return score(b) - score(a);
      }).slice(0, 30) : [];
      list.replaceChildren(...results.map(item => {
        const li = document.createElement('li'), a = document.createElement('a');
        a.href = item.url;
        const title = document.createElement('strong'), excerpt = document.createElement('span');
        title.textContent = `${item.title} / ${item.heading}`;
        const firstWord = words.find(word => item.text.toLowerCase().includes(word));
        const offset = firstWord ? Math.max(0, item.text.toLowerCase().indexOf(firstWord) - 35) : 0;
        excerpt.textContent = (offset ? '…' : '') + item.text.slice(offset, offset + 150);
        a.append(title, excerpt); li.append(a); return li;
      }));
      status.textContent = !words.length ? 'Type to search titles, API names, and explanations.' : results.length ? `${results.length} results. Use Arrow Down to move into results.` : 'No results. Try a feature name such as cf-data.';
    } catch {
      list.replaceChildren();
      status.textContent = 'Search could not load. Try again or browse the topic navigation.';
    }
  }
  document.addEventListener('input', event => {
    if (event.target.id === 'search-input') search();
  });
  document.addEventListener('cancel', event => {
    if (event.target.id === 'search-dialog') { event.preventDefault(); closeSearch(); }
  }, true);
  document.addEventListener('click', async event => {
    if (event.target.closest('.menu-button')) setNavigation(!document.body.classList.contains('navigation-open'));
    if (event.target.closest('.close-navigation')) setNavigation(false);
    const trigger = event.target.closest('.search-trigger');
    if (trigger) await openSearch(trigger);
    if (event.target.closest('[data-close-search], #search-results a')) closeSearch();
    if (event.target.id === 'search-dialog') {
      const bounds = event.target.getBoundingClientRect();
      if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) closeSearch();
    }
    const edit = event.target.closest('.edit-example');
    if (edit) {
      edit.disabled = true;
      const example = edit.closest('.examples');
      try {
        editorModule ||= import('./editor.js').catch(error => { editorModule = null; throw error; });
        await (await editorModule).openEditor(example);
      } catch {
        example.querySelector('.preview-status').textContent = 'Editor could not load. Original source and preview remain available. Reload to retry.';
      } finally { edit.disabled = false; }
    }
    const tab = event.target.closest('[role="tab"]');
    if (tab) selectTab(tab);
    const copy = event.target.closest('.copy-button');
    if (copy) {
      const panel = copy.closest('[role="tabpanel"]');
      const source = panel.editorView ? panel.editorView.state.doc.toString() : panel.querySelector('code').textContent;
      try {
        await navigator.clipboard.writeText(source);
        copy.textContent = 'Copied';
        document.querySelector('#copy-status').textContent = 'Example source copied.';
      } catch {
        copy.textContent = 'Copy failed';
        document.querySelector('#copy-status').textContent = 'Copy failed. Select the code and copy it manually.';
      }
    }
  });
  function selectTab(tab) {
    for (const sibling of tab.parentElement.querySelectorAll('[role="tab"]')) {
      const selected = sibling === tab;
      sibling.setAttribute('aria-selected', String(selected));
      sibling.tabIndex = selected ? 0 : -1;
      document.getElementById(sibling.getAttribute('aria-controls')).hidden = !selected;
    }
    tab.focus();
    if (tab.closest('.examples').exampleEditor) {
      const panel = document.getElementById(tab.getAttribute('aria-controls'));
      panel.editorView?.requestMeasure();
    }
  }
  document.addEventListener('keydown', async event => {
    const typing = event.target.matches('input, textarea, select, [contenteditable]');
    if (event.key === '/' && !typing) { event.preventDefault(); await openSearch(document.activeElement); }
    const dialog = document.querySelector('#search-dialog');
    if (dialog?.open && event.key === 'Escape') {
      event.preventDefault();
      closeSearch();
      return;
    }
    if (dialog?.open && ['ArrowDown', 'ArrowUp'].includes(event.key)) {
      const links = [...dialog.querySelectorAll('#search-results a')];
      if (links.length) {
        event.preventDefault();
        const current = links.indexOf(document.activeElement);
        const index = event.key === 'ArrowDown' ? Math.min(current + 1, links.length - 1) : current - 1;
        (links[index] || document.querySelector('#search-input')).focus();
      }
    }
    if (event.key === 'Escape' && document.body.classList.contains('navigation-open')) { event.preventDefault(); setNavigation(false); }
    if (event.key === 'Tab' && document.body.classList.contains('navigation-open')) {
      const focusable = [...sidebar.querySelectorAll('button, a[href]')];
      const first = focusable[0], last = focusable.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    }
    const tab = event.target.closest('[role="tab"]');
    if (tab && ['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) {
      event.preventDefault();
      const tabs = [...tab.parentElement.children];
      const index = tabs.indexOf(tab);
      selectTab(tabs[event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : (index + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length]);
    }
  });
  prepareHeadings();
  prepareExamples().catch(error => {
    for (const block of document.querySelectorAll('[data-example]')) {
      block.textContent = `Examples could not load. ${error.message}`;
      block.setAttribute('role', 'status');
    }
  }).finally(() => {
    document.body.dataset.docsReady = 'true';
    // Fragment content arrives after the initial browser anchor lookup.
    const id = decodeURIComponent(location.hash.slice(1));
    if (id) document.getElementById(id)?.scrollIntoView();
  });
}
document.addEventListener('cf:load', initialize);
initialize();
