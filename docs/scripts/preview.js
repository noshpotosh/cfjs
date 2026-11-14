// Preview-only adapter. CFJS still sees the original HTTP URLs and response URLs.
const scriptURL = source => 'data:text/javascript;base64,' + btoa(Array.from(new TextEncoder().encode(source), byte => String.fromCharCode(byte)).join(''));
const serialize = value => JSON.stringify(value).replaceAll('<', '\\u003c');

function previewBootstrap(files, entry, run) {
  const send = (kind, message) => parent.postMessage({ type: 'cfjs-preview', run, kind, message: String(message).slice(0, 2000) }, '*');
  const report = error => send('error', error?.name ? `${error.name}: ${error.message}` : error?.message || error);
  addEventListener('error', event => report(event.error || event.message || 'Resource could not load'), true);
  addEventListener('unhandledrejection', event => report(event.reason));
  document.addEventListener('cf:error', event => report(event.detail?.error || 'CFJS error'));
  document.addEventListener('securitypolicyviolation', event => report(`Preview blocked unsupported resource: ${event.blockedURI || event.violatedDirective}`));
  window.fetch = async (input, options = {}) => {
    if (options.signal?.aborted) throw new DOMException('Request aborted', 'AbortError');
    const url = new URL(input instanceof Request ? input.url : input, entry);
    url.hash = '';
    if (!Object.hasOwn(files, url.href)) {
      const error = new Error(`Preview resource is not listed: ${url.href}`);
      report(error);
      throw error;
    }
    const response = new Response(files[url.href], { headers: { 'Content-Type': url.pathname.endsWith('.json') ? 'application/json' : 'text/html' } });
    Object.defineProperty(response, 'url', { value: url.href });
    return response;
  };
  addEventListener('load', () => send('loaded', 'Snapshot loaded.'));
}

export function createPreview(files, entry, dependencies, run) {
  const resources = { ...files, ...dependencies };
  const failureScript = message => scriptURL(`throw new Error(${JSON.stringify(message)})`);
  function rewrite(root) {
    // Templates need an explicit walk: querySelectorAll does not enter their content.
    for (const node of root.querySelectorAll('script, link, template, base, meta[http-equiv]')) {
      if (node.tagName === 'TEMPLATE') { rewrite(node.content); continue; }
      if (node.tagName === 'BASE' || node.matches('meta[http-equiv]')) { node.remove(); continue; }
      if (node.tagName === 'SCRIPT') {
        if (node.type === 'module' || node.type === 'importmap') {
          node.removeAttribute('type');
          node.src = failureScript('Modules and import maps are outside preview v1.');
          node.textContent = '';
        } else if (node.hasAttribute('src')) {
          const url = new URL(node.getAttribute('src'), entry).href;
          node.src = Object.hasOwn(resources, url) && url.endsWith('.js')
            ? scriptURL(resources[url]) : failureScript(`Preview script is not listed: ${url}`);
          node.removeAttribute('integrity');
        }
        // Preserve error details and rejection events for data-URL scripts
        // inside the opaque-origin preview (notably in Firefox).
        if (node.hasAttribute('src')) node.crossOrigin = 'anonymous';
      } else if (node.rel === 'stylesheet') {
        const url = new URL(node.getAttribute('href'), entry).href;
        if (Object.hasOwn(dependencies, url)) {
          const style = document.createElement('style');
          style.textContent = dependencies[url];
          node.replaceWith(style);
        } else {
          const script = document.createElement('script');
          script.src = failureScript(`Preview stylesheet is not supplied: ${url}`);
          script.crossOrigin = 'anonymous';
          node.replaceWith(script);
        }
      } else node.remove();
    }
  }
  const virtual = { ...dependencies };
  for (const [url, content] of Object.entries(files)) {
    if (!new URL(url).pathname.endsWith('.html')) { virtual[url] = content; continue; }
    if (url === entry) continue;
    const template = document.createElement('template');
    template.innerHTML = content;
    rewrite(template.content);
    virtual[url] = template.innerHTML;
  }
  const doc = new DOMParser().parseFromString(files[entry], 'text/html');
  rewrite(doc);
  const policy = document.createElement('meta');
  policy.httpEquiv = 'Content-Security-Policy';
  policy.content = `default-src 'none'; script-src 'unsafe-inline' data:; style-src 'unsafe-inline'; img-src data:; connect-src 'none'; base-uri ${new URL(entry).origin}; form-action 'none'`;
  const base = document.createElement('base');
  base.href = entry;
  const bootstrap = document.createElement('script');
  // The entry can itself be requested by an include; keep it in the virtual map for cycles.
  virtual[entry] = doc.documentElement.outerHTML;
  bootstrap.textContent = `(${previewBootstrap.toString()})(${serialize(virtual)},${serialize(entry)},${serialize(run)})`;
  doc.head.prepend(policy, base, bootstrap);
  return '<!doctype html>\n' + doc.documentElement.outerHTML;
}
