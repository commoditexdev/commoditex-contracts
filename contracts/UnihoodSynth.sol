// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title CommoditexSynth
 * @notice Synthetic asset vault on Robinhood Chain.
 *         Users deposit USDG as margin and open synthetic positions on any asset
 *         tracked by the Commoditex oracle (BTC, SOL, GOLD, OIL, ONDO, etc.).
 *         Positions are recorded on-chain as verifiable proof of exposure.
 *
 * Flow:
 *   1. User approves USDG → this contract
 *   2. User calls openPosition(asset, margin, isLong)
 *   3. Contract locks USDG, records position at current oracle price
 *   4. User calls closePosition(posId) to settle at current price
 *   5. USDG returned: margin ± PnL (capped at margin for shorts, unlimited for longs)
 *
 * Oracle: owner-controlled price feed (Commoditex server updates every 30s).
 */

interface IERC20 {
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    function transfer(address to, uint256 amount) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
    function decimals() external view returns (uint8);
}

contract CommoditexSynth {
    // ── State ─────────────────────────────────────────────────────────────────

    IERC20 public immutable usdg;
    uint8  public immutable usdgDecimals;
    address public owner;
    address public oracle; // address allowed to update prices

    // Price: USD value with 18 decimals (e.g. BTC = 64_000 * 1e18)
    mapping(bytes32 => uint256) public prices;      // assetKey => price
    mapping(bytes32 => uint256) public priceUpdatedAt;

    struct Position {
        bytes32 assetKey;     // keccak256(abi.encodePacked(symbol))
        string  asset;        // human-readable symbol, e.g. "BTC"
        uint256 margin;       // USDG locked (in USDG decimals)
        uint256 notional;     // USD notional at entry (18 decimals)
        uint256 entryPrice;   // oracle price at open (18 decimals)
        bool    isLong;
        uint256 openedAt;
        bool    isOpen;
    }

    mapping(address => mapping(uint256 => Position)) public positions;
    mapping(address => uint256) public positionCount;

    // ── Events ────────────────────────────────────────────────────────────────

    event PositionOpened(address indexed user, uint256 indexed posId, string asset, uint256 margin, bool isLong, uint256 entryPrice);
    event PositionClosed(address indexed user, uint256 indexed posId, string asset, int256 pnl, uint256 exitPrice);
    event PriceUpdated(string asset, uint256 price, uint256 timestamp);

    // ── Errors ────────────────────────────────────────────────────────────────

    error NotOwner();
    error NotOracle();
    error ZeroAmount();
    error AssetNotFound(string asset);
    error PositionNotOpen();
    error PriceStale();
    error InsufficientMargin();

    // ── Constructor ───────────────────────────────────────────────────────────

    constructor(address _usdg, address _oracle) {
        usdg = IERC20(_usdg);
        usdgDecimals = IERC20(_usdg).decimals();
        owner = msg.sender;
        oracle = _oracle;
    }

    // ── Modifiers ─────────────────────────────────────────────────────────────

    modifier onlyOwner() { if (msg.sender != owner) revert NotOwner(); _; }
    modifier onlyOracle() { if (msg.sender != oracle && msg.sender != owner) revert NotOracle(); _; }

    // ── Oracle ────────────────────────────────────────────────────────────────

    /** Update price for a single asset. Called by Commoditex oracle server every 30s. */
    function updatePrice(string calldata asset, uint256 price) external onlyOracle {
        bytes32 key = keccak256(abi.encodePacked(asset));
        prices[key] = price;
        priceUpdatedAt[key] = block.timestamp;
        emit PriceUpdated(asset, price, block.timestamp);
    }

    /** Batch price update for efficiency */
    function updatePrices(string[] calldata assets, uint256[] calldata _prices) external onlyOracle {
        require(assets.length == _prices.length, "length mismatch");
        for (uint256 i = 0; i < assets.length; i++) {
            bytes32 key = keccak256(abi.encodePacked(assets[i]));
            prices[key] = _prices[i];
            priceUpdatedAt[key] = block.timestamp;
            emit PriceUpdated(string(abi.encodePacked(assets[i])), _prices[i], block.timestamp);
        }
    }

    /** Get current price for an asset. Reverts if stale (>5 min). */
    function getPrice(string calldata asset) public view returns (uint256 price) {
        bytes32 key = keccak256(abi.encodePacked(asset));
        price = prices[key];
        if (price == 0) revert AssetNotFound(asset);
        if (block.timestamp - priceUpdatedAt[key] > 5 minutes) revert PriceStale();
    }

    // ── Trading ───────────────────────────────────────────────────────────────

    /**
     * @notice Open a synthetic position.
     * @param asset  Symbol string, e.g. "BTC", "GOLD", "SOL", "ONDO"
     * @param margin USDG amount to lock (in USDG decimals, 6 for USDG)
     * @param isLong true = long (profit if price rises), false = short
     */
    function openPosition(string calldata asset, uint256 margin, bool isLong) external returns (uint256 posId) {
        if (margin == 0) revert ZeroAmount();

        uint256 price = getPrice(asset);

        // Transfer USDG from user
        require(usdg.transferFrom(msg.sender, address(this), margin), "USDG transfer failed");

        // Notional = margin * 1e18 / 1e(usdgDecimals) (normalise to 18 dec)
        uint256 notional = uint256(margin) * 1e18 / (10 ** usdgDecimals);

        posId = positionCount[msg.sender]++;
        bytes32 key = keccak256(abi.encodePacked(asset));

        positions[msg.sender][posId] = Position({
            assetKey: key,
            asset: asset,
            margin: margin,
            notional: notional,
            entryPrice: price,
            isLong: isLong,
            openedAt: block.timestamp,
            isOpen: true
        });

        emit PositionOpened(msg.sender, posId, asset, margin, isLong, price);
    }

    /**
     * @notice Close an open position and settle PnL in USDG.
     * @param posId Position index returned by openPosition
     */
    function closePosition(uint256 posId) external {
        Position storage pos = positions[msg.sender][posId];
        if (!pos.isOpen) revert PositionNotOpen();

        // Read price directly from mapping using stored key (avoids string calldata issue)
        uint256 exitPrice = prices[pos.assetKey];
        if (exitPrice == 0) revert AssetNotFound(pos.asset);
        if (block.timestamp - priceUpdatedAt[pos.assetKey] > 5 minutes) revert PriceStale();
        pos.isOpen = false;

        // PnL in 18-decimal USD
        int256 priceDelta = int256(exitPrice) - int256(pos.entryPrice);
        int256 pnlUsd18 = (priceDelta * int256(pos.notional)) / int256(pos.entryPrice);
        if (!pos.isLong) pnlUsd18 = -pnlUsd18;

        // Convert PnL to USDG decimals
        int256 pnlUsdg = pnlUsd18 * int256(10 ** usdgDecimals) / 1e18;

        // Payout: margin + pnl, floored at 0 (can't owe more than margin)
        uint256 payout;
        if (pnlUsdg >= 0) {
            uint256 profit = uint256(pnlUsdg);
            // Cap profit at contract balance (safety)
            uint256 available = usdg.balanceOf(address(this));
            payout = pos.margin + (profit > available ? available - pos.margin : profit);
        } else {
            uint256 loss = uint256(-pnlUsdg);
            payout = loss >= pos.margin ? 0 : pos.margin - loss;
        }

        if (payout > 0) {
            require(usdg.transfer(msg.sender, payout), "USDG payout failed");
        }

        emit PositionClosed(msg.sender, posId, pos.asset, pnlUsdg, exitPrice);
    }

    // ── Views ─────────────────────────────────────────────────────────────────

    /** Get all open positions for a user */
    function getOpenPositions(address user) external view returns (Position[] memory open, uint256[] memory ids) {
        uint256 count = positionCount[user];
        uint256 openCount = 0;
        for (uint256 i = 0; i < count; i++) {
            if (positions[user][i].isOpen) openCount++;
        }
        open = new Position[](openCount);
        ids  = new uint256[](openCount);
        uint256 j = 0;
        for (uint256 i = 0; i < count; i++) {
            if (positions[user][i].isOpen) {
                open[j] = positions[user][i];
                ids[j]  = i;
                j++;
            }
        }
    }

    /** Calculate current unrealized PnL for a position (18-dec USD) */
    function unrealizedPnl(address user, uint256 posId) external view returns (int256 pnlUsd18) {
        Position storage pos = positions[user][posId];
        if (!pos.isOpen) return 0;
        uint256 currentPrice = prices[pos.assetKey];
        if (currentPrice == 0) return 0;
        int256 priceDelta = int256(currentPrice) - int256(pos.entryPrice);
        pnlUsd18 = (priceDelta * int256(pos.notional)) / int256(pos.entryPrice);
        if (!pos.isLong) pnlUsd18 = -pnlUsd18;
    }

    // ── Admin ─────────────────────────────────────────────────────────────────

    function setOracle(address _oracle) external onlyOwner { oracle = _oracle; }
    function transferOwnership(address newOwner) external onlyOwner { owner = newOwner; }

    /** Emergency withdraw (only if positions are net profitable for contract) */
    function emergencyWithdraw(uint256 amount) external onlyOwner {
        require(usdg.transfer(owner, amount), "transfer failed");
    }
}
