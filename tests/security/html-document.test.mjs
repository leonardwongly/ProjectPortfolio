import assert from 'node:assert/strict';
import test from 'node:test';

import {
  HTML_NAMESPACE,
  SVG_NAMESPACE,
  parseHtmlDocument
} from '../../scripts/lib/html-document.mjs';

test('HTML parsing uses browser attribute names, namespace prefixes and single entity decoding', () => {
  const { elements, scripts } = parseHtmlDocument('<!DOCTYPE html><a HREF="jav&#x61;script:alert(1)" data-note="&amp;amp;">text</a><svg><use xlink:href="#icon" /></svg><script src\u00a0="/js/main.js" defer></script>');
  const anchor = elements.find(({ tagName }) => tagName === 'a');
  assert.equal(anchor.namespace, HTML_NAMESPACE);
  assert.equal(anchor.attributes.get('href'), 'javascript:alert(1)');
  assert.equal(anchor.attributes.get('data-note'), '&amp;');
  const use = elements.find(({ tagName }) => tagName === 'use');
  assert.equal(use.namespace, SVG_NAMESPACE);
  assert.equal(use.attributes.get('xlink:href'), '#icon');
  assert.equal(scripts.length, 1);
  assert.equal(scripts[0].attributes.has('src'), false);
  assert.equal(scripts[0].attributes.get('src\u00a0'), '/js/main.js');
});

test('script content follows browser raw-text and newline normalization', () => {
  const { scripts } = parseHtmlDocument('<script type="application/ld+json">\r\n{"text":"&amp; </scriptx>"}\r</script>');
  assert.equal(scripts.length, 1);
  assert.equal(scripts[0].body, '\n{"text":"&amp; </scriptx>"}\n');
  assert.equal(scripts[0].attributes.get('type'), 'application/ld+json');
});

test('scripting-enabled noscript and real raw-text delimiters expose actual browser scripts', () => {
  for (const source of [
    '<style></stylex><div title="</style><script src=/unknown.js defer></script>">',
    '<noscript><div title="</noscript><script src=/unknown.js defer></script>">',
    '<div$invalid title="<style>"><script src=/unknown.js defer></script>',
    `<${'a'.repeat(70)} title="<style>"><script src=/unknown.js defer></script>`
  ]) {
    const { scripts } = parseHtmlDocument(source);
    assert.equal(scripts.length, 1, source);
    assert.equal(scripts[0].attributes.get('src'), '/unknown.js', source);
  }
  const noscript = '<body><noscript><script src=/inert></script></noscript>';
  assert.equal(parseHtmlDocument(noscript).scripts.length, 0);
  assert.equal(parseHtmlDocument(noscript, { scriptingEnabled: false }).scripts.length, 1);
});

test('valid templates retain all nested content for conservative policy checks', () => {
  const { elements, scripts } = parseHtmlDocument('<template><div onclick="alert(1)"><template><script src=/hidden defer></script></template></div></template>');
  assert.equal(elements.filter(({ tagName }) => tagName === 'template').length, 2);
  assert.equal(elements.find(({ tagName }) => tagName === 'div').attributes.get('onclick'), 'alert(1)');
  assert.equal(scripts[0].attributes.get('src'), '/hidden');
});

test('parse recovery fails closed except for explicitly permitted missing doctypes', () => {
  for (const source of [
    '<![CDATA[<style>]]><script src=/unknown.js></script>',
    '<?foo <style> ?><script src=/unknown.js></script>',
    '<!DOCTYPE x "<style>"><script src=/unknown.js></script>',
    '<script src=x src=y></script>',
    '<div a=x"><script src=/unknown.js></script>',
    '<!-- --!><script src=/unknown.js></script> -->',
    '<script src=/unknown.js>',
    '<!-- unfinished'
  ]) assert.throws(() => parseHtmlDocument(source), /HTML parse error/, source);
  assert.deepEqual(parseHtmlDocument('<p>fragment</p>').errors.map(({ code }) => code), ['missing-doctype']);
  assert.throws(() => parseHtmlDocument('<p>fragment</p>', { allowMissingDoctype: false }), /missing-doctype/);
  assert.deepEqual(parseHtmlDocument('<!DOCTYPE html><p>document</p>').errors, []);
});

test('byte, creation, traversal and option limits bound HTML parsing', () => {
  assert.throws(() => parseHtmlDocument('é'.repeat(5), { maxBytes: 9 }), /within 9 bytes/);
  assert.throws(() => parseHtmlDocument('<i></i>'.repeat(20), { maxNodes: 12 }), /nodes exceed 12 entry limit/);
  assert.throws(() => parseHtmlDocument('<template><span></span></template>', { maxNodes: 6 }), /nodes exceed 6 entry limit/);
  assert.throws(() => parseHtmlDocument(null), /HTML must be a string/);
  for (const options of [{ maxBytes: 0 }, { maxNodes: -1 }, { maxBytes: 1.5 }, { scriptingEnabled: 'true' }, { allowMissingDoctype: null }]) {
    assert.throws(() => parseHtmlDocument('', options), /positive safe integer|flags must be booleans/);
  }
});

test('foreign script bodies include descendant text without unbounded duplicate output', () => {
  const { scripts } = parseHtmlDocument('<svg><script>first<g>inner</g>last</script></svg>');
  assert.equal(scripts[0].body, 'firstinnerlast');
  const source = `<svg>${'<script>'.repeat(4)}${'x'.repeat(80)}${'</script>'.repeat(4)}</svg>`;
  assert.throws(() => parseHtmlDocument(source, { maxBytes: 200 }), /script text exceeds 200 byte limit/);
});
