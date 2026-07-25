/**
 * E2E Roundtrip Test - ETH → Token → ETH
 * 2 assets per category × 5 categories = 10 roundtrips = 20 on-chain tx
 * Uses 0.00025 ETH per buy (~$0.46 at ~$1860/ETH)
 *
 * Categories: Crypto, Stocks, RWAs, ETFs, Commodities
 */
import { createPublicClient, createWalletClient, http, defineChain, formatUnits, parseUnits, maxUint256 } from "viem";
import { privateKeyToAccount } from "viem/accounts";

const EXPLORER = "https://robinhoodchain.blockscout.com/tx";
const RPC      = "https://rpc.mainnet.chain.robinhood.com";

const chain = defineChain({
  id: 4663,
  name: "Robinhood Chain",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: [RPC] } },
});

const SPOT_ROUTER   = process.env.SPOT_ROUTER_ADDRESS;
const SPOT_FACTORY  = process.env.SPOT_FACTORY_ADDRESS;
const DEPLOYER_KEY  = process.env.DEPLOYER_PRIVATE_KEY;

if (!SPOT_ROUTER || !SPOT_FACTORY || !DEPLOYER_KEY) {
  console.error("Missing env:", { SPOT_ROUTER: !!SPOT_ROUTER, SPOT_FACTORY: !!SPOT_FACTORY, DEPLOYER_KEY: !!DEPLOYER_KEY });
  process.exit(1);
}

const rawKey = DEPLOYER_KEY.startsWith("0x") ? DEPLOYER_KEY : `0x${DEPLOYER_KEY}`;
const account = privateKeyToAccount(rawKey);
const pub  = createPublicClient({ chain, transport: http(RPC, { timeout: 30000 }) });
const wal  = createWalletClient({ account, chain, transport: http(RPC, { timeout: 30000 }) });

// ── ABIs ──────────────────────────────────────────────────────────────────────

const ROUTER_ABI = [
  { name: "mintWithEth",    type: "function", stateMutability: "payable",    inputs: [{ name: "symbol", type: "string" }, { name: "minAssetOut", type: "uint256" }], outputs: [{ name: "assetOut", type: "uint256" }] },
  { name: "burnToEth",      type: "function", stateMutability: "nonpayable", inputs: [{ name: "symbol", type: "string" }, { name: "assetAmount", type: "uint256" }, { name: "minEthOut", type: "uint256" }], outputs: [{ name: "ethOut", type: "uint256" }] },
  { name: "quoteMintWithEth", type: "function", stateMutability: "view",     inputs: [{ name: "symbol", type: "string" }, { name: "ethAmount", type: "uint256" }], outputs: [{ name: "assetOut", type: "uint256" }] },
  { name: "quoteBurnToEth",   type: "function", stateMutability: "view",     inputs: [{ name: "symbol", type: "string" }, { name: "assetAmount", type: "uint256" }], outputs: [{ name: "ethOut", type: "uint256" }] },
];

const FACTORY_ABI = [
  { name: "tokenAddress", type: "function", stateMutability: "view", inputs: [{ name: "", type: "string" }], outputs: [{ type: "address" }] },
];

const ERC20_ABI = [
  { name: "balanceOf", type: "function", stateMutability: "view",       inputs: [{ name: "account", type: "address" }], outputs: [{ type: "uint256" }] },
  { name: "allowance", type: "function", stateMutability: "view",       inputs: [{ name: "owner", type: "address" }, { name: "spender", type: "address" }], outputs: [{ type: "uint256" }] },
  { name: "approve",   type: "function", stateMutability: "nonpayable", inputs: [{ name: "spender", type: "address" }, { name: "amount", type: "uint256" }], outputs: [{ type: "bool" }] },
];

// ── Test matrix ───────────────────────────────────────────────────────────────

const TESTS = [
  { category: "Crypto",      symbol: "BTC"    },
  { category: "Crypto",      symbol: "SOL"    },
  { category: "Stocks",      symbol: "NVDA"   },
  { category: "Stocks",      symbol: "TSLA"   },
  { category: "RWAs",        symbol: "ONDO"   },
  { category: "RWAs",        symbol: "BUIDL"  },
  { category: "ETFs",        symbol: "SPY"    },
  { category: "ETFs",        symbol: "QQQ"    },
  { category: "Commodities", symbol: "GOLD"   },
  { category: "Commodities", symbol: "SILVER" },
];

const ETH_PER_BUY = parseUnits("0.00025", 18); // ~$0.46
const SLIPPAGE    = 9950n; // 0.5%

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmt(wei, dec = 18) { return parseFloat(formatUnits(wei, dec)).toFixed(8); }
function pad(s, n) { return String(s).padEnd(n); }

async function ensureApproval(tokenAddr, amount) {
  const allowance = await pub.readContract({ address: tokenAddr, abi: ERC20_ABI, functionName: "allowance", args: [account.address, SPOT_ROUTER] });
  if (BigInt(allowance) >= amount) return null;
  const hash = await wal.writeContract({ address: tokenAddr, abi: ERC20_ABI, functionName: "approve", args: [SPOT_ROUTER, maxUint256] });
  await pub.waitForTransactionReceipt({ hash });
  return hash;
}

// ── Run tests ─────────────────────────────────────────────────────────────────

const results = [];
const startEth = await pub.getBalance({ address: account.address });

console.log("=".repeat(90));
console.log("COMMODITEX E2E ROUNDTRIP TEST  -  ETH → Token → ETH");
console.log(`Wallet: ${account.address}`);
console.log(`ETH balance (start): ${fmt(startEth)} ETH`);
console.log(`ETH per buy: ${fmt(ETH_PER_BUY)} ETH (0.00025)`);
console.log("=".repeat(90));

for (const test of TESTS) {
  const { category, symbol } = test;
  const result = { category, symbol, buy: null, sell: null, error: null };

  console.log(`\n${"─".repeat(70)}`);
  console.log(`[${category}] ${symbol}`);

  try {
    // ── Get token address ──────────────────────────────────────────────────
    const tokenAddr = await pub.readContract({ address: SPOT_FACTORY, abi: FACTORY_ABI, functionName: "tokenAddress", args: [symbol] });
    console.log(`  Token addr:  ${tokenAddr}`);

    // ── Step 1: Quote buy ──────────────────────────────────────────────────
    const quotedOut = await pub.readContract({ address: SPOT_ROUTER, abi: ROUTER_ABI, functionName: "quoteMintWithEth", args: [symbol, ETH_PER_BUY] });
    const minOut    = BigInt(quotedOut) * SLIPPAGE / 10000n;
    console.log(`  Quoted out:  ${fmt(BigInt(quotedOut))} ${symbol}`);

    // ── Step 2: BUY - mintWithEth ──────────────────────────────────────────
    const balBefore = await pub.readContract({ address: tokenAddr, abi: ERC20_ABI, functionName: "balanceOf", args: [account.address] });

    const buyHash = await wal.writeContract({
      address: SPOT_ROUTER, abi: ROUTER_ABI, functionName: "mintWithEth",
      args: [symbol, minOut], value: ETH_PER_BUY,
    });
    const buyReceipt = await pub.waitForTransactionReceipt({ hash: buyHash });
    const balAfter   = await pub.readContract({ address: tokenAddr, abi: ERC20_ABI, functionName: "balanceOf", args: [account.address] });
    const received   = BigInt(balAfter) - BigInt(balBefore);

    result.buy = { hash: buyHash, status: buyReceipt.status, gasUsed: buyReceipt.gasUsed.toString(), received: fmt(received) };
    const buyStatus = buyReceipt.status === "success" ? "✅ BUY " : "❌ BUY ";
    console.log(`  ${buyStatus} tx:   ${EXPLORER}/${buyHash}`);
    console.log(`         gas:  ${buyReceipt.gasUsed} | received: ${fmt(received)} ${symbol}`);

    if (buyReceipt.status !== "success" || received === 0n) {
      result.error = "BUY failed or received 0 tokens";
      results.push(result);
      continue;
    }

    // ── Step 3: Approve token to SpotRouter ────────────────────────────────
    const approveHash = await ensureApproval(tokenAddr, received);
    if (approveHash) console.log(`  APPROVE tx:  ${EXPLORER}/${approveHash}`);

    // ── Step 4: Quote sell ─────────────────────────────────────────────────
    const quotedEth = await pub.readContract({ address: SPOT_ROUTER, abi: ROUTER_ABI, functionName: "quoteBurnToEth", args: [symbol, received] });
    const minEthOut = BigInt(quotedEth) * SLIPPAGE / 10000n;
    console.log(`  Quoted ETH:  ${fmt(BigInt(quotedEth))} ETH`);

    // ── Step 5: SELL - burnToEth ───────────────────────────────────────────
    const sellHash = await wal.writeContract({
      address: SPOT_ROUTER, abi: ROUTER_ABI, functionName: "burnToEth",
      args: [symbol, received, minEthOut],
    });
    const sellReceipt = await pub.waitForTransactionReceipt({ hash: sellHash });

    result.sell = { hash: sellHash, status: sellReceipt.status, gasUsed: sellReceipt.gasUsed.toString(), ethReceived: fmt(BigInt(quotedEth)) };
    const sellStatus = sellReceipt.status === "success" ? "✅ SELL" : "❌ SELL";
    console.log(`  ${sellStatus} tx:   ${EXPLORER}/${sellHash}`);
    console.log(`         gas:  ${sellReceipt.gasUsed} | ETH back: ~${fmt(BigInt(quotedEth))} ETH`);

  } catch (err) {
    result.error = err.message ?? String(err);
    console.log(`  ❌ ERROR: ${result.error}`);
  }

  results.push(result);
}

// ── Final report ──────────────────────────────────────────────────────────────

const endEth  = await pub.getBalance({ address: account.address });
const netLoss = startEth - endEth;

console.log("\n");
console.log("=".repeat(90));
console.log("FINAL REPORT");
console.log("=".repeat(90));
console.log(`Wallet:       ${account.address}`);
console.log(`ETH start:    ${fmt(startEth)} ETH`);
console.log(`ETH end:      ${fmt(endEth)} ETH`);
console.log(`Net cost:     ${fmt(netLoss)} ETH  (gas + spread)\n`);

let passCount = 0, failCount = 0;

for (const r of results) {
  const buyOk  = r.buy?.status  === "success";
  const sellOk = r.sell?.status === "success";
  const pass   = buyOk && sellOk;
  if (pass) passCount++; else failCount++;

  const mark = pass ? "✅" : "❌";
  console.log(`${mark} [${pad(r.category, 12)}] ${pad(r.symbol, 8)}`);
  if (r.buy)  console.log(`     BUY  ${r.buy.status.toUpperCase().padEnd(8)} gas=${pad(r.buy.gasUsed, 7)} received=${r.buy.received} ${r.symbol}`);
  if (r.buy)  console.log(`          ${EXPLORER}/${r.buy.hash}`);
  if (r.sell) console.log(`     SELL ${r.sell.status.toUpperCase().padEnd(8)} gas=${pad(r.sell.gasUsed, 7)} ETH back≈${r.sell.ethReceived}`);
  if (r.sell) console.log(`          ${EXPLORER}/${r.sell.hash}`);
  if (r.error) console.log(`     ERR  ${r.error}`);
  console.log();
}

console.log(`RESULT: ${passCount}/${TESTS.length} passed, ${failCount} failed`);
console.log("=".repeat(90));
