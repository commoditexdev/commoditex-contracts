/**
 * Verify all Commoditex contracts on Blockscout (Robinhood Chain).
 * Checks is_verified first - skips contracts already verified.
 *
 * Run from artifacts/contracts/:
 *   node verify.mjs
 */

import { readFileSync } from "fs";

const BLOCKSCOUT = "https://robinhoodchain.blockscout.com";
const COMPILER   = "v0.8.24+commit.e11b9ed9";
const LICENSE    = "apache_2_0";

const SPOT_FACTORY = "0xec4e919b3b7695027eae531333120550045c1c73";
const SPOT_ROUTER  = "0x14640c43512beb6e90940c68687e096b061bf862";
const PERP_ORACLE  = "0x803f16faf23f80d9b5bcd1520bd8af2efb793f62";
const PERP_NFT     = "0x60828aa2c7ce9077af4d2efda620128939073354";
const PERP_ROUTER  = "0x53464b037b26757207b84a36a3e1c5aa8c4f3d60";

function flatten(...files) {
  const chunks = [];
  let pragmaWritten = false;
  for (const f of files) {
    for (const line of readFileSync(f, "utf8").split("\n")) {
      const t = line.trim();
      if (t.startsWith("pragma ")) { if (!pragmaWritten) { chunks.push(line); pragmaWritten = true; } continue; }
      if (t.startsWith("import ")) continue;
      chunks.push(line);
    }
    chunks.push("");
  }
  return chunks.join("\n");
}

const FLAT = {
  token:      flatten("CommoditexToken.sol"),
  factory:    flatten("CommoditexToken.sol", "CommoditexAssetFactory.sol"),
  spotRouter: flatten("CommoditexToken.sol", "CommoditexAssetFactory.sol", "CommoditexSpotRouter.sol"),
  perpOracle: flatten("CommoditexPerpOracle.sol"),
  perpNft:    flatten("CommoditexPerpNFT.sol"),
  perpRouter: flatten("CommoditexPerpOracle.sol", "CommoditexPerpNFT.sol", "CommoditexPerpRouter.sol"),
};

const tokenlist = JSON.parse(readFileSync("commoditex.tokenlist.json", "utf8"));

const ALL = [
  ...tokenlist.tokens.map((t) => ({ address: t.address, label: `CommoditexToken (${t.symbol})`, source: FLAT.token })),
  { address: SPOT_FACTORY, label: "CommoditexAssetFactory", source: FLAT.factory     },
  { address: SPOT_ROUTER,  label: "CommoditexSpotRouter",   source: FLAT.spotRouter  },
  { address: PERP_ORACLE,  label: "CommoditexPerpOracle",   source: FLAT.perpOracle  },
  { address: PERP_NFT,     label: "CommoditexPerpNFT",      source: FLAT.perpNft     },
  { address: PERP_ROUTER,  label: "CommoditexPerpRouter",   source: FLAT.perpRouter  },
];

async function isVerified(address) {
  try {
    const r = await fetch(`${BLOCKSCOUT}/api/v2/smart-contracts/${address}`, { signal: AbortSignal.timeout(8_000) });
    const j = await r.json().catch(() => ({}));
    return j.is_verified === true;
  } catch { return false; }
}

async function submit({ address, label, source }) {
  const url = `${BLOCKSCOUT}/api/v2/smart-contracts/${address}/verification/via/flattened-code`;
  try {
    const resp = await fetch(url, {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        compiler_version:            COMPILER,
        license_type:                LICENSE,
        source_code:                 source,
        is_optimization_enabled:     true,
        optimization_runs:           200,
        evm_version:                 "default",
        autodetect_constructor_args: true,
      }),
      signal: AbortSignal.timeout(20_000),
    });
    const j = await resp.json().catch(() => ({}));
    if (resp.ok)  { console.log(`  ✓  ${label}`); return "ok"; }
    const msg = (j.message ?? j.error ?? resp.status).toString().toLowerCase();
    if (msg.includes("already"))  { console.log(`  ✓  ${label} - already verified`); return "already"; }
    // 500 often means verifier busy - retry once after 3s
    if (resp.status === 500) {
      await new Promise(r => setTimeout(r, 3000));
      const r2 = await fetch(url, { method:"POST", headers:{"Content-Type":"application/json"}, body: JSON.stringify({ compiler_version: COMPILER, license_type: LICENSE, source_code: source, is_optimization_enabled: true, optimization_runs: 200, evm_version: "default", autodetect_constructor_args: true }), signal: AbortSignal.timeout(20_000) });
      if (r2.ok) { console.log(`  ✓  ${label} (retry ok)`); return "ok"; }
    }
    console.warn(`  ✗  ${label}: ${j.message ?? j.error ?? resp.status}`);
    return "fail";
  } catch (e) {
    console.warn(`  ✗  ${label}: ${e.message}`);
    return "error";
  }
}

console.log(`\nVerifying ${ALL.length} contracts on Robinhood Chain Blockscout...\n`);
const results = { ok: 0, already: 0, fail: 0, error: 0 };

for (let i = 0; i < ALL.length; i++) {
  const c = ALL[i];
  process.stdout.write(`[${i+1}/${ALL.length}] `);
  const already = await isVerified(c.address);
  if (already) { console.log(`  ✓  ${c.label} - already verified`); results.already++; continue; }
  const r = await submit(c);
  results[r]++;
  await new Promise(res => setTimeout(res, 800));
}

console.log(`\n── Summary ──────────────────────────────────`);
console.log(`  Submitted:        ${results.ok}`);
console.log(`  Already verified: ${results.already}`);
console.log(`  Failed:           ${results.fail}`);
console.log(`  Error:            ${results.error}`);
console.log(`  Total:            ${ALL.length}`);
