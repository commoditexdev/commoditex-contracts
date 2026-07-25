/**
 * Deploy CommoditexSynth to Robinhood Chain using viem directly.
 * Run: ALCHEMY_RPC_URL=... DEPLOYER_PRIVATE_KEY=0x... node deploy.mjs
 */
import { createPublicClient, createWalletClient, http, defineChain } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { readFileSync } from "fs";

const chain = defineChain({
  id: 4663,
  name: "Robinhood Chain",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: [process.env.ALCHEMY_RPC_URL ?? "https://rpc.mainnet.chain.robinhood.com"] } },
  blockExplorers: { default: { name: "Blockscout", url: "https://robinhoodchain.blockscout.com" } },
});

const USDG = "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168";

const pk = process.env.DEPLOYER_PRIVATE_KEY;
if (!pk) { console.error("DEPLOYER_PRIVATE_KEY required"); process.exit(1); }

const account = privateKeyToAccount(pk);
const publicClient = createPublicClient({ chain, transport: http() });
const walletClient = createWalletClient({ account, chain, transport: http() });

const bytecode = "0x" + readFileSync("CommoditexSynth.bytecode.txt", "utf8").trim();
const abi = JSON.parse(readFileSync("CommoditexSynth.abi.json", "utf8"));

console.log("Deploying from:", account.address);
console.log("Balance:", (await publicClient.getBalance({ address: account.address })).toString());

// Encode constructor args: address _usdg, address _oracle
const { encodeAbiParameters, parseAbiParameters } = await import("viem");
const constructorArgs = encodeAbiParameters(
  parseAbiParameters("address, address"),
  [USDG, account.address]
);

const hash = await walletClient.deployContract({
  abi,
  bytecode,
  args: [USDG, account.address],
});

console.log("Deploy tx:", hash);
const receipt = await publicClient.waitForTransactionReceipt({ hash });
const contractAddress = receipt.contractAddress;
console.log("\n✅ CommoditexSynth deployed at:", contractAddress);
console.log("Blockscout:", `https://robinhoodchain.blockscout.com/address/${contractAddress}`);
console.log("\nAdd to .env:\nSYNTH_CONTRACT_ADDRESS=" + contractAddress);

// Set initial prices
const assets = ["BTC","ETH","SOL","BNB","AVAX","LINK","DOGE","MATIC","GOLD","SILVER","OIL","COPPER","ONDO","BUIDL","MKR","CFG"];
const prices = [64000n,1880n,76n,567n,6n,8n,0n,0n,3220n,32n,78n,4n,1n,1n,1500n,1n].map((p,i) => {
  // Use market-appropriate precision: 18 decimals
  return ["DOGE","MATIC"].includes(assets[i]) ? p * 10n**15n : // sub-$1 tokens
         ["ONDO","BUIDL","CFG"].includes(assets[i]) ? p * 10n**18n :
         p * 10n**18n;
});

const updateHash = await walletClient.writeContract({
  address: contractAddress,
  abi,
  functionName: "updatePrices",
  args: [assets, prices],
});
console.log("Initial prices set:", updateHash);
