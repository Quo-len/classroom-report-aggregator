import { createServer } from '../src/server';
import http from 'http';

async function testFastifyServer() {
  console.log('🧪 Testing Fastify Server and Web UI endpoints...');
  const server = await createServer();
  const address = await server.listen({ port: 3456, host: '127.0.0.1' });
  console.log(`Server listening on ${address}`);

  const get = (urlPath: string): Promise<{ statusCode: number; body: string }> => {
    return new Promise((resolve, reject) => {
      const req = http.get(`http://127.0.0.1:3456${urlPath}`, (res) => {
        let data = '';
        res.on('data', (chunk) => (data += chunk));
        res.on('end', () => resolve({ statusCode: res.statusCode || 200, body: data }));
      });
      req.on('error', reject);
    });
  };

  // 1. Test Static UI HTML
  const uiRes = await get('/');
  if (uiRes.statusCode === 200 && uiRes.body.includes('АІ-Секретар Кафедри')) {
    console.log('  ✅ PASS: Static HTML UI served successfully (200 OK)');
  } else {
    throw new Error(`Static UI failed: ${uiRes.statusCode}`);
  }

  // 2. Test /api/status
  const statusRes = await get('/api/status');
  const statusJson = JSON.parse(statusRes.body);
  if (statusRes.statusCode === 200 && statusJson.ok) {
    console.log('  ✅ PASS: /api/status returned 200 OK with valid JSON');
  } else {
    throw new Error(`/api/status failed: ${statusRes.statusCode}`);
  }

  // 3. Test /api/trigger/monitor via POST
  const postRes = await server.inject({
    method: 'POST',
    url: '/api/trigger/monitor',
    payload: { dryRun: true },
  });
  if (postRes.statusCode === 200) {
    console.log('  ✅ PASS: POST /api/trigger/monitor returned 200 OK');
  } else {
    throw new Error(`Trigger monitor failed: ${postRes.statusCode}`);
  }

  await server.close();
  console.log('🎉 FASTIFY SERVER AND WEB UI FULLY VERIFIED!');
}

testFastifyServer().catch((err) => {
  console.error('Fastify server test failed:', err);
  process.exit(1);
});
