// CFJS: HTML includes, without a build step or Shadow DOM.
// All include and asset paths are relative to the entrypoint document.
(() => {
  // Markup conventions and runtime limits.
  const TAGS = { data: 'cf-data', include: 'cf-include' };
  const BINDINGS = { text: 'cf-text', href: 'cf-href', src: 'cf-src', alt: 'cf-alt' };
  const BINDING_PREFIX = 'cf-';
  const ERROR_ATTRIBUTE = 'data-cf-error';
  const EVENTS = { load: 'cf:load', error: 'cf:error' };
  const TEMPLATES = {
    content: ':scope > template:not([data-state])',
    loading: ':scope > template[data-state="loading"]',
    error: ':scope > template[data-state="error"]',
  };
  const HTTP_PROTOCOLS = ['http:', 'https:'];
  const LINK_PROTOCOLS = [...HTTP_PROTOCOLS, 'mailto:', 'tel:'];
  const IDENTIFIER_PATTERN = /^[A-Za-z_$][\w$]*$/;
  const ATTRIBUTE_BINDING_PATTERN = /^cf-(id|title|aria-[\w-]+|data-[\w-]+)$/;
  const BLOCKED_PATH_KEYS = ['__proto__', 'constructor', 'prototype'];
  const MAX_INCLUDE_DEPTH = 32;
  const JSON_TIMEOUT_MS = 10000;
  const SCRIPT_PLACEHOLDER = 'cf-script';

  // Shared requests and mounted-element state live for this runtime instance.
  const includeRequests = new Map();
  const jsonRequests = new Map();
  const elementJobs = new WeakMap();
  const mountedStyles = new Set();

  // Custom elements and core composition operations.
  class CFData extends HTMLElement {
    connectedCallback() {
      // Includes activate their scripts before providers are looked up.
      queueMicrotask(() => {
        if (!this.isConnected || this.closest(TAGS.include) || elementJobs.has(this)) return;
        elementJobs.set(this, this.load());
      });
    }

    /**
     * Load a provider or JSON response and render this element's templates.
     * @returns {Promise<void>} Resolves after rendering success or an error state.
     */
    async load() {
      const template = this.querySelector(TEMPLATES.content);
      const loadingTemplate = this.querySelector(TEMPLATES.loading);
      const errorTemplate = this.querySelector(TEMPLATES.error);

      this.setAttribute('aria-busy', 'true');
      if (loadingTemplate) this.replaceChildren(loadingTemplate.content.cloneNode(true));

      try {
        if (!template) throw new Error('cf-data requires a template');
        const responseName = this.getAttribute('name');
        if (!IDENTIFIER_PATTERN.test(responseName || '')) throw new Error('cf-data requires a response name');

        const source = this.getAttribute('source');
        const src = this.getAttribute('src');
        if (Boolean(source) === Boolean(src)) throw new Error('cf-data requires either src or source');

        let data;
        if (source) {
          const value = resolveBindingPath(window, source);
          if (value === undefined) throw new Error(`Unknown data source: ${source}`);
          data = await (typeof value === 'function' ? value() : value);
        } else {
          const url = new URL(src, document.baseURI);
          if (!HTTP_PROTOCOLS.includes(url.protocol)) throw new Error('cf-data requires an HTTP(S) URL');
          data = await fetchJson(url);
        }

        const content = template.content.cloneNode(true);
        await renderBindings(content, { [responseName]: data });
        if (!this.isConnected) return;

        mountContent(this, content);
        this.dispatchEvent(new CustomEvent(EVENTS.load, { bubbles: true }));
      } catch (error) {
        if (!this.isConnected) return;
        if (errorTemplate) this.replaceChildren(errorTemplate.content.cloneNode(true));
        else {
          const message = document.createElement('p');
          message.setAttribute('role', 'alert');
          message.textContent = 'Content could not load.';
          this.replaceChildren(message);
        }

        this.setAttribute(ERROR_ATTRIBUTE, error.message);
        this.dispatchEvent(new CustomEvent(EVENTS.error, { bubbles: true, detail: { error } }));
      } finally {
        this.removeAttribute('aria-busy');
      }
    }
  }

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

  /**
   * Render bindings and control elements sequentially in detached content.
   * @param {Element|DocumentFragment} content Subtree to render in place.
   * @param {Object} context Values available to binding paths.
   * @returns {Promise<void>} Resolves after nested rendering finishes.
   */
  async function renderBindings(content, context) {
    for (const element of [...content.children]) {
      if (element.matches(`template, ${TAGS.data}`)) continue;
      if (element.matches(TAGS.include)) {
        const includedContent = await composeIncludeFragment(element.getAttribute('src'), [], 0, [...element.childNodes]);
        await renderBindings(includedContent, context);
        element.replaceWith(includedContent);
      } else {
        applyBindings(element, context);
        await renderBindings(element, context);
      }
    }
  }

  /**
   * Mount content, deduplicate styles, and activate scripts once the DOM is complete.
   * @param {HTMLElement} element Mount target.
   * @param {DocumentFragment} content Prepared content to insert.
   * @param {boolean} [replace=false] Replace the target instead of its children.
   * @returns {void} Does not wait for external scripts or modules.
   */
  function mountContent(element, content, replace = false) {
    // Parser-created template scripts can execute when their clones are mounted.
    // Hold them out of the DOM until our single activation pass.
    const scripts = [...content.querySelectorAll('script')].map(inert => {
      const placeholder = document.createComment(SCRIPT_PLACEHOLDER);
      inert.replaceWith(placeholder);
      return { inert, placeholder };
    });

    for (const style of content.querySelectorAll('style')) {
      const css = style.textContent.trim();
      if (!mountedStyles.has(css)) {
        mountedStyles.add(css);
        document.head.insertBefore(style, document.querySelector('link[rel="stylesheet"]'));
      } else style.remove();
    }

    if (replace) element.replaceWith(content);
    else element.replaceChildren(content);

    activateScripts(scripts);
  }

  // Helpers follow the loading, composition, binding, and activation flow.
  function fetchJson(url) {
    if (!jsonRequests.has(url.href)) {
      jsonRequests.set(url.href, fetch(url, { signal: AbortSignal.timeout(JSON_TIMEOUT_MS) }).then(response => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response.json();
      }).catch(error => {
        jsonRequests.delete(url.href); // A later data element may retry a failed request.
        throw error;
      }));
    }

    return jsonRequests.get(url.href);
  }

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

  /**
   * Resolve an own-property path, rejecting invalid or unsafe path segments.
   * @param {Object} context Root value to inspect.
   * @param {string} path Dot-separated property path.
   * @returns {*} Resolved value, or undefined when a segment is missing.
   */
  function resolveBindingPath(context, path) {
    const keys = (path || '').split('.');
    if (keys.some(key => !IDENTIFIER_PATTERN.test(key) || BLOCKED_PATH_KEYS.includes(key))) {
      throw new Error(`Invalid binding path: ${path}`);
    }
    return keys.reduce((value, key) => value != null && Object.hasOwn(Object(value), key) ? value[key] : undefined, context);
  }

  /**
   * Apply supported attributes safely and remove their CFJS binding markers.
   * @param {Element} element Element to update.
   * @param {Object} context Values available to binding paths.
   * @returns {void}
   */
  function applyBindings(element, context) {
    for (const attribute of [...element.attributes]) {
      if (!attribute.name.startsWith(BINDING_PREFIX)) continue;
      const value = String(resolveBindingPath(context, attribute.value) ?? '');
      if (attribute.name === BINDINGS.text) element.textContent = value;
      else if (attribute.name === BINDINGS.href) {
        const url = new URL(value, document.baseURI);
        if (value && LINK_PROTOCOLS.includes(url.protocol)) element.setAttribute('href', value);
        else element.removeAttribute('href');
      } else if (attribute.name === BINDINGS.src) {
        const url = new URL(value, document.baseURI);
        if (value && HTTP_PROTOCOLS.includes(url.protocol)) element.setAttribute('src', value);
        else element.removeAttribute('src');
      } else if (attribute.name === BINDINGS.alt) {
        element.setAttribute('alt', value);
      } else if (ATTRIBUTE_BINDING_PATTERN.test(attribute.name)) {
        if (value) element.setAttribute(attribute.name.slice(BINDING_PREFIX.length), value);
        else element.removeAttribute(attribute.name.slice(BINDING_PREFIX.length));
      } else throw new Error(`Unsupported binding: ${attribute.name}`);

      element.removeAttribute(attribute.name);
    }
  }

  /**
   * Recreate inert scripts at connected placeholders in document order.
   * @param {Array<{inert: HTMLScriptElement, placeholder: Comment}>} scripts Scripts held during mounting.
   * @returns {void} External scripts and modules retain native loading behavior.
   */
  function activateScripts(scripts) {
    for (const { inert, placeholder } of scripts) {
      if (!placeholder.isConnected) continue;
      const script = document.createElement('script');
      for (const attribute of inert.attributes) script.setAttribute(attribute.name, attribute.value);

      // Non-async external classics keep insertion order with one another.
      // Inline scripts do not wait for them; defer has no parser-time meaning.
      if (inert.hasAttribute('src') && !inert.hasAttribute('async')) script.async = false;
      if (inert.nonce) script.nonce = inert.nonce; // Connected elements may hide the nonce attribute.
      script.textContent = inert.textContent;
      placeholder.replaceWith(script);
    }
  }

  // Register only after shared state and both element classes are ready.
  if (!customElements.get(TAGS.data)) customElements.define(TAGS.data, CFData);
  if (!customElements.get(TAGS.include)) customElements.define(TAGS.include, CFInclude);
})();
