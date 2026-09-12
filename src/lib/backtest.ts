import backtest from "../../data/backtest_summary.json";
import type { BacktestHit } from "./types";

interface BacktestFile {
  meta: { note: string; asOf: string | null };
  stations: Record<string, BacktestHit[]>;
}

const file = backtest as BacktestFile;

export function backtestFor(icao: string): BacktestHit[] {
  return file.stations[icao.toUpperCase()] ?? [];
}
