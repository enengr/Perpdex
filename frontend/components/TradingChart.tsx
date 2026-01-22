import React, { useEffect, useRef, useState } from 'react';
import { observer } from 'mobx-react-lite';
import { useExchangeStore } from '../store/exchangeStore';
import { createChart, ColorType, CrosshairMode, IChartApi, ISeriesApi, CandlestickSeries, HistogramSeries } from 'lightweight-charts';
import { DepthChart } from './DepthChart';
import { LiquidationHeatmap } from './LiquidationHeatmap';

export const TradingChart: React.FC = observer(() => {
  const { candles } = useExchangeStore();
  console.log('[TradingChart] candles from store:', candles);
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const volumeSeriesRef = useRef<ISeriesApi<'Histogram'> | null>(null);
  const [viewMode, setViewMode] = useState<'price' | 'depth' | 'heatmap'>('price');

  // Fix: lightweight-charts prefers unix timestamp (seconds) for intraday data
  const chartData = [...candles].reverse().map(c => ({
    time: Math.floor(new Date(c.time).getTime() / 1000) as any,
    open: c.open,
    high: c.high,
    low: c.low,
    close: c.close,
  }));
  const volumeData = [...candles].reverse().map(c => ({
    time: Math.floor(new Date(c.time).getTime() / 1000) as any,
    value: c.volume,
    color: c.close >= c.open ? '#00E0FF' : '#FF409A',
  }));

  useEffect(() => {
    if (!chartContainerRef.current) return;

    const chart = createChart(chartContainerRef.current, {
      layout: {
        background: { type: ColorType.Solid, color: 'transparent' },
        textColor: '#9CA3AF',
      },
      grid: {
        vertLines: { color: 'rgba(42, 46, 57, 0.5)' },
        horzLines: { color: 'rgba(42, 46, 57, 0.5)' },
      },
      width: chartContainerRef.current.clientWidth,
      height: chartContainerRef.current.clientHeight,
      crosshair: {
        mode: CrosshairMode.Normal,
      },
      timeScale: {
        borderColor: '#4B5563',
        timeVisible: true,
        secondsVisible: false,
      },
      leftPriceScale: {
        visible: true,
        borderColor: '#4B5563',
        ticksVisible: true,
        scaleMargins: { top: 0.8, bottom: 0.02 },
      },
      rightPriceScale: {
        borderColor: '#4B5563',
      },
    });
    chart.priceScale('right').applyOptions({
      scaleMargins: { top: 0.12, bottom: 0.28 },
    });

    const candlestickSeries = chart.addSeries(CandlestickSeries, {
      upColor: '#00E0FF',
      downColor: '#FF409A',
      borderVisible: false,
      wickUpColor: '#00E0FF',
      wickDownColor: '#FF409A',
    });

    const volumeSeries = chart.addSeries(HistogramSeries, {
      priceFormat: { type: 'volume' },
      priceScaleId: 'left',
      color: 'rgba(255, 255, 255, 0.35)',
      priceLineVisible: false,
      lastValueVisible: false,
    });

    candlestickSeries.setData(chartData);
    volumeSeries.setData(volumeData);
    seriesRef.current = candlestickSeries;
    volumeSeriesRef.current = volumeSeries;

    // Add current price line if we have data
    if (chartData.length > 0) {
      // TradingView handles current price line automatically if we update the last candle
      // But for a specific "current price" line distinct from the candle close, we can use a PriceLine
      // However, usually the last candle's close IS the current price.
    }

    chartRef.current = chart;

    const handleResize = () => {
      if (chartContainerRef.current && chart) {
        chart.applyOptions({ width: chartContainerRef.current.clientWidth });
      }
    };

    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
      chart.remove();
    };
  }, []); // Init once

  useEffect(() => {
    if (!seriesRef.current) return;
    seriesRef.current.setData(chartData);
    volumeSeriesRef.current?.setData(volumeData);
    if (chartRef.current) {
      chartRef.current.timeScale().fitContent();
    }
  }, [candles]); // Re-run when candles change.

  return (
    <div className="flex flex-col h-full bg-[#1A1D26] rounded-lg border border-gray-800 p-4 relative">
      <div className="flex justify-between items-center mb-4">
        <div className="flex items-center gap-4">
          <h2 className="text-lg font-semibold text-white">ETH/USD</h2>
          <div className="flex gap-2">
            <span className="text-sm text-gray-400">15m</span>
            <span className="text-sm text-gray-600">1h</span>
            <span className="text-sm text-gray-600">4h</span>
            <span className="text-sm text-gray-600">1d</span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {/* Price removed as requested */}
        </div>
      </div>

      <div className="absolute top-4 right-4 z-20 bg-[#0E111A] border border-white/10 rounded-full p-1 flex gap-1">
        <button
          onClick={() => setViewMode('price')}
          className={`text-xs px-3 py-1 rounded-full transition ${
            viewMode === 'price'
              ? 'bg-white/10 text-white'
              : 'text-gray-400 hover:text-white'
          }`}
        >
          Price
        </button>
        <button
          onClick={() => setViewMode('depth')}
          className={`text-xs px-3 py-1 rounded-full transition ${
            viewMode === 'depth'
              ? 'bg-white/10 text-white'
              : 'text-gray-400 hover:text-white'
          }`}
        >
          Depth
        </button>
        <button
          onClick={() => setViewMode('heatmap')}
          className={`text-xs px-3 py-1 rounded-full transition ${
            viewMode === 'heatmap'
              ? 'bg-white/10 text-white'
              : 'text-gray-400 hover:text-white'
          }`}
        >
          Liq. Map
        </button>
      </div>

      <div className="flex-1 w-full min-h-0 relative">
        <div className={viewMode === 'price' ? 'w-full h-full' : 'hidden'}>
          <div ref={chartContainerRef} className="w-full h-full" />
          {chartData.length === 0 && (
            <div className="absolute inset-0 flex items-center justify-center text-gray-500 text-sm pointer-events-none">
              Waiting for data...
            </div>
          )}
        </div>

        <div className={viewMode === 'depth' ? 'w-full h-full' : 'hidden'}>
          <DepthChart />
        </div>

        <div className={viewMode === 'heatmap' ? 'w-full h-full' : 'hidden'}>
          <LiquidationHeatmap />
        </div>
      </div>
    </div>
  );
});
