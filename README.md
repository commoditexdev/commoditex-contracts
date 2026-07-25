# Commoditex Contracts

Solidity smart contracts for on-chain trading on Robinhood Chain. Includes synthetic asset engine, spot token factory (44 assets), and perpetual position manager.

Compiled with `solc` npm package directly - no Hardhat required.

## Stack

- Solidity 0.8.24
- solc (npm) for compilation
- Viem for deployment scripts
- Robinhood Chain (EVM, Chain ID 1996)

## Contracts

| Contract | Description |
|----------|-------------|
| `CommoditexSynth.sol` | Core synthetic asset trading engine |
| `CommoditexAssetFactory.sol` | Factory that deploys 44 individual spot token contracts |
| `CommoditexToken.sol` | ERC-20 token for each tradeable asset |
| `CommoditexSpotRouter.sol` | Buy/sell routing for spot assets |
| `CommoditexPerpRouter.sol` | Open/close perpetual positions |
| `CommoditexPerpNFT.sol` | NFT representing open perp positions |
| `CommoditexPerpOracle.sol` | Price oracle for perpetual mark prices |

## Getting Started

```bash
npm install
cp .env.example .env
# fill in DEPLOYER_PRIVATE_KEY and ALCHEMY_RPC_URL

# Compile all contracts
npm run compile

# Deploy core contracts
npm run deploy

# Deploy all 44 spot tokens
npm run deploy:spot

# Deploy perp contracts
npm run deploy:perp

# Verify deployment
npm run verify
```

## Deploy Order

1. `npm run compile` - compile all Solidity to ABI + bytecode
2. `npm run deploy` - deploy CommoditexSynth + SpotRouter + PerpRouter + PerpNFT + PerpOracle
3. Copy deployed addresses to `.env`
4. `npm run deploy:spot` - deploy all 44 spot token contracts via AssetFactory
5. `npm run e2e` - run end-to-end roundtrip test

## Token List

See `commoditex.tokenlist.json` for the full list of deployed assets.

## Network

| Property | Value |
|----------|-------|
| Name | Robinhood Chain |
| Chain ID | 1996 |
| RPC | Via Alchemy |
| Explorer | Blockscout |
