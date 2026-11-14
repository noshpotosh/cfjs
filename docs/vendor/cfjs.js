// CFJS: HTML includes, without a build step or Shadow DOM.
// All include and asset paths are relative to the entrypoint document.
(() => {
  // Markup conventions and runtime limits.
  const TAGS = { include: 'cf-include' };
  const ERROR_ATTRIBUTE = 'data-cf-error';
  const EVENTS = { load: 'cf:load', error: 'cf:error' };
  const HTTP_PROTOCOLS = ['http:', 'https:'];
  const MAX_INCLUDE_DEPTH = 32;

  // Shared requests and mounted-element state live for this runtime instance.
  const includeRequests = new Map();
  const elementJobs = new WeakMap();

  // Custom elements and core composition operations.
  class CFInclude extends HTMLElement {
    connectedCallback() {
      // Supplied children belong to their outer include until composition finishes.
      if (this.parentElement?.closest(TAGS.include) || elementJobs.has(this)) return;
      elementJobs.set(this, loadInclude(this));
    }
  }

  /**
   * Compose and replace an include, then report success on its former parent.
   * @param {HTMLElement} element Include whose fallback is retained on failure.
   * @returns {Promise<void>} Resolves after mounting or reporting an error.
   */
  async function loadInclude(element) {
    try {
      const src = element.getAttribute('src');
      if (!src?.trim()) throw new Error('Missing cf-include src');

      const children = [...element.childNodes].map(node => node.cloneNode(true));
      const content = document.importNode(await composeIncludeFragment(src, [], 0, children), true);
      if (!element.isConnected) return;

      const parent = element.parentNode;
      mountContent(element, content, true);
      parent.dispatchEvent(new CustomEvent(EVENTS.load, { bubbles: true, detail: { src } }));
    } catch (error) {
      element.setAttribute(ERROR_ATTRIBUTE, error.message);
      element.dispatchEvent(new CustomEvent(EVENTS.error, { bubbles: true, detail: { error } }));
      console.error('[CFJS]', error);
    }
  }

  /**
   * Build an inert include tree with slots and nested includes resolved.
   * @param {string} source URL relative to the entrypoint document.
   * @param {string[]} [ancestors=[]] Requested and redirected ancestor URLs.
   * @param {number} [depth=0] Current include nesting depth.
   * @param {Node[]} [children=[]] Supplied children available for slot composition.
   * @returns {Promise<DocumentFragment>} Composed content, ready to import and mount.
   */
  async function composeIncludeFragment(source, ancestors = [], depth = 0, children = []) {
    const target = new URL(source, document.baseURI);
    target.hash = '';
    const chain = [...ancestors, target.href];
    if (!HTTP_PROTOCOLS.includes(target.protocol)) {
      throw new Error(`Includes require an HTTP(S) URL: ${target.href}`);
    }
    if (ancestors.includes(target.href)) {
      throw new Error(`Circular include: ${chain.join(' -> ')}`);
    }
    if (depth >= MAX_INCLUDE_DEPTH) throw new Error(`Include depth limit (${MAX_INCLUDE_DEPTH}): ${chain.join(' -> ')}`);

    const { html, url } = await fetchInclude(target.href);
    if (ancestors.includes(url)) {
      throw new Error(`Circular include after redirect: ${[...chain, url].join(' -> ')}`);
    }
    if (url !== target.href) chain.push(url);

    const template = document.createElement('template');
    template.innerHTML = html;
    const content = template.content;

    // Fragments must not change the whole page's base URL.
    if (content.querySelector('base')) throw new Error(`<base> is not supported in includes: ${url}`);

    composeSlots(content, children);
    // Expand only direct branches; fallback includes belong to their outer include.
    for (const include of [...content.querySelectorAll(TAGS.include)]) {
      if (!content.contains(include) || include.parentElement?.closest(TAGS.include)) continue;
      const source = getNestedIncludeSource(include, url);
      include.replaceWith(await composeIncludeFragment(source, chain, depth + 1, [...include.childNodes]));
    }

    return content;
  }

  // Scripts stay inert until script activation is introduced.
  function mountContent(element, content, replace = false) {
    for (const script of content.querySelectorAll('script')) script.remove();
    if (replace) element.replaceWith(content);
    else element.replaceChildren(content);
  }

  // Helpers follow the loading, composition, binding, and activation flow.
  function fetchInclude(url) {
    if (!includeRequests.has(url)) {
      const request = fetch(url).then(async response => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return { html: await response.text(), url: response.url };
      }).catch(error => {
        includeRequests.delete(url); // A new include may retry a failed request.
        throw new Error(`Could not load ${url}: ${error.message}`, { cause: error });
      });
      includeRequests.set(url, request);
    }

    return includeRequests.get(url);
  }

  function composeSlots(content, children) {
    // Like HTML slots: direct children go to the first matching slot.
    // This is one-time composition in the light DOM, not Shadow DOM distribution.
    const remainingChildren = [...children];
    for (const slot of [...content.querySelectorAll('slot')]) {
      if (!content.contains(slot) || slot.closest(TAGS.include)) continue;
      const name = slot.getAttribute('name') || '';
      const assignedChildren = remainingChildren.filter(node =>
        (node.nodeType === Node.ELEMENT_NODE || node.nodeType === Node.TEXT_NODE) &&
        (node.nodeType === Node.ELEMENT_NODE ? node.getAttribute('slot') || '' : '') === name);
      for (const node of assignedChildren) remainingChildren.splice(remainingChildren.indexOf(node), 1);
      slot.replaceWith(...(assignedChildren.length ? assignedChildren : slot.childNodes));
    }
  }

  function getNestedIncludeSource(include, parentUrl) {
    const source = include.getAttribute('src');
    if (!source?.trim()) throw new Error(`Missing include src in ${parentUrl}`);
    return source;
  }

  // Register only after shared state and the element class are ready.
  if (!customElements.get(TAGS.include)) customElements.define(TAGS.include, CFInclude);
})();
