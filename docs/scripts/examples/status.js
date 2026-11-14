// Classic external scripts run after mounting, with document.currentScript available.
(() => {
  const section = document.currentScript.parentElement;
  section.dataset.external = 'ready';
})();
