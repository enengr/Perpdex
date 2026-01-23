// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {SignedMath} from "@openzeppelin/contracts/utils/math/SignedMath.sol";
import "./PricingModule.sol";

/// @notice Liquidation checks and execution.
/// @dev Day 6: 清算模块
abstract contract LiquidationModule is PricingModule {

    /// @notice 检查用户是否可被清算
    /// @param trader 用户地址
    /// @return 是否可清算
    function canLiquidate(address trader) public view virtual returns (bool) {
        Position memory p = accounts[trader].position;
        if (p.size == 0) return false;

        uint256 mark = _calculateMarkPrice(indexPrice);
        uint256 priceForPnl = mark == 0 ? p.entryPrice : mark;
        int256 priceDiff = int256(priceForPnl) - int256(p.entryPrice);
        if (p.size < 0) priceDiff = -priceDiff;
        int256 unrealized = (priceDiff * int256(SignedMath.abs(p.size))) / int256(SCALE);

        int256 marginBalance = int256(accounts[trader].margin) + unrealized;

        uint256 priceBase = mark == 0 ? p.entryPrice : mark;
        uint256 positionValue = SignedMath.abs(int256(priceBase) * p.size) / SCALE;
        uint256 maintenance = (positionValue * (maintenanceMarginBps + liquidationFeeBps)) / 10_000;

        return marginBalance < int256(maintenance);
    }

    /// @notice 清算用户 (在 OrderBookModule 中实现具体逻辑)
    function liquidate(address trader) external virtual nonReentrant {
        // 将在 OrderBookModule 中实现
    }

    /// @notice 清除用户所有挂单
    /// @param trader 用户地址
    function _clearTraderOrders(address trader) internal returns (uint256 freedLocked) {
        bestBuyId = _removeOrders(bestBuyId, trader);
        bestSellId = _removeOrders(bestSellId, trader);
        return 0;
    }

    /// @notice 从链表中删除指定用户的订单
    function _removeOrders(uint256 headId, address trader) internal returns (uint256 newHead) {
        newHead = headId;
        uint256 current = headId;
        uint256 prev = 0;

        while (current != 0) {
            Order storage o = orders[current];
            uint256 next = o.next;
            if (o.trader == trader) {
                if (prev == 0) {
                    newHead = next;
                } else {
                    orders[prev].next = next;
                }
                pendingOrderCount[trader]--;
                emit OrderRemoved(o.id);
                delete orders[current];
                current = next;
                continue;
            }
            prev = current;
            current = next;
        }
    }

    uint256 constant SCALE = 1e18;

    /// @notice 执行交易
    /// @dev Day 3: 撮合成交核心函数
    function _executeTrade(
        address buyer,
        address seller,
        uint256 buyOrderId,
        uint256 sellOrderId,
        uint256 amount,
        uint256 price
    ) internal virtual {
        // 1. 资金费结算（Day 5 实现，先占位）
        // 在仓位变动前，必须先结算之前的资金费，否则杠杆计算会错
        _applyFunding(buyer);
        _applyFunding(seller);

        // 2. 更新买卖双方持仓
        // 买方：isBuy = true
        _updatePosition(buyer, true, amount, price);
        // 卖方：isBuy = false
        _updatePosition(seller, false, amount, price);

        // 3. 发出事件供 Indexer 索引
        emit TradeExecuted(buyOrderId, sellOrderId, price, amount, buyer, seller);
    }

    /// @notice 更新用户持仓
    /// @dev Day 3: 持仓更新核心函数
    function _updatePosition(address trader, bool isBuy, uint256 amount, uint256 tradePrice) internal virtual {
        Position storage p = accounts[trader].position;
        int256 signed = isBuy ? int256(amount) : -int256(amount);
        uint256 existingAbs = SignedMath.abs(p.size);

        // 1) 同方向加仓
        if (p.size == 0 || (p.size > 0) == (signed > 0)) {
            uint256 newAbs = existingAbs + amount;
            uint256 weighted = existingAbs == 0
                ? tradePrice
                : (existingAbs * p.entryPrice + amount * tradePrice) / newAbs;
            p.entryPrice = weighted;
            p.size += signed;
            emit PositionUpdated(trader, p.size, p.entryPrice);
            return;
        }

        // 2) 反向减仓/平仓
        uint256 closing = amount < existingAbs ? amount : existingAbs;
        int256 pnlPerUnit =
            p.size > 0 ? int256(tradePrice) - int256(p.entryPrice) : int256(p.entryPrice) - int256(tradePrice);
        int256 pnl = (pnlPerUnit * int256(closing)) / int256(SCALE);

        // 盈亏直接结算到 margin（无需单独记录 realizedPnl）
        int256 newMargin = int256(accounts[trader].margin) + pnl;
        if (newMargin < 0) accounts[trader].margin = 0;
        else accounts[trader].margin = uint256(newMargin);

        // 3) 是否反向开仓
        uint256 remaining = amount - closing;
        if (closing == existingAbs) {
            if (remaining == 0) {
                p.size = 0;
                p.entryPrice = tradePrice;
            } else {
                p.size = signed > 0 ? int256(remaining) : -int256(remaining);
                p.entryPrice = tradePrice;
            }
        } else {
            if (p.size > 0) p.size -= int256(closing);
            else p.size += int256(closing);
        }

        // Day 5 优化：发出 PositionUpdated 事件，简化 Indexer 逻辑
        emit PositionUpdated(trader, p.size, p.entryPrice);
    }

}
