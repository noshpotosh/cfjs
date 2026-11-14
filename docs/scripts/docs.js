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
  document.body.dataset.docsReady = 'true';
  // Fragment content arrives after the initial browser anchor lookup.
  const id = decodeURIComponent(location.hash.slice(1));
  if (id) document.getElementById(id)?.scrollIntoView();
}
document.addEventListener('cf:load', initialize);
initialize();
