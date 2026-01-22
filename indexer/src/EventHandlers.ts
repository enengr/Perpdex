import { Candle, Exchange, FundingEvent, LatestCandle, Liquidation, MarginEvent, Order, Position, Trade } from "../generated";

/**
 * Event Handlers - 脚手架版本
 * 
 * 这个文件定义了如何处理合约事件并存储到数据库。
 * 
 * TODO: 学生需要实现以下事件处理器：
 * 1. MarginDeposited - 记录充值事件
 * 2. MarginWithdrawn - 记录提现事件
 * 3. OrderPlaced - 记录新订单
 * 4. OrderRemoved - 更新订单状态 (取消/成交)
 * 5. TradeExecuted - 记录成交，更新订单、K线、持仓
 */

/**
 * 处理保证金充值事件
 * 
 * TODO: 实现此处理器
 * 步骤:
 * 1. 从 event.params 获取 trader 和 amount
 * 2. 创建 MarginEvent 实体
 * 3. 使用 context.MarginEvent.set 保存
 */
Exchange.MarginDeposited.handler(async ({ event, context }) => {
    const entity: MarginEvent = {
        id: `${event.transaction.hash}-${event.logIndex}`,
        trader: event.params.trader,
        amount: event.params.amount,
        eventType: 'DEPOSIT',
        timestamp: event.block.timestamp,
        txHash: event.transaction.hash,
    };
    context.MarginEvent.set(entity);
});

/**
 * 处理保证金提现事件
 */
Exchange.MarginWithdrawn.handler(async ({ event, context }) => {
    const entity: MarginEvent = {
        id: `${event.transaction.hash}-${event.logIndex}`,
        trader: event.params.trader,
        amount: event.params.amount,
        eventType: 'WITHDRAW',
        timestamp: event.block.timestamp,
        txHash: event.transaction.hash,
    };
    context.MarginEvent.set(entity);
});

/**
 * 处理订单下单事件
 */
Exchange.OrderPlaced.handler(async ({ event, context }) => {
    const order: Order = {
        id: event.params.id.toString(),
        trader: event.params.trader,
        isBuy: event.params.isBuy,
        price: event.params.price,
        initialAmount: event.params.amount,
        amount: event.params.amount,
        status: 'OPEN',
        timestamp: event.block.timestamp,
    };
    context.Order.set(order);
});

/**
 * 处理订单撤销事件
 */
Exchange.OrderRemoved.handler(async ({ event, context }) => {
    const order = await context.Order.get(event.params.id.toString());
    if (order) {
        context.Order.set({
            ...order,
            status: order.amount === 0n ? 'FILLED' : 'CANCELLED',
            amount: 0n,
        });
    }
});

/**
 * 处理成交事件
 */
Exchange.TradeExecuted.handler(async ({ event, context }) => {
    const trade: Trade = {
        id: `${event.transaction.hash}-${event.logIndex}`,
        buyer: event.params.buyer,
        seller: event.params.seller,
        price: event.params.price,
        amount: event.params.amount,
        timestamp: event.block.timestamp,
        txHash: event.transaction.hash,
        buyOrderId: event.params.buyOrderId,
        sellOrderId: event.params.sellOrderId,
    };
    context.Trade.set(trade);

    const resolution = '1m';
    const timestamp = event.block.timestamp - (event.block.timestamp % 60);
    const candleId = `${resolution}-${timestamp}`;

    const existingCandle = await context.Candle.get(candleId);

    if (!existingCandle) {
        const latestCandleState = await context.LatestCandle.get('1');
        const openPrice = latestCandleState ? latestCandleState.closePrice : event.params.price;

        const candle: Candle = {
            id: candleId,
            resolution,
            timestamp,
            openPrice: openPrice,
            highPrice: event.params.price > openPrice ? event.params.price : openPrice,
            lowPrice: event.params.price < openPrice ? event.params.price : openPrice,
            closePrice: event.params.price,
            volume: event.params.amount,
        };
        context.Candle.set(candle);
    } else {
        const newHigh = event.params.price > existingCandle.highPrice ? event.params.price : existingCandle.highPrice;
        const newLow = event.params.price < existingCandle.lowPrice ? event.params.price : existingCandle.lowPrice;

        context.Candle.set({
            ...existingCandle,
            highPrice: newHigh,
            lowPrice: newLow,
            closePrice: event.params.price,
            volume: existingCandle.volume + event.params.amount,
        });
    }

    const latestCandle: LatestCandle = {
        id: '1',
        closePrice: event.params.price,
        timestamp: event.block.timestamp,
    };
    context.LatestCandle.set(latestCandle);

    const buyOrder = await context.Order.get(event.params.buyOrderId.toString());
    if (buyOrder) {
        const newAmount = buyOrder.amount - event.params.amount;
        context.Order.set({
            ...buyOrder,
            amount: newAmount,
            status: newAmount === 0n ? 'FILLED' : 'OPEN',
        });
    }

    const sellOrder = await context.Order.get(event.params.sellOrderId.toString());
    if (sellOrder) {
        const newAmount = sellOrder.amount - event.params.amount;
        context.Order.set({
            ...sellOrder,
            amount: newAmount,
            status: newAmount === 0n ? 'FILLED' : 'OPEN',
        });
    }
});

/**
 * 处理持仓更新事件
 */
Exchange.PositionUpdated.handler(async ({ event, context }) => {
    const position: Position = {
        id: event.params.trader,
        trader: event.params.trader,
        size: event.params.size,
        entryPrice: event.params.entryPrice,
    };
    context.Position.set(position);
});

/**
 * 处理全局资金费更新事件
 */
Exchange.FundingUpdated.handler(async ({ event, context }) => {
    const entity: FundingEvent = {
        id: `${event.transaction.hash}-${event.logIndex}`,
        eventType: 'GLOBAL_UPDATE',
        trader: undefined,
        cumulativeRate: event.params.cumulativeFundingRate,
        payment: undefined,
        timestamp: event.block.timestamp,
    };
    context.FundingEvent.set(entity);
});

/**
 * 处理用户资金费结算事件
 */
Exchange.FundingPaid.handler(async ({ event, context }) => {
    const entity: FundingEvent = {
        id: `${event.transaction.hash}-${event.logIndex}`,
        eventType: 'USER_PAID',
        trader: event.params.trader,
        cumulativeRate: undefined,
        payment: event.params.amount,
        timestamp: event.block.timestamp,
    };
    context.FundingEvent.set(entity);
});

/**
 * 处理清算事件
 */
Exchange.Liquidated.handler(async ({ event, context }) => {
    const entity: Liquidation = {
        id: `${event.transaction.hash}-${event.logIndex}`,
        trader: event.params.trader,
        liquidator: event.params.liquidator,
        amount: event.params.amount,
        fee: event.params.reward,
        price: event.params.price,
        timestamp: event.block.timestamp,
        txHash: event.transaction.hash,
    };
    context.Liquidation.set(entity);

    const position = await context.Position.get(event.params.trader);
    if (position) {
        const newSize = position.size > 0n
            ? position.size - event.params.amount
            : position.size + event.params.amount;
        context.Position.set({
            ...position,
            size: newSize,
        });
    }
});
