/**
 * Deploy CommoditexPerpOracle + CommoditexPerpNFT + CommoditexPerpRouter to Robinhood Chain.
 * Run: ALCHEMY_RPC_URL=... DEPLOYER_PRIVATE_KEY=0x... node deploy.perp.mjs
 *
 * Requires REPLIT_DEV_DOMAIN for logo URLs in NFT metadata.
 * After a successful run, print the three contract addresses.
 */
import { createPublicClient, createWalletClient, http, defineChain } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { readFileSync } from "fs";

// ── Chain configuration ───────────────────────────────────────────────────────

const chain = defineChain({
  id: 4663,
  name: "Robinhood Chain",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: {
    default: { http: [process.env.ALCHEMY_RPC_URL ?? "https://rpc.mainnet.chain.robinhood.com"] },
  },
  blockExplorers: {
    default: { name: "Blockscout", url: "https://robinhoodchain.blockscout.com" },
  },
});

const USDG       = "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168";
const BLOCKSCOUT = "https://robinhoodchain.blockscout.com";
const BASE_URL   = process.env.REPLIT_DEV_DOMAIN
  ? `https://${process.env.REPLIT_DEV_DOMAIN}`
  : "https://app.commoditex.xyz";

// ── Deployer wallet ───────────────────────────────────────────────────────────

const _rawPk = process.env.DEPLOYER_PRIVATE_KEY;
if (!_rawPk) { console.error("DEPLOYER_PRIVATE_KEY is required"); process.exit(1); }
const pk = _rawPk.startsWith("0x") ? _rawPk : `0x${_rawPk}`;

const account      = privateKeyToAccount(pk);
const publicClient = createPublicClient({ chain, transport: http() });
const walletClient = createWalletClient({ account, chain, transport: http() });

// ── ABI loading ───────────────────────────────────────────────────────────────

const ORACLE_ABI  = JSON.parse(readFileSync("CommoditexPerpOracle.abi.json", "utf8"));
const NFT_ABI     = JSON.parse(readFileSync("CommoditexPerpNFT.abi.json",    "utf8"));
const ROUTER_ABI  = JSON.parse(readFileSync("CommoditexPerpRouter.abi.json", "utf8"));
const ORACLE_BYT  = "0x" + readFileSync("CommoditexPerpOracle.bytecode.txt", "utf8").trim();
const NFT_BYT     = "0x" + readFileSync("CommoditexPerpNFT.bytecode.txt",    "utf8").trim();
const ROUTER_BYT  = "0x" + readFileSync("CommoditexPerpRouter.bytecode.txt", "utf8").trim();

// ── Helpers ───────────────────────────────────────────────────────────────────

async function deploy(abi, bytecode, args = []) {
  const hash = await walletClient.deployContract({ abi, bytecode, args, account, chain: undefined });
  console.log("  Deploy tx:", hash);
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  return receipt.contractAddress;
}

async function verifyOnBlockscout(address, contractName, sources) {
  try {
    const stdJson = {
      language: "Solidity",
      sources,
      settings: {
        optimizer: { enabled: true, runs: 200 },
        outputSelection: { "*": { "*": ["abi", "evm.bytecode"] } },
      },
    };
    const resp = await fetch(
      `${BLOCKSCOUT}/api/v2/smart-contracts/${address}/verification/via/standard-input`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          compiler_version: "v0.8.24+commit.e11b9ed9",
          license_type: "apache2",
          source_code: JSON.stringify(stdJson),
        }),
      }
    );
    const json = await resp.json().catch(() => ({}));
    if (resp.ok) {
      console.log(`  Verified ${contractName} on Blockscout`);
    } else {
      console.warn(`  Verification pending for ${contractName}:`, json.message ?? resp.status);
    }
  } catch (e) {
    console.warn(`  Blockscout verification skipped (${e.message})`);
  }
}

function buildSources(...filenames) {
  const s = {};
  for (const f of filenames) s[f] = { content: readFileSync(f, "utf8") };
  return s;
}

// ── Main deploy flow ──────────────────────────────────────────────────────────

console.log("\nCommoditex Perp Contracts - Deploy to Robinhood Chain");
console.log("Deployer:", account.address);
const balance = await publicClient.getBalance({ address: account.address });
console.log("Balance:", (Number(balance) / 1e18).toFixed(6), "ETH");
console.log("Logo base URL:", BASE_URL, "\n");

// Step 1: Deploy CommoditexPerpOracle (keeper = deployer)
console.log("1/3 Deploying CommoditexPerpOracle...");
const oracleAddr = await deploy(ORACLE_ABI, ORACLE_BYT, [account.address]);
console.log("  Oracle:", oracleAddr);
console.log("  Blockscout:", `${BLOCKSCOUT}/address/${oracleAddr}\n`);

// Step 2: Deploy CommoditexPerpNFT (router not known yet - will be set after router deploy)
// We deploy router first then update NFT router, OR we deploy NFT with a placeholder
// and update via the NFT's setRouter function. However, our NFT uses immutable router.
// Solution: deploy Router address-deterministically or predict it.
// Simple approach: deploy Oracle → predict Router address → deploy NFT with predicted Router.
// Alternatively, deploy a temporary NFT, then deploy Router, then update.
// Simplest: deploy Router with dummy NFT, then re-deploy NFT with real Router address.
// BEST: deploy Oracle → NFT with deployer as placeholder router → Router with real NFT →
//       then add setRouter() on NFT (we have transferOwnership but not setRouter).
// ACTUAL simplest for this script: deploy them in order using address prediction.
// We use a two-step: deploy NFT(router=0x1) first (not valid) - not possible with ZeroAddress check.
// REAL solution: deploy Router with a known NFT address by pre-computing.
// For simplicity in this script we use a proxy pattern:
// 1. Deploy Oracle
// 2. Deploy NFT with owner as temporary router (bypasses zero check), note router is NOT immutable
// Actually looking at the contract, router IS NOT immutable - it's a plain address field.
// We added no setRouter() function. Let's add the ability:
// Actually wait - looking at the contract, router is `address public router` not immutable.
// Let us add setRouter to CommoditexPerpNFT... but we can't change contracts without recompiling.
// SIMPLEST for now: deploy NFT with deployer as temporary router, then deploy Router,
// then we need to update nft.router = RouterAddr.
// But there's no setRouter function in our contract!
// WORKAROUND: deploy NFT with predicted router address.
// We can predict the router address since we know the deployer nonce.

// Get current nonce to predict router address
const nonce = await publicClient.getTransactionCount({ address: account.address });
// NFT will be deployed at nonce N, Router at nonce N+1
// We can compute the router address using RLP-encoded (deployer, nonce+1)
const { getContractAddress } = await import("viem");
const predictedRouterAddr = getContractAddress({ from: account.address, nonce: BigInt(nonce + 1) });
console.log("  Predicted Router address:", predictedRouterAddr);

console.log("2/3 Deploying CommoditexPerpNFT...");
const nftAddr = await deploy(NFT_ABI, NFT_BYT, [predictedRouterAddr, BASE_URL]);
console.log("  NFT:", nftAddr);
console.log("  Blockscout:", `${BLOCKSCOUT}/address/${nftAddr}\n`);

// Step 3: Deploy CommoditexPerpRouter
console.log("3/3 Deploying CommoditexPerpRouter...");
// feeRecipient = deployer for now, changeable via setFeeRecipient()
const routerAddr = await deploy(
  ROUTER_ABI, ROUTER_BYT,
  [oracleAddr, nftAddr, USDG, account.address]
);
console.log("  Router:", routerAddr);
console.log("  Blockscout:", `${BLOCKSCOUT}/address/${routerAddr}\n`);

// Sanity check - predicted vs actual
if (routerAddr.toLowerCase() !== predictedRouterAddr.toLowerCase()) {
  console.error("Router address mismatch! Predicted:", predictedRouterAddr, "Actual:", routerAddr);
  console.error("NFT contract has wrong router address. Re-deploy with correct address.");
  process.exit(1);
}
console.log("  Router address prediction was correct.\n");

// Step 4: Verify all three contracts on Blockscout
console.log("Submitting verification to Blockscout...");
await verifyOnBlockscout(oracleAddr, "CommoditexPerpOracle",
  buildSources("CommoditexPerpOracle.sol")
);
await verifyOnBlockscout(nftAddr, "CommoditexPerpNFT",
  buildSources("CommoditexPerpNFT.sol")
);
await verifyOnBlockscout(routerAddr, "CommoditexPerpRouter",
  buildSources("CommoditexPerpNFT.sol", "CommoditexPerpOracle.sol", "CommoditexPerpRouter.sol")
);

// Step 5: Print env vars
console.log("\n=============================================================");
console.log("SUCCESS. Set these environment variables in your project:");
console.log("=============================================================");
console.log(`PERP_ORACLE_ADDRESS=${oracleAddr}`);
console.log(`PERP_NFT_ADDRESS=${nftAddr}`);
console.log(`PERP_ROUTER_ADDRESS=${routerAddr}`);
console.log("=============================================================\n");
