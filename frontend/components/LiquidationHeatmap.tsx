import React, { useEffect, useMemo, useState } from 'react';
import { observer } from 'mobx-react-lite';
import ReactECharts from 'echarts-for-react';
import { formatEther } from 'viem';
import type { Address } from 'viem';
import { EXCHANGE_ABI } from '../onchain/abi';
import { EXCHANGE_ADDRESS } from '../onchain/config';
import { publicClient } from '../onchain/client';
import { client, GET_ALL_POSITIONS } from '../store/IndexerClient';
import { useExchangeStore } from '../store/exchangeStore';

type PositionRow = {
  trader: string;
  size: string;
  entryPrice: string;
};

type LiquidationLevel = {
  price: number;
  volume: number;
};

type HeatmapPoint = [number, number, number, number];

type HeatmapDataset = {
  timeLabels: string[];
  timeTooltipLabels: string[];
  priceLabels: string[];
  data: HeatmapPoint[];
};

const PRICE_STEP = 10;
const VISUAL_MAX = 1000;
const DEFAULT_PRICE = 3000;
const MAX_TIME_POINTS = 96;
const INTENSITY_GAMMA = 1.25;

const formatUtcLabel = (isoTime: string) => {
  const iso = new Date(isoTime).toISOString();
  return iso.slice(11, 16);
};

const formatUtcTooltip = (isoTime: string) => {
  const iso = new Date(isoTime).toISOString();
  return iso.slice(0, 19).replace('T', ' ');
};

const buildTimeLabels = (candles: { time: string }[]) => {
  if (candles.length === 0) {
    return { timeLabels: [] as string[], timeTooltipLabels: [] as string[] };
  }

  const ordered = [...candles].reverse();
  const sliced = ordered.slice(-MAX_TIME_POINTS);
  const timeLabels = sliced.map((c) => formatUtcLabel(c.time));
  const timeTooltipLabels = sliced.map((c) => formatUtcTooltip(c.time));
  return { timeLabels, timeTooltipLabels };
};

const generateHeatmapData = (
  levels: LiquidationLevel[],
  currentPrice: number,
  timeLabels: string[],
  timeTooltipLabels: string[],
): HeatmapDataset => {
  if (levels.length === 0 || timeLabels.length === 0) {
    return { timeLabels, timeTooltipLabels, priceLabels: [], data: [] };
  }

  const anchorPrice = currentPrice > 0 ? currentPrice : DEFAULT_PRICE;
  const minPrice = Math.floor((anchorPrice * 0.8) / PRICE_STEP) * PRICE_STEP;
  const maxPrice = Math.ceil((anchorPrice * 1.2) / PRICE_STEP) * PRICE_STEP;

  const priceValues: number[] = [];
  for (let p = minPrice; p <= maxPrice; p += PRICE_STEP) {
    priceValues.push(p);
  }
  const priceLabels = priceValues.map((p) => p.toFixed(0));

  const bucketVolume = new Map<number, number>();
  levels.forEach((level) => {
    if (level.price < minPrice || level.price > maxPrice) return;
    const index = Math.floor((level.price - minPrice) / PRICE_STEP);
    if (index < 0 || index >= priceValues.length) return;
    bucketVolume.set(index, (bucketVolume.get(index) || 0) + level.volume);
  });

  if (bucketVolume.size === 0) {
    return { timeLabels, timeTooltipLabels, priceLabels, data: [] };
  }

  const maxVolume = Math.max(...Array.from(bucketVolume.values()), 1);
  const data: HeatmapPoint[] = [];
  const timeCount = timeLabels.length;

  bucketVolume.forEach((volume, priceIndex) => {
    const normalized = volume / maxVolume;
    const adjusted = Math.pow(normalized, INTENSITY_GAMMA);
    const intensity = Math.max(0, Math.min(VISUAL_MAX, adjusted * VISUAL_MAX));
    for (let t = 0; t < timeCount; t += 1) {
      data.push([t, priceIndex, intensity, volume]);
    }
  });

  return { timeLabels, timeTooltipLabels, priceLabels, data };
};

export const LiquidationHeatmap: React.FC = observer(() => {
  const { candles, markPrice } = useExchangeStore();
  const [levels, setLevels] = useState<LiquidationLevel[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    const fetchData = async () => {
      if (!EXCHANGE_ADDRESS) {
        if (!active) return;
        setLevels([]);
        setLoading(false);
        return;
      }

      const [positionsResult, maintenanceBps, liquidationFeeBps] = await Promise.all([
        client.query(GET_ALL_POSITIONS, {}).toPromise(),
        publicClient.readContract({
          abi: EXCHANGE_ABI,
          address: EXCHANGE_ADDRESS,
          functionName: 'maintenanceMarginBps',
        } as any),
        publicClient.readContract({
          abi: EXCHANGE_ABI,
          address: EXCHANGE_ADDRESS,
          functionName: 'liquidationFeeBps',
        } as any),
      ]);

      if (!active) return;

      const rows: PositionRow[] = positionsResult.data?.Position || [];
      const activeRows = rows
        .map((row) => ({
          trader: row.trader as Address,
          size: BigInt(row.size),
          entryPrice: BigInt(row.entryPrice),
        }))
        .filter((row) => row.size !== 0n);

      if (activeRows.length === 0) {
        setLevels([]);
        setLoading(false);
        return;
      }

      const margins = await Promise.all(
        activeRows.map((row) =>
          publicClient.readContract({
            abi: EXCHANGE_ABI,
            address: EXCHANGE_ADDRESS,
            functionName: 'margin',
            args: [row.trader],
          } as any),
        ),
      );

      if (!active) return;

      const k = (Number(maintenanceBps) + Number(liquidationFeeBps)) / 10_000;
      const mapped: LiquidationLevel[] = [];

      activeRows.forEach((row, index) => {
        const sizeAbs = Math.abs(Number(formatEther(row.size < 0n ? -row.size : row.size)));
        const entry = Number(formatEther(row.entryPrice));
        const margin = Number(formatEther(margins[index] as bigint));
        if (!sizeAbs || !entry) return;

        if (row.size > 0n) {
          const denom = sizeAbs * (k - 1);
          if (denom === 0) return;
          const liqPrice = (margin - entry * sizeAbs) / denom;
          if (!Number.isFinite(liqPrice) || liqPrice <= 0) return;
          mapped.push({ price: liqPrice, volume: sizeAbs * liqPrice });
        } else {
          const denom = sizeAbs * (k + 1);
          if (denom === 0) return;
          const liqPrice = (margin + entry * sizeAbs) / denom;
          if (!Number.isFinite(liqPrice) || liqPrice <= 0) return;
          mapped.push({ price: liqPrice, volume: sizeAbs * liqPrice });
        }
      });

      setLevels(mapped);
      setLoading(false);
    };

    fetchData();
    const id = setInterval(fetchData, 5000);
    return () => {
      active = false;
      clearInterval(id);
    };
  }, []);

  const currentPrice = useMemo(
    () => (markPrice > 0n ? Number(formatEther(markPrice)) : DEFAULT_PRICE),
    [markPrice],
  );

  const { timeLabels, timeTooltipLabels } = useMemo(() => buildTimeLabels(candles), [candles]);

  const { priceLabels, data } = useMemo(
    () => generateHeatmapData(levels, currentPrice, timeLabels, timeTooltipLabels),
    [levels, currentPrice, timeLabels, timeTooltipLabels],
  );

  const maxIntensity = useMemo(() => {
    if (data.length === 0) return VISUAL_MAX;
    const peak = Math.max(...data.map((point) => point[2]));
    return Math.max(peak, 1);
  }, [data]);

  const option = useMemo(() => {
    const labelInterval = timeLabels.length > 12 ? Math.floor(timeLabels.length / 8) : 0;
    return {
      backgroundColor: '#000000',
      animation: false,
      grid: { left: 48, right: 48, top: 16, bottom: 32 },
      tooltip: {
        trigger: 'item',
        backgroundColor: 'rgba(13, 15, 20, 0.9)',
        borderColor: 'rgba(255,255,255,0.08)',
        textStyle: { color: '#E5E7EB' },
        formatter: (params: any) => {
          const [timeIndex, priceIndex, value, amount] = params.value as HeatmapPoint;
          const timeLabel = timeTooltipLabels[timeIndex] ?? '';
          const priceLabel = priceLabels[priceIndex] ?? '';
          const amountLabel = Number.isFinite(amount) ? amount.toFixed(2) : '0';
          return `Time: ${timeLabel}<br/>Price: ${priceLabel}<br/>Liq. Intensity: ${value}<br/>Liq. Amount: ${amountLabel}`;
        },
      },
      visualMap: {
        min: 0,
        max: maxIntensity,
        dimension: 2,
        calculable: true,
        orient: 'vertical',
        right: 8,
        top: 'center',
        inRange: {
          color: ['#0b1020', '#162a5d', '#23408f', '#2b6cb0', '#1fa3ff', '#22c55e', '#eab308'],
        },
        textStyle: { color: '#9CA3AF', fontSize: 10 },
      },
      xAxis: {
        type: 'category',
        data: timeLabels,
        axisLine: { lineStyle: { color: 'rgba(255,255,255,0.2)' } },
        axisLabel: { color: '#9CA3AF', fontSize: 10, interval: labelInterval },
        axisTick: { show: false },
        splitLine: { show: false },
      },
      yAxis: {
        type: 'category',
        data: priceLabels,
        axisLine: { lineStyle: { color: 'rgba(255,255,255,0.2)' } },
        axisLabel: { color: '#9CA3AF', fontSize: 10 },
        axisTick: { show: false },
        splitLine: { show: false },
      },
      series: [
        {
          type: 'heatmap',
          encode: { value: 2 },
          data,
          emphasis: {
            itemStyle: {
              borderColor: 'rgba(255,255,255,0.15)',
              borderWidth: 1,
            },
          },
        },
      ],
    };
  }, [data, priceLabels, timeLabels, timeTooltipLabels]);

  if (loading) {
    return (
      <div className="w-full h-full flex items-center justify-center text-gray-500 text-sm">
        Loading liquidation map...
      </div>
    );
  }

  if (timeLabels.length === 0) {
    return (
      <div className="w-full h-full flex items-center justify-center text-gray-500 text-sm">
        Waiting for candle data...
      </div>
    );
  }

  if (data.length === 0) {
    return (
      <div className="w-full h-full flex items-center justify-center text-gray-500 text-sm">
        Waiting for liquidation levels...
      </div>
    );
  }

  return <ReactECharts option={option} style={{ width: '100%', height: '100%' }} />;
});
