# PSX KSE-100 Swing Dashboard

A lightweight, single-user web app for personal swing-trading decision support on Pakistan Stock Exchange end-of-day data. Upload CSVs, review explainable scores, and explore historical validation without any real-time feeds.

## Features
- **Manual CSV upload** with `Symbol, Date, Open, High, Low, Close, Volume` columns, persisted locally in your browser (including the KSE100 index symbol for relative strength).
- **Indicator engine**: rolling resistance highs, volume moving average & spike ratio, Bollinger Band width, 20/50 moving averages, ATR-based stop guidance, and relative strength vs KSE-100.
- **Transparent scoring**: each indicator adds visible points and feeds the Watch / Prepare / Enter signals with no repainting.
- **Historical validation**: success counts and hit-rate for each signal using user-defined target% and days.
- **Charts**: custom canvas candlesticks with resistance, moving averages, optional Bollinger envelope, and volume bars.

## Getting started
1. Start the local static server:
   ```bash
   npm start
   ```
2. Open [http://localhost:4173](http://localhost:4173) in your browser.
3. Upload your end-of-day CSV (include `KSE100` rows for index calculations) and explore the dashboard table and detail view.

## Settings
- **Target % / Horizon**: configure the success definition for historical validation.
- **Bollinger overlay toggle**: show or hide the compression bands on the chart.

> This tool is for personal decision support only. It provides guidance—not trading advice.
