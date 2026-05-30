/**
 * Test MCP connection pipeline with mock credentials.
 * Verifies: URL substitution, auth headers, client init, connection status.
 */
import { resolveApiKey, buildRequestInit, describeAuth, connect, getStatus, getServerNames } from './src/mcp/mcp-client.js';
import { listTools } from './src/mcp/mcp-client.js';

// Set mock credentials for test
process.env.DALOOPA_API_KEY = 'mock-daloopa-key-for-testing';
process.env.DALOOPA_MCP_URL = 'https://httpbin.org/post';
process.env.CAPIQ_API_KEY = 'mock-capiq-key-for-testing';
process.env.CAPIQ_MCP_URL = 'https://httpbin.org/post';
process.env.FACTSET_API_KEY = 'mock-factset-key-for-testing';
process.env.MORNINGSTAR_API_KEY = 'mock-morningstar-key-for-testing';
process.env.SP_GLOBAL_API_KEY = 'mock-sp-global-key-for-testing';
process.env.MOODYS_API_KEY = 'mock-moodys-key-for-testing';

console.log('=== 1. Auth Resolution ===');
const servers = ['daloopa', 'capiq', 'factset', 'sp-global', 'moodys', 'morningstar'];
for (const s of servers) {
  const key = resolveApiKey(s);
  const reqInit = buildRequestInit(s);
  console.log(`  ${s}: key=${key ? '[SET]' : '[MISSING]'}, auth_header=${reqInit?.headers?.Authorization ?? 'NONE'}`);
}

console.log('\n=== 2. describeAuth ===');
for (const s of servers) {
  console.log(`  ${s}: ${describeAuth(s)}`);
}

console.log('\n=== 3. connect() — MCP client initialization ===');
await connect();

console.log('\n=== 4. Server status ===');
const status = getStatus();
const names = getServerNames();
console.log(`  Configured servers: ${names.join(', ')}`);
for (const [name, info] of Object.entries(status)) {
  console.log(`  ${name}: ${info.status}${info.error ? ' — ' + info.error : ''}`);
}

console.log('\n=== 5. listTools() — attempt to list tools ===');
const tools = await listTools();
console.log(`  Tools available: ${Object.keys(tools).length}`);

console.log('\n=== DONE ===');