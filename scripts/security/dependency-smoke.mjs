#!/usr/bin/env node
/** Exercise the actual overridden dependency tree without network or signers. */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(new URL('../../backend/package.json', import.meta.url));
const { Connection, PublicKey } = require('@solana/web3.js');
const layoutRequire = createRequire(require.resolve('@solana/buffer-layout-utils'));
const codecPackage = layoutRequire('bigint-buffer/package.json');
assert.equal(codecPackage.name, '@basalt/bigint-buffer');
assert.equal(codecPackage.version, '1.0.0');
assert.equal(codecPackage.scripts?.install, undefined);
const layouts = require('@solana/buffer-layout-utils');
for (const name of ['u64', 'u128', 'u192', 'u256', 'u64be', 'u128be', 'u192be', 'u256be']) {
  const layout = layouts[name](), max = (1n << BigInt(layout.span * 8)) - 1n, buffer = Buffer.alloc(layout.span + 2, 0x55);
  layout.encode(max, buffer, 1); assert.equal(layout.decode(buffer, 1), max); assert.equal(buffer[0], 0x55); assert.equal(buffer.at(-1), 0x55);
  assert.throws(() => layout.encode(max + 1n, buffer, 1)); assert.throws(() => layout.encode(-1n, buffer, 1));
}
const token = require('@solana/spl-token');
const mint = Buffer.alloc(token.MintLayout.span), key = new PublicKey('11111111111111111111111111111111');
token.MintLayout.encode({ mintAuthorityOption: 0, mintAuthority: key, supply: (1n << 64n) - 1n, decimals: 8, isInitialized: true, freezeAuthorityOption: 0, freezeAuthority: key }, mint);
assert.equal(token.MintLayout.decode(mint).supply, (1n << 64n) - 1n);
const RpcClient = require('jayson/lib/client/browser');
const client = new RpcClient((body, callback) => { const call = JSON.parse(body); callback(null, JSON.stringify({ jsonrpc: '2.0', id: call.id, result: call.params })); });
const result = await new Promise((resolve, reject) => client.request('echo', ['compatibility'], (error, response) => error ? reject(error) : resolve(response)));
assert.deepEqual(result.result, ['compatibility']);
const methods = [];
const conn = new Connection('http://127.0.0.1:8899', { fetch: async (_, init) => { const call = JSON.parse(init.body); methods.push(call.method); return Response.json({ jsonrpc: '2.0', id: call.id, result: { context: { slot: 1 }, value: 42 } }); } });
assert.equal(await conn.getBalance(key), 42); assert.deepEqual(methods, ['getBalance']);
console.log('PASS: native-free bounded Solana u64/u128/u192/u256, Token-2022 mint layout, jayson browser client and web3 RPC compatibility');
