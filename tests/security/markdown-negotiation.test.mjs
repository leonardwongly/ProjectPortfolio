import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { Readable } from 'node:stream';
import test from 'node:test';
import { MARKDOWN_ACCEPT, parseArgs, runMarkdownNegotiation } from '../../scripts/check-markdown-negotiation.mjs';

const HTML = { status: 200, headers: { 'content-type': 'Text/HTML; charset=utf-8' }, body: '<html>hello</html>' };
const MARKDOWN = { status: 200, headers: { 'content-type': 'Text/Markdown; charset=utf-8', vary: ['Accept-Encoding', 'ACCEPT'] }, body: '# hello' };
function fixture(pages = [HTML, MARKDOWN]) {
  const requests = [];
  const options = { origin: 'https://public.example', timeoutMs: 1000,
    lookupImpl: async () => [{ address: '93.184.216.34', family: 4 }],
    requestImpl: (url, requestOptions, onResponse) => {
      requests.push({ url: String(url), options: requestOptions });
      assert.equal(requestOptions.method, 'GET');
      assert.equal(requestOptions.agent, false);
      assert.equal(requestOptions.servername, 'public.example');
      assert.equal(requestOptions.headers.connection, 'close');
      assert.match(requestOptions.headers['user-agent'], /^ProjectPortfolio-markdown-negotiation\//);
      const request = new EventEmitter();
      request.destroy = () => {};
      request.end = () => requestOptions.lookup('public.example', {}, (error, address) => {
        assert.ifError(error);
        assert.equal(address, '93.184.216.34');
        const page = pages[requests.length - 1];
        const response = Readable.from([Buffer.from(page.body)]);
        response.statusCode = page.status;
        response.headers = page.headers;
        onResponse(response);
      });
      return request;
    }
  };
  return { options, requests };
}

test('Markdown consumer negotiates both Accept variants through pinned transport', async () => {
  const { options, requests } = fixture();
  assert.deepEqual(await runMarkdownNegotiation(options), []);
  assert.deepEqual(requests.map(({ url }) => url), ['https://public.example/', 'https://public.example/']);
  assert.deepEqual(requests.map(({ options }) => options.headers.accept), [
    'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8', MARKDOWN_ACCEPT
  ]);
});

test('Markdown validation isolates status, exact MIME, body and Vary faults', async () => {
  for (const [index, change, expected] of [
    [0, { status: 503 }, 'HTTP 200 for default HTML request'],
    [0, { headers: { 'content-type': 'text/html-evil' } }, 'default request returns text/html'],
    [0, { body: 'hello' }, 'default request body contains HTML markup'],
    [1, { status: 302 }, 'HTTP 200 for markdown request'],
    [1, { headers: { ...MARKDOWN.headers, 'content-type': 'text/markdown-evil' } }, 'markdown request returns text/markdown'],
    [1, { body: '<html>wrong</html>' }, 'markdown response is not HTML markup'],
    [1, { body: ' \n ' }, 'markdown response is non-empty'],
    [1, { headers: { ...MARKDOWN.headers, vary: 'Accept-Encoding, x-accept' } }, 'response declares Vary: Accept'],
    [1, { headers: { 'content-type': 'text/markdown' } }, 'response declares Vary: Accept']
  ]) {
    const pages = [HTML, MARKDOWN];
    pages[index] = { ...pages[index], ...change };
    assert.deepEqual(await runMarkdownNegotiation(fixture(pages).options), [expected]);
  }
});

test('Markdown options reject invalid origins, bounds and seams before transport', async () => {
  assert.deepEqual(parseArgs([], {}), { origin: 'https://leonardwong.tech', timeoutMs: 15000 });
  assert.deepEqual(parseArgs(['--origin', 'https://public.example', '--timeout-ms', '60000'], {}), {
    origin: 'https://public.example', timeoutMs: 60000
  });
  for (const argv of [['--origin'], ['--timeout-ms'], ['--unknown'], ['--timeout-ms', '0'], ['--timeout-ms', '60001'], ['--timeout-ms', '10ms']]) {
    assert.throws(() => parseArgs(argv, {}));
  }
  for (const origin of ['http://public.example', 'https://localhost', 'https://public.example/path', 'https://public.example/?x=1', 'https://public.example/#x', 'https://user:pass@public.example']) {
    await assert.rejects(() => runMarkdownNegotiation({ origin, requestImpl: () => assert.fail('invalid origin must not request') }));
  }
  await assert.rejects(() => runMarkdownNegotiation({ lookupImpl: null }), /lookupImpl must be a function/);
  await assert.rejects(() => runMarkdownNegotiation({ requestImpl: null }), /requestImpl must be a function/);
  for (const options of [null, [], 'bad']) {
    await assert.rejects(() => runMarkdownNegotiation(options), /options must be an object/);
  }
  let calls = 0;
  await assert.rejects(() => runMarkdownNegotiation({ origin: 'https://public.example',
    lookupImpl: async () => [{ address: '127.0.0.1', family: 4 }], requestImpl: () => { calls += 1; }
  }), /blocked address/);
  assert.equal(calls, 0);
});

test('Markdown consumer propagates network error and enforces its body bound', async () => {
  const { options } = fixture();
  await assert.rejects(() => runMarkdownNegotiation({ ...options, requestImpl: () => { throw new Error('transport failed'); } }), /transport failed/);
  await assert.rejects(() => runMarkdownNegotiation(fixture([{ ...HTML, headers: { ...HTML.headers, 'content-length': String(1024 * 1024 + 1) } }, MARKDOWN]).options), /exceeds 1048576 byte limit/);
});
