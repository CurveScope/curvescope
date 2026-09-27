import { Buffer } from 'buffer';
import { Connection, PublicKey } from '@solana/web3.js';
import { getMint } from '@solana/spl-token';
import {
  DynamicBondingCurveClient,
  DYNAMIC_BONDING_CURVE_PROGRAM_ID,
  feeNumeratorToBps,
  getPriceFromSqrtPrice,
} from '@meteora-ag/dynamic-bonding-curve-sdk';
import assets from 'virtual:assets';

globalThis.Buffer ??= Buffer;

const connection = new Connection('https://solana-rpc.publicnode.com', 'confirmed');
const client = new DynamicBondingCurveClient(connection);
const samplePool = '3CwdXmZmpdKZNmCDfRb4J3rktHzGBm3d6zcicVmUsCfW';
const cache = new Map();

function json(status, data) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  });
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
  const key = toAddress(address);
  const poolAddress = key;
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
    migrated: Number(state.isMigrated) !== 0,
    migrationProgress: Number(state.migrationProgress),
    lastDbcPrice: getPriceFromSqrtPrice(state.sqrtPrice, baseDecimals, quoteDecimals).toString(),
    baseFeeBps: feeNumeratorToBps(config.poolFees.baseFee.cliffFeeNumerator),
    creatorTradingFeePercent: Number(config.creatorTradingFeePercentage),
    links: {
      pool: `https://solscan.io/account/${poolAddress.toBase58()}`,
      token: `https://solscan.io/token/${state.baseMint.toBase58()}`,
      config: `https://solscan.io/account/${state.config.toBase58()}`,
    },
  };
}

const staticFiles = new Map([
  ['/', [assets.html, 'text/html; charset=utf-8']],
  ['/index.html', [assets.html, 'text/html; charset=utf-8']],
  ['/styles.css', [assets.css, 'text/css; charset=utf-8']],
  ['/app.js', [assets.js, 'text/javascript; charset=utf-8']],
]);

export default {
  async fetch(request) {
    if (request.method !== 'GET') return json(405, { error: 'Only GET requests are supported.' });
    const url = new URL(request.url);
    if (url.pathname === '/api/health') return json(200, { ok: true });
    if (url.pathname === '/api/inspect') {
      if (url.searchParams.toString().length > 120) return json(400, { error: 'Address query is too long.' });
      const address = url.searchParams.get('address') ?? samplePool;
      const saved = cache.get(address);
      if (saved && Date.now() - saved.at < 30_000) return json(200, saved.data);
      try {
        const data = await Promise.race([
          inspect(address),
          new Promise((_, reject) => setTimeout(() => reject(new Error('Solana RPC took too long. Try again.')), 15_000)),
        ]);
        cache.set(address, { at: Date.now(), data });
        return json(200, data);
      } catch (error) {
        console.error('CurveScope inspection failed:', error instanceof Error ? error.message : String(error));
        const message = error instanceof Error ? error.message : 'Inspection failed.';
        const badInput = message.startsWith('Enter ') || message.startsWith('No Meteora');
        return json(badInput ? 400 : 502, { error: badInput ? message : 'Solana data is temporarily unavailable. Try again.' });
      }
    }
    const file = staticFiles.get(url.pathname);
    if (!file) return json(404, { error: 'Page not found.' });
    return new Response(file[0], {
      headers: {
        'Content-Type': file[1],
        'Cache-Control': 'public, max-age=300',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  },
};
