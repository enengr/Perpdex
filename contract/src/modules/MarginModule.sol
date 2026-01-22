// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {SignedMath} from "@openzeppelin/contracts/utils/math/SignedMath.sol";
import "./LiquidationModule.sol";

/// @notice Margin accounting (deposit/withdraw) plus margin checks.
/// @dev Day 1: 保证金模块
abstract contract MarginModule is LiquidationModule {

    /// @notice 存入保证金
    function deposit() external payable virtual nonReentrant {
        accounts[msg.sender].margin += msg.value;
        emit MarginDeposited(msg.sender, msg.value);
    }

    /// @notice 提取保证金
    /// @param amount 提取金额
    function withdraw(uint256 amount) external virtual nonReentrant {
        require(amount > 0, "amount=0");
        _applyFunding(msg.sender);
        require(accounts[msg.sender].margin >= amount, "not enough margin");
        _ensureWithdrawKeepsMaintenance(msg.sender, amount);

        accounts[msg.sender].margin -= amount;
        (bool ok, ) = msg.sender.call{value: amount}("");
        require(ok, "withdraw failed");

        emit MarginWithdrawn(msg.sender, amount);
    }

    /// @notice 计算持仓所需保证金
    function _calculatePositionMargin(int256 size) internal view returns (uint256) {
        if (size == 0 || markPrice == 0) return 0;
        uint256 absSize = SignedMath.abs(size);
        uint256 notional = (absSize * markPrice) / 1e18;
        return (notional * initialMarginBps) / 10_000;
    }

    /// @notice 获取用户待成交订单数量
    function _countPendingOrders(address trader) internal view returns (uint256) {
        return pendingOrderCount[trader];
    }

    /// @notice 计算最坏情况下所需保证金
    /// @dev 假设所有挂单都成交后的保证金需求
    function _calculateWorstCaseMargin(address trader) internal view returns (uint256) {
        Position memory pos = accounts[trader].position;

        uint256 buyOrderMargin = 0;
        uint256 id = bestBuyId;
        while (id != 0) {
            if (orders[id].trader == trader) {
                uint256 orderVal = (orders[id].price * orders[id].amount) / 1e18;
                buyOrderMargin += (orderVal * initialMarginBps) / 10_000;
            }
            id = orders[id].next;
        }

        uint256 sellOrderMargin = 0;
        id = bestSellId;
        while (id != 0) {
            if (orders[id].trader == trader) {
                uint256 orderVal = (orders[id].price * orders[id].amount) / 1e18;
                sellOrderMargin += (orderVal * initialMarginBps) / 10_000;
            }
            id = orders[id].next;
        }

        uint256 positionMargin = _calculatePositionMargin(pos.size);
        return positionMargin + (buyOrderMargin > sellOrderMargin ? buyOrderMargin : sellOrderMargin);
    }

    /// @notice 检查用户是否有足够保证金
    function _checkWorstCaseMargin(address trader) internal view {
        uint256 required = _calculateWorstCaseMargin(trader);
        Position memory p = accounts[trader].position;

        int256 marginBalance = int256(accounts[trader].margin) + _unrealizedPnl(p);
        require(marginBalance >= int256(required), "insufficient margin");
    }

    /// @notice 确保提现后仍满足维持保证金要求
    function _ensureWithdrawKeepsMaintenance(address trader, uint256 amount) internal view {
        Position memory p = accounts[trader].position;

        if (p.size == 0) return;

        int256 marginAfter = int256(accounts[trader].margin) - int256(amount);
        int256 unrealized = _unrealizedPnl(p);
        int256 marginBalance = marginAfter + unrealized;

        uint256 priceBase = markPrice == 0 ? p.entryPrice : markPrice;
        uint256 positionValue = SignedMath.abs(int256(priceBase) * p.size) / 1e18;
        uint256 maintenance = (positionValue * maintenanceMarginBps) / 10_000;

        require(marginBalance >= int256(maintenance), "withdraw would trigger liquidation");
    }
}
