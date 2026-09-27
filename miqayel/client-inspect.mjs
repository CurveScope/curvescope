import { Buffer } from 'buffer';
import { Connection, PublicKey } from '@solana/web3.js';
import { getMint } from '@solana/spl-token';
import {
  DynamicBondingCurveClient,
  DYNAMIC_BONDING_CURVE_PROGRAM_ID,
  feeNumeratorToBps,
  getPriceFromSqrtPrice,
} from '@meteora-ag/dynamic-bonding-curve-sdk';

globalThis.Buffer ??= Buffer;

const connection = new Connection('https://solana-rpc.publicnode.com', 'confirmed');
const client = new DynamicBondingCurveClient(connection);
const cache = new Map();

function toAddress(value) {
  if (typeof value !== 'string' || value.length < 32 || value.length > 50) {
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

async function readPool(address) {
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
  const baseDecimals = Number(config.tokenDecimal);
  const quoteDecimals = quoteMint.decimals;

  return {
    inspectedAt: new Date().toISOString(),
    source: 'Solana mainnet via the Meteora DBC SDK and PublicNode RPC (browser read)',
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

globalThis.curvescopeInspect = async (address) => {
  const saved = cache.get(address);
  if (saved && Date.now() - saved.at < 30_000) return saved.data;
  try {
    const data = await Promise.race([
      readPool(address),
      new Promise((_, reject) => setTimeout(() => reject(new Error('Solana RPC took too long. Try again.')), 15_000)),
    ]);
    cache.set(address, { at: Date.now(), data });
    return data;
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Inspection failed.';
    if (message.startsWith('Enter ') || message.startsWith('No Meteora') || message.startsWith('Solana RPC took')) {
      throw error;
    }
    throw new Error('Solana data is temporarily unavailable. Try again.');
  }
};
