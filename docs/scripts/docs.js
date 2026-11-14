import { prepareExamples, prepareHeadings } from './content.js';

let initialized = false;
async function initialize() {
  if (initialized || !document.querySelector('#main')) return;
  initialized = true;
  function updateChrome() {
    document.querySelectorAll('[data-nav-topic]').forEach(link => {
      if (link.dataset.navTopic === document.body.dataset.topic) link.setAttribute('aria-current', 'page');
    });
  }
  document.addEventListener('cf:load', updateChrome);
  updateChrome();
  document.addEventListener('click', async event => {
    const tab = event.target.closest('[role="tab"]');
    if (tab) selectTab(tab);
    const copy = event.target.closest('.copy-button');
    if (copy) {
      const panel = copy.closest('[role="tabpanel"]');
      const source = panel.querySelector('code').textContent;
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
  }
  document.addEventListener('keydown', async event => {
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
