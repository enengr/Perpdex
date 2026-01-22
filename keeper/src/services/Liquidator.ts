import { walletClient, publicClient } from '../client';
import { EXCHANGE_ABI } from '../abi';
import { EXCHANGE_ADDRESS as ADDRESS } from '../config';

/**
 * Liquidator Service - 脚手架版本
 * 
 * 这个服务负责监控用户健康度并执行清算。
 * 
 * TODO: 学生需要实现以下功能：
 * 1. 监听 OrderPlaced 和 TradeExecuted 事件，跟踪活跃交易者
 * 2. 定期检查每个交易者的健康度
 * 3. 对可清算的仓位调用合约的 liquidate 函数
 */
export class Liquidator {
    private intervalId: NodeJS.Timeout | null = null;
    private isRunning = false;
    private activeTraders = new Set<string>();
    private isChecking = false;
    private unwatchOrderPlaced?: () => void;
    private unwatchTradeExecuted?: () => void;

    constructor(private intervalMs: number = 10000) { }

    async start() {
        if (this.isRunning) return;
        this.isRunning = true;
        console.log(`[Liquidator] Starting liquidation checks every ${this.intervalMs}ms...`);

        this.unwatchOrderPlaced = publicClient.watchContractEvent({
            address: ADDRESS as `0x${string}`,
            abi: EXCHANGE_ABI,
            eventName: 'OrderPlaced',
            onLogs: (logs) => {
                logs.forEach((log) => {
                    const trader = (log as any).args?.trader as string | undefined;
                    if (trader) this.activeTraders.add(trader.toLowerCase());
                });
            },
        });

        this.unwatchTradeExecuted = publicClient.watchContractEvent({
            address: ADDRESS as `0x${string}`,
            abi: EXCHANGE_ABI,
            eventName: 'TradeExecuted',
            onLogs: (logs) => {
                logs.forEach((log) => {
                    const buyer = (log as any).args?.buyer as string | undefined;
                    const seller = (log as any).args?.seller as string | undefined;
                    if (buyer) this.activeTraders.add(buyer.toLowerCase());
                    if (seller) this.activeTraders.add(seller.toLowerCase());
                });
            },
        });

        this.intervalId = setInterval(() => this.checkHealth(), this.intervalMs);
    }

    stop() {
        if (this.intervalId) {
            clearInterval(this.intervalId);
            this.intervalId = null;
        }
        if (this.unwatchOrderPlaced) {
            this.unwatchOrderPlaced();
            this.unwatchOrderPlaced = undefined;
        }
        if (this.unwatchTradeExecuted) {
            this.unwatchTradeExecuted();
            this.unwatchTradeExecuted = undefined;
        }
        this.isRunning = false;
        console.log('[Liquidator] Stopped.');
    }

    /**
     * 检查所有活跃交易者的健康度
     * 
     * TODO: 实现此函数
     * 步骤:
     * 1. 遍历 activeTraders
     * 2. 读取每个交易者的 margin 和 position
     * 3. 模拟调用 liquidate 检查是否可清算
     * 4. 如果可清算，发送实际交易
     */
    private async checkHealth() {
        if (this.activeTraders.size === 0) {
            console.log('[Liquidator] No active traders to check.');
            return;
        }

        console.log(`[Liquidator] Checking health for ${this.activeTraders.size} traders...`);

        if (this.isChecking) return;
        this.isChecking = true;
        try {
            for (const trader of Array.from(this.activeTraders)) {
                try {
                    const positionRaw = await publicClient.readContract({
                        address: ADDRESS as `0x${string}`,
                        abi: EXCHANGE_ABI,
                        functionName: 'getPosition',
                        args: [trader as `0x${string}`],
                    }) as any;

                    const position = Array.isArray(positionRaw)
                        ? { size: positionRaw[0] as bigint, entryPrice: positionRaw[1] as bigint }
                        : positionRaw;

                    if (!position || position.size === 0n) {
                        this.activeTraders.delete(trader);
                        continue;
                    }

                    const canLiquidate = await publicClient.readContract({
                        address: ADDRESS as `0x${string}`,
                        abi: EXCHANGE_ABI,
                        functionName: 'canLiquidate',
                        args: [trader as `0x${string}`],
                    }) as boolean;

                    if (!canLiquidate) continue;

                    const { request } = await publicClient.simulateContract({
                        address: ADDRESS as `0x${string}`,
                        abi: EXCHANGE_ABI,
                        functionName: 'liquidate',
                        args: [trader as `0x${string}`, 0n],
                        account: walletClient.account,
                    });

                    const hash = await walletClient.writeContract(request);
                    await publicClient.waitForTransactionReceipt({ hash });
                    console.log(`[Liquidator] Liquidated ${trader}, tx: ${hash}`);
                } catch (e) {
                    console.error(`[Liquidator] Error checking ${trader}:`, e);
                }
            }
        } finally {
            this.isChecking = false;
        }
    }
}
