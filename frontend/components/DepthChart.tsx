import React, { useMemo } from 'react';
import { observer } from 'mobx-react-lite';
import ReactECharts from 'echarts-for-react';
import { useExchangeStore } from '../store/exchangeStore';

type DepthPoint = [number, number];

export const DepthChart: React.FC = observer(() => {
  const { orderBook } = useExchangeStore();
  const { bids, asks } = orderBook;

  const { bidPoints, askPoints } = useMemo(() => {
    const bidsDesc = [...bids].sort((a, b) => b.price - a.price);
    let bidCum = 0;
    const bidDescPoints: DepthPoint[] = bidsDesc.map((b) => {
      bidCum += b.size;
      return [b.price, bidCum];
    });
    const bidPointsAsc = bidDescPoints.reverse();

    const asksAsc = [...asks].sort((a, b) => a.price - b.price);
    let askCum = 0;
    const askPointsAsc: DepthPoint[] = asksAsc.map((a) => {
      askCum += a.size;
      return [a.price, askCum];
    });

    return { bidPoints: bidPointsAsc, askPoints: askPointsAsc };
  }, [bids, asks]);

  const hasData = bidPoints.length > 0 || askPoints.length > 0;

  const option = useMemo(() => ({
    backgroundColor: 'transparent',
    grid: { left: 56, right: 16, top: 12, bottom: 28 },
    tooltip: {
      trigger: 'axis',
      axisPointer: { type: 'cross' },
      backgroundColor: 'rgba(13, 15, 20, 0.9)',
      borderColor: 'rgba(255,255,255,0.08)',
      textStyle: { color: '#E5E7EB' },
    },
    xAxis: {
      type: 'value',
      scale: true,
      axisLine: { lineStyle: { color: 'rgba(255,255,255,0.2)' } },
      axisLabel: { color: '#9CA3AF', fontSize: 10 },
      splitLine: { lineStyle: { color: 'rgba(42, 46, 57, 0.4)' } },
    },
    yAxis: {
      type: 'value',
      scale: true,
      axisLine: { lineStyle: { color: 'rgba(255,255,255,0.2)' } },
      axisLabel: { color: '#9CA3AF', fontSize: 10 },
      splitLine: { lineStyle: { color: 'rgba(42, 46, 57, 0.4)' } },
    },
    series: [
      {
        name: 'Bids',
        type: 'line',
        step: 'end',
        showSymbol: false,
        data: bidPoints,
        lineStyle: { color: '#00E0FF', width: 2 },
        areaStyle: { color: 'rgba(0, 224, 255, 0.2)' },
        emphasis: { focus: 'series' },
      },
      {
        name: 'Asks',
        type: 'line',
        step: 'end',
        showSymbol: false,
        data: askPoints,
        lineStyle: { color: '#FF409A', width: 2 },
        areaStyle: { color: 'rgba(255, 64, 154, 0.18)' },
        emphasis: { focus: 'series' },
      },
    ],
  }), [bidPoints, askPoints]);

  if (!hasData) {
    return (
      <div className="w-full h-full flex items-center justify-center text-gray-500 text-sm">
        Waiting for depth data...
      </div>
    );
  }

  return <ReactECharts option={option} style={{ width: '100%', height: '100%' }} />;
});
