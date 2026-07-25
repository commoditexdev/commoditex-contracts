/**
 * Deploy CommoditexAssetFactory + CommoditexSpotRouter + all 44 spot tokens to Robinhood Chain.
 * Run: ALCHEMY_RPC_URL=... DEPLOYER_PRIVATE_KEY=0x... node deploy.spot.mjs
 *
 * After a successful run this script prints all contract addresses and
 * writes commoditex.tokenlist.json ready to be served at /api/tokenlist.
 */
import { createPublicClient, createWalletClient, http, defineChain, parseUnits } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { readFileSync, writeFileSync } from "fs";
import { execSync } from "child_process";

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

const USDG    = "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168";
const BLOCKSCOUT = "https://robinhoodchain.blockscout.com";

// ── Deployer wallet ───────────────────────────────────────────────────────────

const _rawPk = process.env.DEPLOYER_PRIVATE_KEY;
if (!_rawPk) { console.error("DEPLOYER_PRIVATE_KEY is required"); process.exit(1); }
const pk = _rawPk.startsWith("0x") ? _rawPk : `0x${_rawPk}`;

const account      = privateKeyToAccount(pk);
const publicClient = createPublicClient({ chain, transport: http() });
const walletClient = createWalletClient({ account, chain, transport: http() });

// ── ABI loading ───────────────────────────────────────────────────────────────

const FACTORY_ABI = JSON.parse(readFileSync("CommoditexAssetFactory.abi.json", "utf8"));
const ROUTER_ABI  = JSON.parse(readFileSync("CommoditexSpotRouter.abi.json",   "utf8"));
const FACTORY_BYT = "0x" + readFileSync("CommoditexAssetFactory.bytecode.txt", "utf8").trim();
const ROUTER_BYT  = "0x" + readFileSync("CommoditexSpotRouter.bytecode.txt",   "utf8").trim();

// ── Asset metadata ────────────────────────────────────────────────────────────
// All English names. Prices are initial estimates used only for first setup -
// the oracle cron updates them every 3 minutes via factory.setPrices().

const BASE_URL = process.env.REPLIT_DEV_DOMAIN
  ? `https://${process.env.REPLIT_DEV_DOMAIN}`
  : "https://app.commoditex.xyz";

const ASSETS = [
  // Tokenized Stocks
  { symbol: "NVDA",  name: "NVIDIA",                   category: "Tokenized Stock",  price: 135,      yf: "NVDA"  },
  { symbol: "TSLA",  name: "Tesla",                    category: "Tokenized Stock",  price: 310,      yf: "TSLA"  },
  { symbol: "AAPL",  name: "Apple",                    category: "Tokenized Stock",  price: 220,      yf: "AAPL"  },
  { symbol: "MSFT",  name: "Microsoft",                category: "Tokenized Stock",  price: 450,      yf: "MSFT"  },
  { symbol: "META",  name: "Meta Platforms",           category: "Tokenized Stock",  price: 580,      yf: "META"  },
  { symbol: "AMZN",  name: "Amazon",                   category: "Tokenized Stock",  price: 210,      yf: "AMZN"  },
  { symbol: "GOOGL", name: "Alphabet",                 category: "Tokenized Stock",  price: 185,      yf: "GOOGL" },
  { symbol: "AMD",   name: "AMD",                      category: "Tokenized Stock",  price: 165,      yf: "AMD"   },
  { symbol: "GME",   name: "GameStop",                 category: "Tokenized Stock",  price: 28,       yf: "GME"   },
  { symbol: "COIN",  name: "Coinbase",                 category: "Tokenized Stock",  price: 250,      yf: "COIN"  },
  { symbol: "PLTR",  name: "Palantir",                 category: "Tokenized Stock",  price: 85,       yf: "PLTR"  },
  { symbol: "INTC",  name: "Intel",                    category: "Tokenized Stock",  price: 22,       yf: "INTC"  },
  { symbol: "MU",    name: "Micron Technology",        category: "Tokenized Stock",  price: 115,      yf: "MU"    },
  { symbol: "SPCX",  name: "SpaceX",                   category: "Tokenized Stock",  price: 180,      yf: "SPCX"  },
  { symbol: "SNDK",  name: "Sandisk",                  category: "Tokenized Stock",  price: 55,       yf: "SNDK"  },
  { symbol: "SGOV",  name: "iShares 0-3M Treasury",   category: "Tokenized Stock",  price: 100,      yf: "SGOV"  },
  { symbol: "HOOD",  name: "Robinhood Markets",        category: "Tokenized Stock",  price: 48,       yf: "HOOD"  },
  // ETFs
  { symbol: "SPY",   name: "SPDR S&P 500 ETF",        category: "ETF",              price: 580,      yf: "SPY"   },
  { symbol: "QQQ",   name: "Invesco QQQ Nasdaq ETF",  category: "ETF",              price: 510,      yf: "QQQ"   },
  { symbol: "TLT",   name: "iShares 20+ Yr Treasury", category: "ETF",              price: 88,       yf: "TLT"   },
  { symbol: "GLD",   name: "SPDR Gold Shares",        category: "ETF",              price: 240,      yf: "GLD"   },
  { symbol: "IAU",   name: "iShares Gold Trust",      category: "ETF",              price: 48,       yf: "IAU"   },
  { symbol: "VOO",   name: "Vanguard S&P 500 ETF",   category: "ETF",              price: 530,      yf: "VOO"   },
  { symbol: "USO",   name: "US Oil Fund",             category: "ETF",              price: 78,       yf: "USO"   },
  { symbol: "IWM",   name: "iShares Russell 2000",   category: "ETF",              price: 215,      yf: "IWM"   },
  // Crypto Spot
  { symbol: "BTC",   name: "Bitcoin",                 category: "Crypto",           price: 65000,    yf: null    },
  { symbol: "ETH",   name: "Ethereum",                category: "Crypto",           price: 1880,     yf: null    },
  { symbol: "SOL",   name: "Solana",                  category: "Crypto",           price: 76,       yf: null    },
  { symbol: "BNB",   name: "BNB",                     category: "Crypto",           price: 567,      yf: null    },
  { symbol: "XRP",   name: "XRP",                     category: "Crypto",           price: 0.55,     yf: null    },
  { symbol: "ADA",   name: "Cardano",                 category: "Crypto",           price: 0.45,     yf: null    },
  { symbol: "AVAX",  name: "Avalanche",               category: "Crypto",           price: 28,       yf: null    },
  { symbol: "SUI",   name: "Sui",                     category: "Crypto",           price: 3.2,      yf: null    },
  { symbol: "LINK",  name: "Chainlink",               category: "Crypto",           price: 14,       yf: null    },
  { symbol: "LTC",   name: "Litecoin",                category: "Crypto",           price: 88,       yf: null    },
  // RWAs
  { symbol: "ONDO",  name: "Ondo Finance",            category: "RWA",              price: 1.1,      yf: null    },
  { symbol: "MKR",   name: "Maker",                   category: "RWA",              price: 1500,     yf: null    },
  { symbol: "CFG",   name: "Centrifuge",              category: "RWA",              price: 0.35,     yf: null    },
  { symbol: "BUIDL", name: "BlackRock USD Inst DL",  category: "RWA",              price: 1.0,      yf: null    },
  { symbol: "USDY",  name: "Ondo USD Yield",          category: "RWA",              price: 1.0,      yf: null    },
  // Commodities
  { symbol: "GOLD",  name: "Gold",                    category: "Commodity",        price: 3220,     yf: "GC=F"  },
  { symbol: "SILVER",name: "Silver",                  category: "Commodity",        price: 32,       yf: "SI=F"  },
  { symbol: "OIL",   name: "Crude Oil",               category: "Commodity",        price: 78,       yf: "CL=F"  },
  { symbol: "COPPER",name: "Copper",                  category: "Commodity",        price: 4.5,      yf: "HG=F"  },
];

// ── Price encoding (18 decimals) ──────────────────────────────────────────────

function encodePrice(usd) {
  // Convert dollars to 18-decimal BigInt
  const [intPart, decPart = ""] = usd.toString().split(".");
  const padded = decPart.padEnd(18, "0").slice(0, 18);
  return BigInt(intPart) * 10n ** 18n + BigInt(padded);
}

// ── Deploy helper ──────────────────────────────────────────────────────────────

async function deploy(abi, bytecode, args = []) {
  const hash = await walletClient.deployContract({ abi, bytecode, args, account, chain: undefined });
  console.log("  Deploy tx:", hash);
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  return receipt.contractAddress;
}

async function writeContract(address, abi, functionName, args) {
  const hash = await walletClient.writeContract({
    address, abi, functionName, args, account, chain: undefined,
  });
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  return { hash, receipt };
}

// ── Blockscout verification ───────────────────────────────────────────────────

async function verifyOnBlockscout(address, contractName, source) {
  try {
    const stdJson = {
      language: "Solidity",
      sources: source,
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

// ── Contract source map for verification ─────────────────────────────────────

function buildSources(...filenames) {
  const sources = {};
  for (const f of filenames) {
    sources[f] = { content: readFileSync(f, "utf8") };
  }
  return sources;
}

// ── Main deploy flow ──────────────────────────────────────────────────────────

console.log("\nCommoditex Spot Contracts - Deploy to Robinhood Chain");
console.log("Deployer:", account.address);
const balance = await publicClient.getBalance({ address: account.address });
console.log("Balance:", (Number(balance) / 1e18).toFixed(6), "ETH\n");

// Step 1: Deploy CommoditexAssetFactory (keeper = deployer initially)
console.log("1/3 Deploying CommoditexAssetFactory...");
const factoryAddr = await deploy(FACTORY_ABI, FACTORY_BYT, [account.address]);
console.log("  Factory:", factoryAddr);
console.log("  Blockscout:", `${BLOCKSCOUT}/address/${factoryAddr}\n`);

// Step 2: Deploy CommoditexSpotRouter
console.log("2/3 Deploying CommoditexSpotRouter...");
const WETH = "0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73"; // Robinhood Chain WETH
const routerAddr = await deploy(ROUTER_ABI, ROUTER_BYT, [factoryAddr, USDG, WETH]);
console.log("  Router:", routerAddr);
console.log("  Blockscout:", `${BLOCKSCOUT}/address/${routerAddr}\n`);

// Step 3: Deploy all tokens via factory.deployToken()
console.log(`3/3 Deploying ${ASSETS.length} asset tokens...`);
const deployedAddresses = {};

for (let i = 0; i < ASSETS.length; i++) {
  const a = ASSETS[i];
  process.stdout.write(`  [${String(i + 1).padStart(2)}/${ASSETS.length}] ${a.symbol.padEnd(7)} "${a.name}"... `);
  const { hash } = await writeContract(factoryAddr, FACTORY_ABI, "deployToken", [
    a.symbol, a.name, routerAddr,
  ]);
  // Read deployed token address from mapping
  const tokenAddr = await publicClient.readContract({
    address: factoryAddr,
    abi: FACTORY_ABI,
    functionName: "tokenAddress",
    args: [a.symbol],
  });
  deployedAddresses[a.symbol] = tokenAddr;
  console.log(tokenAddr);
}

// Step 4: Set initial prices in batch (including stablecoin prices for collateral math)
console.log("\nSetting initial oracle prices...");
const symbols = [...ASSETS.map((a) => a.symbol), "ETH", "WETH", "USDE", "USDG"];
const prices  = [...ASSETS.map((a) => encodePrice(a.price)),
  encodePrice(2500),   // ETH  - placeholder; oracle cron will update live
  encodePrice(2500),   // WETH
  encodePrice(1.0),    // USDE stablecoin
  encodePrice(1.0),    // USDG stablecoin
];
const { hash: priceHash } = await writeContract(factoryAddr, FACTORY_ABI, "setPrices", [symbols, prices]);
console.log("  Prices set:", priceHash);

// Step 4b: Whitelist USDE as collateral in SpotRouter
console.log("\nWhitelisting USDE collateral...");
const USDE_ADDR = "0x5d3a1Ff2b6BAb83b63cd9AD0787074081a52ef34";
const { hash: colHash } = await writeContract(routerAddr, ROUTER_ABI, "addCollateral", [USDE_ADDR, "USDE"]);
console.log("  USDE collateral set:", colHash);

// Step 5: Verify contracts on Blockscout
console.log("\nSubmitting verification to Blockscout...");
await verifyOnBlockscout(
  factoryAddr,
  "CommoditexAssetFactory",
  buildSources("CommoditexToken.sol", "CommoditexAssetFactory.sol")
);
await verifyOnBlockscout(
  routerAddr,
  "CommoditexSpotRouter",
  buildSources("CommoditexToken.sol", "CommoditexAssetFactory.sol", "CommoditexSpotRouter.sol")
);

// Step 6: Generate token list JSON (EIP-1577)
const tokenList = {
  name: "Commoditex Token List",
  logoURI: `${BASE_URL}/api/logos/COMMODITEX`,
  timestamp: new Date().toISOString(),
  version: { major: 1, minor: 0, patch: 0 },
  tokens: ASSETS.map((a) => ({
    chainId: 4663,
    address: deployedAddresses[a.symbol],
    symbol:  a.symbol,
    name:    a.name,
    decimals: 18,
    logoURI: `${BASE_URL}/api/logos/${a.symbol}`,
    tags: [a.category.toLowerCase().replace(/\s+/g, "-")],
  })),
};
writeFileSync("commoditex.tokenlist.json", JSON.stringify(tokenList, null, 2));
console.log("\nToken list written: commoditex.tokenlist.json");

// Step 7: Print env vars to set
console.log("\n=============================================================");
console.log("SUCCESS. Set these environment variables in your project:");
console.log("=============================================================");
console.log(`SPOT_FACTORY_ADDRESS=${factoryAddr}`);
console.log(`SPOT_ROUTER_ADDRESS=${routerAddr}`);
console.log("");
console.log("Deployed token addresses:");
for (const [sym, addr] of Object.entries(deployedAddresses)) {
  console.log(`  ${sym.padEnd(7)}: ${addr}`);
}
console.log("=============================================================\n");
