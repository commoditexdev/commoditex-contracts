/**
 * Compile all Commoditex contracts using solc standard JSON input.
 * Outputs ABI + bytecode files for each contract.
 * Run: node compile.mjs
 */
import { readFileSync, writeFileSync } from "fs";
import { createRequire } from "module";

const require = createRequire(import.meta.url);
const solc    = require("solc");

const CONTRACTS = [
  "CommoditexToken",
  "CommoditexAssetFactory",
  "CommoditexSpotRouter",
  "CommoditexPerpOracle",
  "CommoditexPerpNFT",
  "CommoditexPerpRouter",
];

// Build source map for all contracts
const sources = {};
for (const name of CONTRACTS) {
  sources[`${name}.sol`] = { content: readFileSync(`${name}.sol`, "utf8") };
}

const input = {
  language: "Solidity",
  sources,
  settings: {
    optimizer: { enabled: true, runs: 200 },
    outputSelection: {
      "*": { "*": ["abi", "evm.bytecode.object"] },
    },
  },
};

console.log("Compiling all Commoditex contracts...");
const output = JSON.parse(solc.compile(JSON.stringify(input)));

// Print errors / warnings
if (output.errors) {
  for (const err of output.errors) {
    if (err.severity === "error") {
      console.error("ERROR:", err.formattedMessage);
    } else {
      console.warn("WARN:", err.formattedMessage);
    }
  }
  const hasErrors = output.errors.some((e) => e.severity === "error");
  if (hasErrors) { console.error("Compilation failed."); process.exit(1); }
}

// Write ABI + bytecode for each contract
let compiled = 0;
for (const [file, fileOutput] of Object.entries(output.contracts ?? {})) {
  for (const [contractName, contractOutput] of Object.entries(fileOutput)) {
    const abi      = contractOutput.abi;
    const bytecode = contractOutput.evm?.bytecode?.object ?? "";

    if (!bytecode) {
      console.warn(`  Skipping ${contractName} (no bytecode - might be interface)`);
      continue;
    }

    writeFileSync(`${contractName}.abi.json`,     JSON.stringify(abi, null, 2));
    writeFileSync(`${contractName}.bytecode.txt`, bytecode);
    console.log(`  ✅ ${contractName}: ${abi.length} ABI entries, ${bytecode.length / 2} bytes`);
    compiled++;
  }
}

console.log(`\nDone. Compiled ${compiled} contracts.`);
