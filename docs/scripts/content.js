const escape = value => value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
// Small source-panel lexer: token colors never change the underlying copyable source.
function highlight(code, language) {
  const tokens = language === 'html'
    ? /(<!--[\s\S]*?-->|<\/?[\w-]+|\/?>|[\w-]+(?==)|"[^"\n]*"|'[^'\n]*')/g
    : /(\/\/[^\n]*|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|\b(?:const|let|function|return|async|await|new|window|document|true|false|null)\b|\b\d+\b)/g;
  let end = 0, result = '';
  for (const match of code.matchAll(tokens)) {
    result += escape(code.slice(end, match.index));
    const token = match[0];
    const kind = /^(<!--|\/\/)/.test(token) ? 'comment' : /^["']/.test(token) ? 'string' : language === 'html' && /^[\w-]+$/.test(token) ? 'attribute' : 'keyword';
    result += `<span class="token-${kind}">${escape(token)}</span>`;
    end = match.index + token.length;
  }
  return result + escape(code.slice(end));
}
const read = async file => {
  const response = await fetch(new URL(file, document.baseURI));
  if (!response.ok) throw new Error(`Could not load ${file}: HTTP ${response.status}`);
  return response.text();
};

export async function prepareExamples() {
  const blocks = [...document.querySelectorAll('[data-example]')];
  if (!blocks.length) return;
  const examples = JSON.parse(await read('./data/examples.json'));
  await Promise.all(blocks.map(async block => {
    const key = block.dataset.example;
    const example = examples[key];
    try {
      if (!example) throw new Error(`Unknown example: ${key}`);
      const id = `${document.body.dataset.topic}-${key}`;
      const panels = await Promise.all(example.files.map(async (file, i) => {
        const code = await read('./examples/' + file);
        const language = file.endsWith('.json') ? 'json' : file.endsWith('.js') ? 'javascript' : 'html';
        return `<div role="tabpanel" id="${id}-panel-${i}" aria-labelledby="${id}-tab-${i}" tabindex="0"${i ? ' hidden' : ''}><div class="code-toolbar"><span>${language}</span><button type="button" class="copy-button" aria-label="Copy ${escape(file)}">Copy</button></div><pre><code class="language-${language}">${highlight(code, language)}</code></pre></div>`;
      }));
      const tabs = example.files.map((file, i) => `<button type="button" role="tab" id="${id}-tab-${i}" aria-controls="${id}-panel-${i}" aria-selected="${i === 0}" tabindex="${i ? '-1' : '0'}">${escape(file)}</button>`).join('');
      block.dataset.files = JSON.stringify(example.files);
      block.innerHTML = `<div class="example-source"><div role="tablist" aria-label="${escape(example.title)} files">${tabs}</div>${panels.join('')}</div><div class="live-heading"><span>Live result</span><a href="./examples/${escape(example.files[0])}" target="_blank" rel="noopener">Open original example ↗</a></div><iframe title="${escape(example.title)}" src="./examples/${escape(example.files[0])}" loading="lazy" sandbox="allow-scripts allow-same-origin"></iframe>`;
    } catch (error) {
      const message = document.createElement('p');
      message.setAttribute('role', 'status');
      message.textContent = `Example could not load. ${error.message}`;
      block.replaceChildren(message);
      if (example) {
        const link = document.createElement('a');
        link.href = './examples/' + example.files[0];
        link.textContent = 'Open original example';
        block.append(link);
      }
    }
  }));
}

export function prepareHeadings() {
  for (const heading of document.querySelectorAll('main h1[id], main h2[id], main h3[id]')) {
    const link = document.createElement('a');
    link.className = 'heading-link';
    link.href = '#' + heading.id;
    link.setAttribute('aria-label', 'Link to ' + heading.textContent.trim());
    link.textContent = '#';
    heading.append(link);
  }
  for (const code of document.querySelectorAll('main pre > code[class^="language-"]')) {
    code.innerHTML = highlight(code.textContent, code.className.slice('language-'.length));
  }
}

// Search fetches authored topic pages only when first opened.
export async function createSearchIndex() {
  const topics = await window.docsTopics();
  const sections = await Promise.all(topics.map(async topic => {
    const source = await read('./' + topic.slug + '.html');
    const content = new DOMParser().parseFromString(source, 'text/html');
    content.querySelectorAll('pre, script, style').forEach(node => node.remove());
    const topicContent = content.querySelector('body > cf-include');
    const headings = [...topicContent.querySelectorAll('h1[id], h2[id], h3[id]')];
    return headings.map((heading, index) => {
      const range = content.createRange();
      range.setStartAfter(heading);
      if (headings[index + 1]) range.setEndBefore(headings[index + 1]);
      else range.setEndAfter(topicContent.lastChild);
      return { title: topic.title, heading: heading.textContent.trim(),
        url: `./${topic.slug}.html#${heading.id}`,
        text: range.toString().replace(/\s+/g, ' ').trim().slice(0, 4000) };
    });
  }));
  return sections.flat();
}
