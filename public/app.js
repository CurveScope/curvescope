const $ = (id) => document.getElementById(id);
const form = $('inspect-form');
const input = $('address');
const inspectButton = $('inspect-button');
const refreshButton = $('refresh-button');
const downloadButton = $('download-button');
const status = $('status');
const knownQuoteTokens = {
  So11111111111111111111111111111111111111112: 'SOL',
  EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v: 'USDC',
};
let current = null;
let loading = false;

function abbreviated(value) {
  return `${value.slice(0, 7)}…${value.slice(-6)}`;
}

function decimal(value, digits = 3) {
  const number = Number(value);
  if (!Number.isFinite(number)) return value;
  return new Intl.NumberFormat('en-US', { maximumFractionDigits: digits }).format(number);
}

function priceDisplay(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return value;
  if (number === 0) return '0';
  if (number < 0.000001 && number >= 0.000000001) {
    return number.toFixed(10).replace(/0+$/, '').replace(/\.$/, '');
  }
  if (number < 0.000000001) return number.toPrecision(4);
  return new Intl.NumberFormat('en-US', { maximumSignificantDigits: 6 }).format(number);
}

function setAddress(id, value, href) {
  const element = $(id);
  element.textContent = abbreviated(value);
  element.title = value;
  if (href) element.href = href;
}

function render(data) {
  current = data;
  const quote = knownQuoteTokens[data.quoteMint] ?? 'QUOTE';
  const percent = Math.round(data.progressPercent * 10) / 10;
  $('progress-value').textContent = `${decimal(percent, 1)}%`;
  $('migration-progress').value = percent;
  $('orbit-migration').textContent = `MIGRATION / ${decimal(percent, 1)}%`;
  $('progress-ring').style.setProperty('--progress', String(percent));
  $('microbar-fill').style.width = `${percent}%`;
  $('state-pill').textContent = data.migrated ? 'MIGRATED' : 'ON CURVE';
  $('state-pill').classList.toggle('migrated', data.migrated);
  $('migration-title').textContent = data.migrated ? 'Curve graduated' : 'Price discovery in motion';
  $('migration-description').textContent = data.migrated
    ? 'This pool has migrated. Curve price is a historical DBC state, not its current market price.'
    : 'This pool is still on its bonding curve. Progress comes from Meteora’s pool state.';
  $('quote-reserve').textContent = `${decimal(data.quoteReserve, 4)} / ${decimal(data.migrationQuoteThreshold, 4)} ${quote}`;
  $('price').textContent = priceDisplay(data.lastDbcPrice);
  $('price').title = data.lastDbcPrice;
  $('price-unit').textContent = `${quote} PER BASE TOKEN`;
  $('price-note').textContent = data.migrated
    ? 'Final DBC state only. Check a live market for post-migration pricing.'
    : 'Derived from the on-chain square-root price. This is not an executable quote.';
  $('fee').textContent = decimal(data.baseFeeBps, 2);
  setAddress('pool-address', data.poolAddress, data.links.pool);
  setAddress('base-address', data.baseMint, data.links.token);
  setAddress('config-address', data.configAddress, data.links.config);
  $('quote-address').textContent = abbreviated(data.quoteMint);
  $('quote-address').title = data.quoteMint;
  $('updated-at').textContent = `READ ${new Date(data.inspectedAt).toLocaleTimeString()}`;
  downloadButton.disabled = false;
  status.classList.remove('error');
  status.textContent = data.migrated
    ? 'Verified on-chain: this pool has migrated.'
    : 'Verified on-chain: this pool is active on its curve.';
}

async function inspect() {
  if (loading) return;
  loading = true;
  inspectButton.disabled = true;
  refreshButton.disabled = true;
  status.classList.remove('error');
  status.textContent = 'Reading Solana mainnet account data…';
  try {
    let data;
    if (typeof globalThis.curvescopeInspect === 'function') {
      data = await globalThis.curvescopeInspect(input.value.trim());
    } else {
      const response = await fetch(`/api/inspect?address=${encodeURIComponent(input.value.trim())}`);
      data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Inspection failed.');
    }
    render(data);
  } catch (error) {
    status.classList.add('error');
    status.textContent = error instanceof Error ? error.message : 'Inspection failed.';
  } finally {
    loading = false;
    inspectButton.disabled = false;
    refreshButton.disabled = false;
  }
}

form.addEventListener('submit', (event) => {
  event.preventDefault();
  inspect();
});
refreshButton.addEventListener('click', inspect);
downloadButton.addEventListener('click', () => {
  if (!current) return;
  const blob = new Blob([JSON.stringify(current, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `curvescope-${current.baseMint.slice(0, 8)}-${new Date(current.inspectedAt).toISOString().slice(0, 10)}.json`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
});

inspect();
