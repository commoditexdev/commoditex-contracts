import { createPublicClient, http, defineChain, formatUnits } from "viem";
import { privateKeyToAccount } from "viem/accounts";

const chain = defineChain({ id: 4663, name: "Robinhood Chain", nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 }, rpcUrls: { default: { http: ["https://rpc.mainnet.chain.robinhood.com"] } } });
const pub = createPublicClient({ chain, transport: http("https://rpc.mainnet.chain.robinhood.com", { timeout: 15000 }) });
const rawKey = process.env.DEPLOYER_PRIVATE_KEY.startsWith("0x") ? process.env.DEPLOYER_PRIVATE_KEY : `0x${process.env.DEPLOYER_PRIVATE_KEY}`;
const account = privateKeyToAccount(rawKey);

const ERC20_ABI = [{ name: "balanceOf", type: "function", stateMutability: "view", inputs: [{ name: "account", type: "address" }], outputs: [{ type: "uint256" }] }];
const FACTORY_ABI = [{ name: "tokenAddress", type: "function", stateMutability: "view", inputs: [{ name: "", type: "string" }], outputs: [{ type: "address" }] }];

const SYMBOLS = ["BTC","SOL","NVDA","TSLA","ONDO","BUIDL","SPY","QQQ","GOLD","SILVER"];
const FACTORY = process.env.SPOT_FACTORY_ADDRESS;

const eth = await pub.getBalance({ address: account.address });
const nonce = await pub.getTransactionCount({ address: account.address });
console.log(`Wallet: ${account.address}`);
console.log(`ETH balance: ${formatUnits(eth, 18)} ETH`);
console.log(`Current nonce: ${nonce}\n`);

for (const sym of SYMBOLS) {
  const addr = await pub.readContract({ address: FACTORY, abi: FACTORY_ABI, functionName: "tokenAddress", args: [sym] });
  const bal = await pub.readContract({ address: addr, abi: ERC20_ABI, functionName: "balanceOf", args: [account.address] });
  if (BigInt(bal) > 0n) console.log(`${sym.padEnd(8)} ${formatUnits(BigInt(bal), 18)} (addr: ${addr})`);
  else console.log(`${sym.padEnd(8)} 0`);
}
