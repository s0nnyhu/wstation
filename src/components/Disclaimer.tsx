export function Disclaimer() {
  return (
    <footer className="border-t border-line px-3 py-6 text-xs leading-relaxed text-mute sm:px-6">
      <p>
        Not financial advice. This is a research terminal for daily highest-temperature
        markets. Polymarket resolves on specific station / Weather Underground rules —
        always read the market text (ICAO, units, timezone, and observation source) before
        trading. Biases are empirical ASOS residuals from Open-Meteo historical-forecast
        (2024-01-01→2026-09-01): mean(forecast daily max − ASOS daily max). They are not
        seasonal climate normals and not a guarantee of future error. US HRRR / HRDPS
        series may be archive-proxy identical to seamless in this dataset — do not treat
        those rows as native short-range skill. Model output is from{" "}
        <a
          className="text-cyan hover:underline"
          href="https://open-meteo.com/"
          target="_blank"
          rel="noreferrer"
        >
          Open-Meteo
        </a>
        . Observations are public METARs. Do not treat suggested buckets as a trade.
      </p>
    </footer>
  );
}
