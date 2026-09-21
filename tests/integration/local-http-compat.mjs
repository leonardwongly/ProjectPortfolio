/**
 * Production pages intentionally upgrade insecure subresource requests. WebKit
 * applies that policy to the local HTTP test server too, where the resulting
 * HTTPS requests cannot be served. Fulfill those loopback requests from the
 * same HTTP server so WebKit can exercise the real page and JavaScript.
 */
export async function routeLoopbackHttpsRequests(page) {
  const port = process.env.PLAYWRIGHT_PORT || '4173';
  await page.route(`https://127.0.0.1:${port}/**`, async (route) => {
    const httpUrl = route.request().url().replace(/^https:/, 'http:');
    const response = await fetch(httpUrl);
    const headers = {};
    response.headers.forEach((value, name) => {
      if (!['connection', 'content-encoding', 'content-length'].includes(name)) {
        headers[name] = value;
      }
    });

    await route.fulfill({
      status: response.status,
      headers,
      body: Buffer.from(await response.arrayBuffer())
    });
  });
}
