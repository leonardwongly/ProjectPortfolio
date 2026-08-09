import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import {
  hasConnectionParameters,
  normalizeResolverUrl,
  queryResolver,
  resolverUrls,
  timeoutMs
} from '../../scripts/check-dns-aid.mjs';

const projectRoot = path.resolve(new URL('../..', import.meta.url).pathname);
const zonePath = path.join(projectRoot, 'dns-aid.zone');

test('DNS-AID zone publishes an index and A2A HTTPS service with connection parameters', () => {
  const zone = fs.readFileSync(zonePath, 'utf8');

  assert.match(zone, /_index\._agents\s+3600\s+IN\s+SVCB\s+1\s+leonardwong\.tech\./);
  assert.match(zone, /_a2a\._agents\s+3600\s+IN\s+HTTPS\s+1\s+leonardwong\.tech\./);
  assert.match(zone, /alpn="h2,http\/1\.1"/);
  assert.match(zone, /port=443/);
  assert.match(zone, /mandatory=alpn,port/);
  assert.equal(hasConnectionParameters([
    '1 leonardwong.tech. alpn="h2,http/1.1" port=443 mandatory=alpn,port'
  ]), true);
});

test('DNS-AID zone does not use unregistered textual SvcParamKey names', () => {
  const zone = fs.readFileSync(zonePath, 'utf8');
  const records = zone.split('\n').filter((line) => /\bIN\s+(?:SVCB|HTTPS)\b/.test(line));
  records.forEach((record) => {
    const params = record.split(/\s+/u).slice(6);
    params.forEach((param) => {
      const key = param.split('=', 1)[0];
      assert.match(key, /^(?:alpn|port|mandatory|key\d{5})$/);
    });
  });
});

test('DNS-AID only accepts the pinned public DoH resolver hosts', () => {
  assert.deepEqual(
    resolverUrls({ DNS_AID_DOH_RESOLVER_URL: 'https://dns.google/resolve' }),
    ['https://dns.google/resolve']
  );
  assert.throws(
    () => normalizeResolverUrl('http://127.0.0.1:8080/dns-query'),
    /allowed HTTPS resolver host/
  );
  assert.throws(
    () => normalizeResolverUrl('https://attacker.example/dns-query'),
    /allowed HTTPS resolver host/
  );
  assert.throws(
    () => timeoutMs({ DNS_AID_TIMEOUT_MS: '60000' }),
    /between 1000 and 30000/
  );
});

test('DNS-AID rejects redirects when querying a resolver', async () => {
  let fetchOptions;
  const body = { Answer: [], AD: true };
  await queryResolver('https://dns.google/resolve', '_a2a._agents.leonardwong.tech', 'HTTPS', {
    fetchImpl: async (_url, options) => {
      fetchOptions = options;
      return new Response(JSON.stringify(body), {
        status: 200,
        headers: { 'content-type': 'application/dns-json' }
      });
    },
    timeout: 1000
  });
  assert.equal(fetchOptions.redirect, 'error');
});
