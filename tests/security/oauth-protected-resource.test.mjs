import assert from 'node:assert/strict';
import test from 'node:test';

const metadataModule = await import('../../functions/.well-known/oauth-protected-resource.js');

test('OAuth Protected Resource Metadata returns RFC 9728 fields', async () => {
  const response = metadataModule.onRequest({
    request: new Request('https://leonardwong.tech/.well-known/oauth-protected-resource'),
    env: {}
  });

  assert.equal(response.status, 200);
  assert.equal(response.headers.get('content-type'), 'application/json; charset=utf-8');
  assert.equal(response.headers.get('access-control-allow-origin'), '*');

  const metadata = await response.json();
  assert.equal(metadata.resource, 'https://leonardwong.tech');
  assert.deepEqual(metadata.authorization_servers, [
    'https://leonardwongly.cloudflareaccess.com'
  ]);
  assert.deepEqual(metadata.scopes_supported, ['openid']);
  assert.deepEqual(metadata.bearer_methods_supported, ['header']);
});

test('metadata values can be configured with Cloudflare Pages environment variables', async () => {
  const response = metadataModule.onRequest({
    request: new Request('https://leonardwong.tech/.well-known/oauth-protected-resource'),
    env: {
      OAUTH_RESOURCE_URL: 'https://leonardwong.tech/',
      OAUTH_AUTHORIZATION_SERVERS: 'https://leonardwongly.cloudflareaccess.com',
      OAUTH_SCOPES_SUPPORTED: 'openid profile openid scope/value'
    }
  });

  assert.deepEqual(await response.json(), {
    resource: 'https://leonardwong.tech',
    authorization_servers: [
      'https://leonardwongly.cloudflareaccess.com'
    ],
    bearer_methods_supported: ['header'],
    scopes_supported: ['openid', 'profile']
  });
});

test('invalid or unapproved production configuration fails closed', async () => {
  const response = metadataModule.onRequest({
    request: new Request('https://leonardwong.tech/.well-known/oauth-protected-resource'),
    env: {
      OAUTH_RESOURCE_URL: 'http://internal.example',
      OAUTH_AUTHORIZATION_SERVERS: 'https://user:password@example.com, javascript:alert(1)'
    }
  });

  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { error: 'OAuth metadata configuration is unavailable' });
});

test('unapproved Cloudflare issuer and resource cannot be published', async () => {
  const response = metadataModule.onRequest({
    request: new Request('https://leonardwong.tech/.well-known/oauth-protected-resource'),
    env: {
      OAUTH_RESOURCE_URL: 'https://attacker.example',
      OAUTH_AUTHORIZATION_SERVERS: 'https://attacker.cloudflareaccess.com'
    }
  });

  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { error: 'OAuth metadata configuration is unavailable' });
});

test('HEAD is successful and unsupported methods are rejected', async () => {
  const head = metadataModule.onRequest({
    request: new Request('https://leonardwong.tech/.well-known/oauth-protected-resource', {
      method: 'HEAD'
    }),
    env: {}
  });
  assert.equal(head.status, 200);
  assert.equal(await head.text(), '');

  const post = metadataModule.onRequest({
    request: new Request('https://leonardwong.tech/.well-known/oauth-protected-resource', {
      method: 'POST'
    }),
    env: {}
  });
  assert.equal(post.status, 405);
  assert.equal(post.headers.get('allow'), 'GET, HEAD');
});
