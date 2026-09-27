import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Connection, PublicKey } from '@solana/web3.js';
import { getMint } from '@solana/spl-token';
import {
  DynamicBondingCurveClient,
  DYNAMIC_BONDING_CURVE_PROGRAM_ID,
  feeNumeratorToBps,
  getPriceFromSqrtPrice,
} from '@meteora-ag/dynamic-bonding-curve-sdk';

const root = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(root, 'public');
const rpc = 'https://solana-rpc.publicnode.com';
const connection = new Connection(rpc, 'confirmed');
const client = new DynamicBondingCurveClient(connection);
const host = '127.0.0.1';
const port = Number.parseInt(process.env.CURVESCOPE_PORT ?? '0', 10);
const samplePool = '3CwdXmZmpdKZNmCDfRb4J3rktHzGBm3d6zcicVmUsCfW';
const cache = new Map();
const cacheMs = 30_000;

const mime = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
};

function sendJson(response, status, data) {
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  response.end(JSON.stringify(data));
}

function toAddress(value) {
  if (typeof value !== 'string' || value.length > 50 || value.length < 32) {
    throw new Error('Enter a valid Solana pool account address.');
  }
  try {
    return new PublicKey(value);
  } catch {
    throw new Error('Enter a valid Solana pool account address.');
  }
}

function decimalAmount(raw, decimals) {
  const amount = BigInt(raw.toString());
  const divisor = 10n ** BigInt(decimals);
  const whole = amount / divisor;
  const fraction = (amount % divisor).toString().padStart(decimals, '0').replace(/0+$/, '');
  return fraction ? `${whole}.${fraction}` : whole.toString();
}

async function inspect(address) {
  const poolAddress = toAddress(address);
  const account = await connection.getAccountInfo(poolAddress);
  if (!account || !account.owner.equals(DYNAMIC_BONDING_CURVE_PROGRAM_ID)) {
    throw new Error('No Meteora DBC pool account was found. Enter a pool address, not a token mint.');
  }
  const pool = await client.state.getPool(poolAddress);
  if (!pool) throw new Error('No Meteora DBC pool account was found. Enter a pool address, not a token mint.');

  const state = pool.poolState;
  const config = await client.state.getPoolConfig(state.config);
  const [progress, quoteMint] = await Promise.all([
    client.state.getPoolQuoteTokenCurveProgress(poolAddress),
    getMint(connection, config.quoteMint),
  ]);
  const quoteDecimals = quoteMint.decimals;
  const baseDecimals = Number(config.tokenDecimal);
  const migrated = Number(state.isMigrated) !== 0;
  const price = getPriceFromSqrtPrice(state.sqrtPrice, baseDecimals, quoteDecimals);

  return {
    inspectedAt: new Date().toISOString(),
    source: 'Solana mainnet via the Meteora DBC SDK and PublicNode RPC',
    poolAddress: poolAddress.toBase58(),
    baseMint: state.baseMint.toBase58(),
    quoteMint: config.quoteMint.toBase58(),
    configAddress: state.config.toBase58(),
    creator: state.creator.toBase58(),
    baseDecimals,
    quoteDecimals,
    baseReserve: decimalAmount(state.baseReserve, baseDecimals),
    quoteReserve: decimalAmount(state.quoteReserve, quoteDecimals),
    migrationQuoteThreshold: decimalAmount(config.migrationQuoteThreshold, quoteDecimals),
    progressPercent: Math.max(0, Math.min(100, Number(progress) * 100)),
    migrated,
    migrationProgress: Number(state.migrationProgress),
    lastDbcPrice: price.toString(),
    baseFeeBps: feeNumeratorToBps(config.poolFees.baseFee.cliffFeeNumerator),
    creatorTradingFeePercent: Number(config.creatorTradingFeePercentage),
    links: {
      pool: `https://solscan.io/account/${poolAddress.toBase58()}`,
      token: `https://solscan.io/token/${state.baseMint.toBase58()}`,
      config: `https://solscan.io/account/${state.config.toBase58()}`,
    },
  };
}

const server = http.createServer(async (request, response) => {
  try {
    const url = new URL(request.url, `http://${host}`);
    if (request.method !== 'GET') {
      return sendJson(response, 405, { error: 'Only GET requests are supported.' });
    }
    if (url.pathname === '/api/health') {
      return sendJson(response, 200, { ok: true, rpc, samplePool });
    }
    if (url.pathname === '/api/inspect') {
      const address = url.searchParams.get('address') ?? samplePool;
      if (url.searchParams.toString().length > 120) {
        return sendJson(response, 400, { error: 'Address query is too long.' });
      }
      const now = Date.now();
      const saved = cache.get(address);
      if (saved && now - saved.at < cacheMs) return sendJson(response, 200, saved.data);
      try {
        const data = await Promise.race([
          inspect(address),
          new Promise((_, reject) => setTimeout(() => reject(new Error('Solana RPC took too long. Try again.')), 15_000)),
        ]);
        cache.set(address, { at: now, data });
        return sendJson(response, 200, data);
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Inspection failed.';
        return sendJson(response, message.startsWith('Enter ') || message.startsWith('No Meteora') ? 400 : 502, { error: message });
      }
    }

    const requested = url.pathname === '/' ? '/index.html' : url.pathname;
    const file = path.resolve(publicDir, `.${requested}`);
    if (file !== publicDir && !file.startsWith(publicDir + path.sep)) {
      return sendJson(response, 403, { error: 'Forbidden.' });
    }
    try {
      const body = await readFile(file);
      response.writeHead(200, {
        'Content-Type': mime[path.extname(file)] ?? 'application/octet-stream',
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
      });
      response.end(body);
    } catch {
      sendJson(response, 404, { error: 'Page not found.' });
    }
  } catch (error) {
    sendJson(response, 500, { error: error instanceof Error ? error.message : 'Unexpected error.' });
  }
});

server.listen(Number.isFinite(port) && port >= 0 ? port : 0, host, () => {
  const address = server.address();
  console.log(`CurveScope ready at http://${host}:${address.port}`);
});
