#!/usr/bin/env bash
set -euo pipefail

RPC_URL="http://localhost:8545"
SOFT_FAILS="${SOFT_FAILS:-1}"
ENV_FILE="$(dirname "${BASH_SOURCE[0]}")/../frontend/.env.local"
if [ -f "$ENV_FILE" ]; then
    EXCHANGE=$(grep VITE_EXCHANGE_ADDRESS "$ENV_FILE" | cut -d '=' -f2)
    echo "Using Exchange Address: $EXCHANGE"
else
    echo "Error: frontend/.env.local not found. Cannot determine Exchange address."
    exit 1
fi

ALICE_PK="0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80"
BOB_PK="0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d"
CAROL_PK="0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a"
DEPTH_BID_PK="0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6"
DEPTH_ASK_PK="0x47e179ec197488593b187f80a00eb0da91f1b9d0b13f8733639f53b7f3d2b4c2"
CANDLE_BUY_PK="0x1000000000000000000000000000000000000000000000000000000000000001"
CANDLE_SELL_PK="0x2000000000000000000000000000000000000000000000000000000000000002"
LIQ_LONG_PK="0x3000000000000000000000000000000000000000000000000000000000000003"
LIQ_SHORT_PK="0x4000000000000000000000000000000000000000000000000000000000000004"
LIQ_LONG_2_PK="0x5000000000000000000000000000000000000000000000000000000000000005"
LIQ_LONG_3_PK="0x6000000000000000000000000000000000000000000000000000000000000006"
LIQ_SHORT_2_PK="0x7000000000000000000000000000000000000000000000000000000000000007"
LIQ_SHORT_3_PK="0x8000000000000000000000000000000000000000000000000000000000000008"

ALICE_ADDR=$(cast wallet address --private-key "$ALICE_PK")
BOB_ADDR=$(cast wallet address --private-key "$BOB_PK")
CAROL_ADDR=$(cast wallet address --private-key "$CAROL_PK")
DEPTH_BID_ADDR=$(cast wallet address --private-key "$DEPTH_BID_PK")
DEPTH_ASK_ADDR=$(cast wallet address --private-key "$DEPTH_ASK_PK")
CANDLE_BUY_ADDR=$(cast wallet address --private-key "$CANDLE_BUY_PK")
CANDLE_SELL_ADDR=$(cast wallet address --private-key "$CANDLE_SELL_PK")
LIQ_LONG_ADDR=$(cast wallet address --private-key "$LIQ_LONG_PK")
LIQ_SHORT_ADDR=$(cast wallet address --private-key "$LIQ_SHORT_PK")
LIQ_LONG_2_ADDR=$(cast wallet address --private-key "$LIQ_LONG_2_PK")
LIQ_LONG_3_ADDR=$(cast wallet address --private-key "$LIQ_LONG_3_PK")
LIQ_SHORT_2_ADDR=$(cast wallet address --private-key "$LIQ_SHORT_2_PK")
LIQ_SHORT_3_ADDR=$(cast wallet address --private-key "$LIQ_SHORT_3_PK")

prefund_account() {
    local addr=$1
    local balance_hex="0x21e19e0c9bab2400000"
    if ! cast rpc --rpc-url $RPC_URL anvil_setBalance "$addr" "$balance_hex" >/dev/null 2>&1; then
        echo "Error: anvil_setBalance failed for $addr. Ensure anvil is running at $RPC_URL."
        exit 1
    fi
}

echo "=================================================="
echo "   Monad Exchange: Seeding Chart Data (via Cast)"
echo "=================================================="

echo "[0/5] Ensuring Local Balances..."
prefund_account "$ALICE_ADDR"
prefund_account "$BOB_ADDR"
prefund_account "$CAROL_ADDR"
prefund_account "$DEPTH_BID_ADDR"
prefund_account "$DEPTH_ASK_ADDR"
prefund_account "$CANDLE_BUY_ADDR"
prefund_account "$CANDLE_SELL_ADDR"
prefund_account "$LIQ_LONG_ADDR"
prefund_account "$LIQ_SHORT_ADDR"
prefund_account "$LIQ_LONG_2_ADDR"
prefund_account "$LIQ_LONG_3_ADDR"
prefund_account "$LIQ_SHORT_2_ADDR"
prefund_account "$LIQ_SHORT_3_ADDR"

check_tx() {
    if [ $? -ne 0 ]; then
        echo "Transaction failed."
        exit 1
    fi
}

pending_orders() {
    local addr=$1
    local raw
    if ! raw=$(cast call --rpc-url $RPC_URL $EXCHANGE "pendingOrderCount(address)" "$addr" 2>/dev/null); then
        echo "0"
        return
    fi
    cast to-dec "$raw"
}

place_order() {
    local pk=$1
    local is_buy=$2
    local price=$3
    local amount=$4
    local addr
    addr=$(cast wallet address --private-key "$pk")
    local pending
    pending=$(pending_orders "$addr")
    if [ "$pending" -ge 8 ]; then
        echo "  -> placeOrder skipped (pending=$pending, max=8) for $addr"
        return 0
    fi
    echo "  -> placeOrder Buy=$is_buy Price=$price Amount=$amount"
    if ! cast send --rpc-url $RPC_URL --private-key $pk $EXCHANGE "placeOrder(bool,uint256,uint256,uint256)" $is_buy $price $amount 0; then
        echo "  -> placeOrder failed (ignored)."
        if [ "$SOFT_FAILS" -ne 1 ]; then
            return 1
        fi
        return 0
    fi
    sleep 1
    check_tx
}

deposit_margin() {
    local pk=$1
    local amount=$2
    echo "  -> deposit ${amount}"
    cast send --rpc-url $RPC_URL --private-key $pk $EXCHANGE "deposit()" --value $amount
    sleep 1
    check_tx
}

set_price() {
    local price=$1
    echo "  -> updateIndexPrice $price"
    cast send --rpc-url $RPC_URL --private-key $ALICE_PK $EXCHANGE "updateIndexPrice(uint256)" $price
    sleep 1
    check_tx
}

advance_time() {
    local secs=$1
    echo "  -> Time travel ${secs}s"
    cast rpc --rpc-url $RPC_URL evm_increaseTime $secs > /dev/null
    cast rpc --rpc-url $RPC_URL evm_mine > /dev/null
}

echo "[1/5] Depositing Funds..."
echo "  -> Alice Deposit 1000 ETH"
cast send --rpc-url $RPC_URL --private-key $ALICE_PK $EXCHANGE "deposit()" --value 1000ether
check_tx

echo "  -> Bob Deposit 230 ETH"
cast send --rpc-url $RPC_URL --private-key $BOB_PK $EXCHANGE "deposit()" --value 230ether
check_tx

echo "  -> Carol Deposit 230 ETH"
cast send --rpc-url $RPC_URL --private-key $CAROL_PK $EXCHANGE "deposit()" --value 230ether
check_tx

echo "  -> Depth Bidder Deposit 400 ETH"
cast send --rpc-url $RPC_URL --private-key $DEPTH_BID_PK $EXCHANGE "deposit()" --value 400ether
check_tx

echo "  -> Depth Asker Deposit 400 ETH"
cast send --rpc-url $RPC_URL --private-key $DEPTH_ASK_PK $EXCHANGE "deposit()" --value 400ether
check_tx

echo "  -> Candle Buyer Deposit 200 ETH"
cast send --rpc-url $RPC_URL --private-key $CANDLE_BUY_PK $EXCHANGE "deposit()" --value 200ether
check_tx

echo "  -> Candle Seller Deposit 200 ETH"
cast send --rpc-url $RPC_URL --private-key $CANDLE_SELL_PK $EXCHANGE "deposit()" --value 200ether
check_tx

echo "[2/5] Setting Initial Index Price..."
set_price 3000ether

echo "[3/5] Placing Depth Liquidity (Dedicated Accounts)..."
place_order $DEPTH_BID_PK true 2940ether 1.2ether
place_order $DEPTH_BID_PK true 2920ether 0.9ether
place_order $DEPTH_BID_PK true 2900ether 1.5ether
place_order $DEPTH_BID_PK true 2880ether 0.7ether
place_order $DEPTH_ASK_PK false 3060ether 0.8ether
place_order $DEPTH_ASK_PK false 3080ether 1.1ether
place_order $DEPTH_ASK_PK false 3100ether 0.9ether
place_order $DEPTH_ASK_PK false 3120ether 1.3ether

echo "[4/5] Executing Trades (Generating Candles)..."
trade_at() {
    local price=$1
    local amount=$2
    echo "  - Trade @ $price"
    place_order $CANDLE_SELL_PK false ${price}ether ${amount}ether
    place_order $CANDLE_BUY_PK true ${price}ether ${amount}ether
    advance_time 60
}

trade_at 2950 0.03
trade_at 2975 0.05
trade_at 3005 0.04
trade_at 3030 0.03
trade_at 3050 0.05
trade_at 2985 0.04

echo "[5/5] Creating Liquidation Levels (Open Positions)..."
echo "  - High risk (~1% from price)"
deposit_margin $LIQ_LONG_PK 90ether
place_order $LIQ_LONG_PK true 3000ether 1ether
place_order $ALICE_PK false 3000ether 1ether
advance_time 60

deposit_margin $LIQ_SHORT_PK 90ether
place_order $LIQ_SHORT_PK false 3000ether 1ether
place_order $ALICE_PK true 3000ether 1ether
advance_time 60

echo "  - Medium risk (~5% from price, ~20x)"
deposit_margin $LIQ_LONG_2_PK 200ether
place_order $LIQ_LONG_2_PK true 3000ether 1ether
place_order $ALICE_PK false 3000ether 1ether
advance_time 60

deposit_margin $LIQ_SHORT_2_PK 200ether
place_order $LIQ_SHORT_2_PK false 3000ether 1ether
place_order $ALICE_PK true 3000ether 1ether
advance_time 60

echo "  - Cluster (~2% from price)"
deposit_margin $LIQ_LONG_3_PK 230ether
place_order $LIQ_LONG_3_PK true 3000ether 2ether
place_order $ALICE_PK false 3000ether 1ether
advance_time 60

deposit_margin $LIQ_SHORT_3_PK 230ether
place_order $LIQ_SHORT_3_PK false 3000ether 2ether
place_order $ALICE_PK true 3000ether 1ether
advance_time 60

echo "Seeding complete."
