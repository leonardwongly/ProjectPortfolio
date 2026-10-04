import { defaultTreeAdapter, parse } from 'parse5';

const DEFAULT_MAX_HTML_BYTES = 2 * 1024 * 1024;
const DEFAULT_MAX_HTML_NODES = 20000;
const HTML_NAMESPACE = 'http://www.w3.org/1999/xhtml';
const SVG_NAMESPACE = 'http://www.w3.org/2000/svg';

function positiveLimit(value, name) {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new TypeError(`${name} must be a positive safe integer`);
  }
  return value;
}

// Stop allocating nodes at the limit, rather than building an oversized tree
// and only discovering its size during traversal. Text insertion in the
// default adapter creates nodes internally, so account for those paths too.
function boundedTreeAdapter(maxNodes) {
  let createdNodes = 0;
  const reserveNode = () => {
    if (++createdNodes > maxNodes) throw new Error(`HTML nodes exceed ${maxNodes} entry limit`);
  };
  const adapter = { ...defaultTreeAdapter };
  for (const method of ['createDocument', 'createDocumentFragment', 'createElement', 'createCommentNode', 'createTextNode']) {
    adapter[method] = (...args) => {
      reserveNode();
      return defaultTreeAdapter[method](...args);
    };
  }
  adapter.insertText = (parent, text) => {
    const previous = parent.childNodes.at(-1);
    if (!previous || !defaultTreeAdapter.isTextNode(previous)) reserveNode();
    return defaultTreeAdapter.insertText(parent, text);
  };
  adapter.insertTextBefore = (parent, text, reference) => {
    const previous = parent.childNodes[parent.childNodes.indexOf(reference) - 1];
    if (!previous || !defaultTreeAdapter.isTextNode(previous)) reserveNode();
    return defaultTreeAdapter.insertTextBefore(parent, text, reference);
  };
  adapter.setDocumentType = (document, ...args) => {
    if (!document.childNodes.some((node) => defaultTreeAdapter.isDocumentTypeNode(node))) reserveNode();
    return defaultTreeAdapter.setDocumentType(document, ...args);
  };
  return adapter;
}

function parseHtmlDocument(html, {
  maxBytes = DEFAULT_MAX_HTML_BYTES,
  maxNodes = DEFAULT_MAX_HTML_NODES,
  scriptingEnabled = true,
  allowMissingDoctype = true
} = {}) {
  positiveLimit(maxBytes, 'HTML byte limit');
  positiveLimit(maxNodes, 'HTML node limit');
  if (typeof scriptingEnabled !== 'boolean' || typeof allowMissingDoctype !== 'boolean') {
    throw new TypeError('HTML parser flags must be booleans');
  }
  if (typeof html !== 'string' || Buffer.byteLength(html, 'utf8') > maxBytes) {
    throw new Error(`HTML must be a string within ${maxBytes} bytes`);
  }
  const errors = [];
  const document = parse(html, {
    scriptingEnabled,
    treeAdapter: boundedTreeAdapter(maxNodes),
    onParseError(error) {
      // Tests and authored source fragments may intentionally omit a doctype.
      // Every other recovery is rejected instead of interpreting ambiguous
      // markup differently from the browser receiving the page.
      if (allowMissingDoctype && error.code === 'missing-doctype') {
        errors.push(error);
        return;
      }
      throw new Error(`HTML parse error: ${error.code}`);
    }
  });
  const elements = [];
  const scripts = [];
  const activeScripts = [];
  let visitedNodes = 0;
  let scriptBytes = 0;
  const pending = [{ node: document, leaving: false }];
  while (pending.length) {
    const { node, leaving } = pending.pop();
    if (leaving) {
      if (node.tagName === 'script') activeScripts.pop();
      continue;
    }
    if (++visitedNodes > maxNodes) throw new Error(`HTML nodes exceed ${maxNodes} entry limit`);
    if (node.tagName) {
      const attributes = new Map(node.attrs.map(({ name, prefix, value }) =>
        [prefix ? `${prefix}:${name}` : name, value]));
      elements.push({ tagName: node.tagName, namespace: node.namespaceURI, attributes });
      if (node.tagName === 'script') {
        const script = { attributes, body: '' };
        scripts.push(script);
        activeScripts.push(script);
      }
    } else if (node.nodeName === '#text' && activeScripts.length) {
      // A foreign-content script can contain child elements. Accumulating text
      // while traversing matches textContent, including those descendants.
      // Bound total output as well, since nested foreign scripts share text.
      scriptBytes += Buffer.byteLength(node.value, 'utf8') * activeScripts.length;
      if (scriptBytes > maxBytes) throw new Error(`HTML script text exceeds ${maxBytes} byte limit`);
      for (const script of activeScripts) script.body += node.value;
    }
    pending.push({ node, leaving: true });
    const children = node.content ? [...node.childNodes, node.content] : node.childNodes;
    for (let index = (children?.length ?? 0) - 1; index >= 0; index -= 1) {
      pending.push({ node: children[index], leaving: false });
    }
  }
  return { elements, scripts, errors };
}

export {
  DEFAULT_MAX_HTML_BYTES,
  DEFAULT_MAX_HTML_NODES,
  HTML_NAMESPACE,
  SVG_NAMESPACE,
  parseHtmlDocument
};
