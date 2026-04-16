/*
 * FP2P — Fetch prices from Cloudflare Worker
 * Runs every 5 min via GitHub Actions
 */

const fs = require('fs');
const path = require('path');

const WORKER_URL = process.env.WORKER_URL;
const PRICES_FILE = path.join(__dirname, 'prices.json');
const MAX_POINTS = 30000;

if (!WORKER_URL) {
  console.error('ERROR: WORKER_URL secret no configurado');
  process.exit(1);
}

async function fetchPrice(fiat) {
  try {
    const r = await fetch(WORKER_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        asset: 'USDT',
        fiat,
        tradeType: 'SELL',
        page: 1,
        rows: 1,
        payTypes: [],
        publisherType: null,
        merchantCheck: false,
        transAmount: '',
      }),
    });
    if (!r.ok) {
      console.error(`${fiat}: HTTP ${r.status}`);
      return null;
    }
    const d = await r.json();
    if (d?.code !== '000000' || !Array.isArray(d?.data) || d.data.length === 0) {
      console.error(`${fiat}: respuesta invalida`, JSON.stringify(d).slice(0, 200));
      return null;
    }
    const price = parseFloat(d.data[0]?.adv?.price ?? 0);
    if (!price) return null;
    return price;
  } catch (e) {
    console.error(`${fiat}: error`, e.message);
    return null;
  }
}

async function main() {
  console.log('Iniciando fetch...');

  let store = { PEN: [], VES: [], updated: 0 };
  if (fs.existsSync(PRICES_FILE)) {
    try {
      store = JSON.parse(fs.readFileSync(PRICES_FILE, 'utf8'));
      if (!store.PEN) store.PEN = [];
      if (!store.VES) store.VES = [];
    } catch (e) {
      console.error('prices.json corrupto, empezando fresco');
    }
  }

  const [pen, ves] = await Promise.all([
    fetchPrice('PEN'),
    fetchPrice('VES'),
  ]);

  const now = Math.floor(Date.now() / 1000);
  let added = 0;

  function isOutlier(price, history) {
    if (history.length < 5) return false;
    const recent = history.slice(-10);
    const avg = recent.reduce((s, p) => s + p.v, 0) / recent.length;
    const deviation = Math.abs(price - avg) / avg;
    return deviation > 0.05;
  }

  if (pen) {
    if (isOutlier(pen, store.PEN)) {
      const avg = store.PEN.slice(-10).reduce((s,p)=>s+p.v,0) / Math.min(10, store.PEN.length);
      console.log(`PEN OUTLIER descartado: ${pen.toFixed(3)} (promedio ${avg.toFixed(3)})`);
    } else {
      store.PEN.push({ t: now, v: pen });
      if (store.PEN.length > MAX_POINTS) {
        store.PEN.splice(0, store.PEN.length - MAX_POINTS);
      }
      console.log(`PEN: S/ ${pen.toFixed(3)}`);
      added++;
    }
  } else {
    console.log('PEN: skip');
  }

  if (ves) {
    if (isOutlier(ves, store.VES)) {
      const avg = store.VES.slice(-10).reduce((s,p)=>s+p.v,0) / Math.min(10, store.VES.length);
      console.log(`VES OUTLIER descartado: ${ves.toFixed(2)} (promedio ${avg.toFixed(2)})`);
    } else {
      store.VES.push({ t: now, v: ves });
      if (store.VES.length > MAX_POINTS) {
        store.VES.splice(0, store.VES.length - MAX_POINTS);
      }
      console.log(`VES: Bs. ${ves.toFixed(2)}`);
      added++;
    }
  } else {
    console.log('VES: skip');
  }

  if (added === 0) {
    console.error('No se obtuvo ningun precio. Saliendo sin escribir.');
    process.exit(0);
  }

  store.updated = now;
  store.totalPEN = store.PEN.length;
  store.totalVES = store.VES.length;

  fs.writeFileSync(PRICES_FILE, JSON.stringify(store));
  console.log(`OK — PEN: ${store.PEN.length} pts, VES: ${store.VES.length} pts`);
}

main().catch(e => {
  console.error('Fatal:', e);
  process.exit(1);
});
