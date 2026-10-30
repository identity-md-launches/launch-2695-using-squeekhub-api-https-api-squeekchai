import { useEffect, useState, type FormEvent } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useAccount, useSignMessage, useSwitchChain } from "wagmi";
import { getAddress } from "viem";
import { ConnectSheet } from "./components/ConnectSheet";
import { Modal } from "./components/Modal";
import { Icon } from "./components/Icon";
import { Wheel } from "./components/Wheel";
import { getConfig, getMarket, normalizeApi, post, request } from "./lib/api";
import { km, isFresh } from "./lib/data.mjs";
import { shortAddress } from "./lib/wallet";
import type {
  Baseline,
  Leaderboard,
  Player,
  Prediction,
  Side,
  WalletData,
} from "./lib/types";

const dayLabel = (date: string) =>
  new Date(`${date}T12:00:00Z`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
const dateTime = (time: number) =>
  new Date(time).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "UTC",
  }) + " UTC";
function timeLeft(expiry: number, now: number) {
  const minutes = Math.max(0, Math.ceil((expiry - now) / 60_000));
  return `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, "0")}m`;
}
function useNow() {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 15_000);
    return () => clearInterval(timer);
  }, []);
  return now;
}

export function App() {
  const client = useQueryClient();
  const { address, isConnected, chainId } = useAccount();
  const { signMessageAsync } = useSignMessage();
  const { switchChainAsync, isPending: switching } = useSwitchChain();
  const config = useQuery({
    queryKey: ["config"],
    queryFn: getConfig,
    staleTime: Infinity,
  });
  const apiBase = config.data || "";
  const market = useQuery({
    queryKey: ["market", apiBase],
    queryFn: () => getMarket(apiBase),
    enabled: config.isSuccess,
    refetchInterval: 30_000,
  });
  const leaders = useQuery({
    queryKey: ["leaders", apiBase, "summary"],
    queryFn: () => request<Leaderboard>(`${apiBase}/leaderboard?limit=5`),
    enabled: !!apiBase,
    refetchInterval: 30_000,
  });
  const wallet = useQuery({
    queryKey: ["wallet", apiBase, address],
    queryFn: () => request<WalletData>(`${apiBase}/wallet/${address}`),
    enabled: !!apiBase && !!address,
    refetchInterval: 30_000,
  });
  const [modal, setModal] = useState<
    "wallet" | "rules" | "service" | "leaders" | null
  >(null);
  const [side, setSide] = useState<Side | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const now = useNow();
  const data = market.data,
    baseline = data?.baseline;
  const measurement = data?.status?.measurement;
  const sourceNow =
    now + ((data?.serverTime || now) - (market.dataUpdatedAt || now));
  const fresh = data?.status && isFresh(data.status, sourceNow);
  const active = wallet.data?.predictions.find(
    (prediction) => prediction.state === "pending",
  );
  const wrongChain = isConnected && chainId !== 1;
  const noService = !apiBase;
  const refresh = () => {
    void market.refetch();
    if (apiBase) {
      void leaders.refetch();
      if (address) void wallet.refetch();
    }
  };
  useEffect(() => {
    setError("");
    setNotice("");
  }, [address]);

  async function predict(event: FormEvent) {
    event.preventDefault();
    setError("");
    setNotice("");
    if (!isConnected || !address) {
      setModal("wallet");
      return;
    }
    if (wrongChain) {
      try {
        await switchChainAsync({ chainId: 1 });
      } catch {
        setError(
          "Network switch declined. Switch to Ethereum in your wallet and try again.",
        );
      }
      return;
    }
    if (!side) {
      setError("Choose Over or Under to continue.");
      document.getElementById("pick-over")?.focus();
      return;
    }
    if (!apiBase || !data?.ready || active) return;
    setSubmitting(true);
    try {
      const challenge = await post<{
        id: string;
        message: string;
        averageMm: string;
      }>(apiBase, "/challenge", { address, side });
      const signature = await signMessageAsync({ message: challenge.message });
      const prediction = await post<Prediction>(apiBase, "/votes", {
        id: challenge.id,
        signature,
      });
      setNotice(
        `Prediction saved: ${prediction.side === "over" ? "Over" : "Under"}. Your result is due ${dateTime(prediction.expiresAt)}.`,
      );
      await Promise.all([
        client.invalidateQueries({ queryKey: ["wallet"] }),
        client.invalidateQueries({ queryKey: ["market"] }),
        client.invalidateQueries({ queryKey: ["leaders"] }),
      ]);
    } catch (cause) {
      setError(
        /rejected|denied|cancel/i.test(String(cause))
          ? "Signature declined. Your prediction was not saved. Try again when you’re ready."
          : cause instanceof Error
            ? cause.message
            : "Unable to save your prediction. Check your connection and try again.",
      );
    } finally {
      setSubmitting(false);
    }
  }
  const actionLabel = !isConnected
    ? "Connect to predict"
    : wrongChain
      ? switching
        ? "Switching network…"
        : "Switch to Ethereum"
      : submitting
        ? "Confirming prediction…"
        : active
          ? "Prediction locked in"
          : noService
            ? "Predictions opening soon"
            : !data?.ready
              ? measurement && !fresh
                ? "Waiting for fresh wheel data"
                : baseline?.ready
                  ? "Predictions temporarily paused"
                  : "Waiting for the baseline"
              : side
                ? `Predict ${side === "over" ? "Over" : "Under"}`
                : "Lock in prediction";
  return (
    <>
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <header className="site-header">
        <div className="header-inner">
          <a href="#market" className="brand" aria-label="SPM home">
            <img src="./favicon.svg" width={40} height={40} alt="" />
            <span className="brand-name">
              SPM<span className="brand-caption">Squeek Prediction Market</span>
            </span>
          </a>
          <nav aria-label="Main navigation">
            <a href="#market">Market</a>
            <a href="#leaderboard">Leaderboard</a>
            <button type="button" onClick={() => setModal("rules")}>
              How it works
            </button>
          </nav>
          <button
            className="connect-button"
            type="button"
            onClick={() => setModal("wallet")}
          >
            <Icon name="wallet" size={18} />
            <span>
              {address ? shortAddress(getAddress(address)) : "Connect"}
            </span>
          </button>
        </div>
      </header>
      <main id="main" className="page-shell">
        <section className="intro" id="market">
          <div>
            <h1>Small paws. Big predictions.</h1>
            <p>
              Predict Squeektoshi’s next 24-hour run. Get it right, earn a
              point.
            </p>
          </div>
          <button
            className="text-button rules-link"
            type="button"
            onClick={() => setModal("rules")}
          >
            <Icon name="info" size={18} /> A little help?
          </button>
        </section>
        <div className="top-grid">
          <section
            className="prediction-panel surface"
            aria-labelledby="prediction-title"
          >
            <div className="section-top">
              <h2 id="prediction-title">Make your prediction</h2>
              <span className="subtle-tag">
                <Icon name="clock" size={16} /> 24-hour round
              </span>
            </div>
            <p className="question">
              Will Squeektoshi run over or under his average?
            </p>
            <div className="baseline-metric">
              {market.isPending || config.isPending ? (
                <>
                  <div
                    className="metric-skeleton"
                    aria-label="Loading the seven-day baseline"
                  />
                  <span className="muted">Fetching wheel history…</span>
                </>
              ) : baseline ? (
                <>
                  <div className="metric-number">
                    {baseline.ready ? (
                      km(baseline.averageMm)
                    ) : (
                      <>
                        {baseline.completeDays}
                        <span className="metric-divider">/ 7</span>
                      </>
                    )}
                    <span className="metric-unit">
                      {baseline.ready ? "km / day" : "complete days"}
                    </span>
                  </div>
                  <div className="baseline-caption">
                    {baseline.ready
                      ? "The last seven complete days"
                      : "Building the seven-day baseline"}
                    <span
                      className={
                        baseline.ready ? "status-label" : "waiting-label"
                      }
                    >
                      {baseline.ready ? (
                        <>
                          <Icon name="check" size={14} /> Baseline ready
                        </>
                      ) : (
                        <>
                          <Icon name="clock" size={14} /> Collecting history
                        </>
                      )}
                    </span>
                  </div>
                </>
              ) : (
                <>
                  <div className="metric-unavailable">Feed unavailable</div>
                  <button
                    className="text-button"
                    type="button"
                    onClick={refresh}
                  >
                    <Icon name="refresh" size={16} /> Retry live data
                  </button>
                </>
              )}
            </div>
            {active ? (
              <ActivePrediction prediction={active} now={sourceNow} />
            ) : (
              <form onSubmit={(event) => void predict(event)}>
                <fieldset className="prediction-options">
                  <legend className="sr-only">Choose a prediction</legend>
                  {(["over", "under"] as const).map((choice) => (
                    <label
                      key={choice}
                      className={`prediction-option ${side === choice ? "is-selected" : ""}`}
                    >
                      <input
                        id={`pick-${choice}`}
                        aria-label={choice === "over" ? "Over" : "Under"}
                        aria-describedby={`hint-${choice}`}
                        type="radio"
                        name="prediction"
                        value={choice}
                        checked={side === choice}
                        onChange={() => {
                          setSide(choice);
                          setError("");
                        }}
                        disabled={submitting}
                      />
                      <span className={`choice-icon ${choice}`}>
                        <Icon
                          name={choice === "over" ? "up" : "down"}
                          size={24}
                        />
                      </span>
                      <span className="choice-content">
                        <strong>{choice === "over" ? "Over" : "Under"}</strong>
                        <span id={`hint-${choice}`}>
                          {choice === "over"
                            ? "A little more hustle"
                            : "A little more rest"}
                        </span>
                      </span>
                      <span className="radio-dot">
                        {side === choice && <Icon name="check" size={12} />}
                      </span>
                    </label>
                  ))}
                </fieldset>
                <button
                  className="primary predict-button"
                  type="submit"
                  disabled={
                    submitting ||
                    switching ||
                    (isConnected &&
                      !wrongChain &&
                      (!data?.ready || !apiBase || market.isError))
                  }
                >
                  <span>{actionLabel}</span>
                  <Icon name={!isConnected ? "wallet" : "arrow"} size={19} />
                </button>
              </form>
            )}
            <div role="status" className="success-message">
              {notice}
            </div>
            <p role="alert" className="error-message">
              {error ||
                (market.isError
                  ? (market.error as Error).message
                  : config.isError
                    ? "Site settings could not load. Refresh the page to retry."
                    : "")}
            </p>
            <div className="prediction-foot">
              <span>
                <Icon name="shield" size={16} /> No tokens or fees
              </span>
              <span>
                <Icon name="trophy" size={16} /> Correct prediction = 1 point
              </span>
            </div>
            {baseline && !baseline.ready && (
              <p className="baseline-note">
                Missing days stay unknown. Predictions open with seven fully
                recorded days.
              </p>
            )}
            {apiBase && data?.reason && !data.ready && baseline?.ready && (
              <p className="baseline-note">{data.reason}</p>
            )}
            {isConnected && noService && (
              <p className="baseline-note">
                Public voting is waiting for the shared score service.{" "}
                <button
                  className="inline-button"
                  onClick={() => setModal("service")}
                >
                  Service settings
                </button>
              </p>
            )}
          </section>
          <aside className="wheel-panel" aria-labelledby="wheel-title">
            <div className="section-top">
              <h2 id="wheel-title">Meet the market mover</h2>
              <span className={`feed-status ${fresh ? "is-online" : ""}`}>
                <span />
                {measurement
                  ? fresh
                    ? "Feed online"
                    : "Feed delayed"
                  : "Connecting"}
              </span>
            </div>
            <Wheel />
            <div className="hamster-name">
              Squeektoshi<span>Chief running officer</span>
            </div>
            <div className="wheel-stats">
              <div>
                <span>Today’s distance</span>
                <strong>
                  {measurement ? (
                    <>
                      {km(measurement.distanceMm)} <small>km</small>
                    </>
                  ) : (
                    "Unavailable"
                  )}
                </strong>
              </div>
              <div>
                <span>Wheel status</span>
                <strong className="wheel-state">
                  {measurement
                    ? !fresh
                      ? "Delayed"
                      : measurement.coreStatus === "COUNTER_FAULT"
                        ? "Sensor fault"
                        : measurement.speedMmPerSecond > 0
                          ? "On a roll"
                          : "Taking a breather"
                    : "Waiting for data"}
                </strong>
              </div>
            </div>
            <div className="wheel-footer">
              <span>Live wheel readings</span>
              <a
                href="https://api.squeekchain.com/v1/status"
                target="_blank"
                rel="noreferrer"
              >
                View source <Icon name="external" size={14} />
              </a>
            </div>
          </aside>
        </div>
        {isConnected && (
          <section className="wallet-summary" aria-label="Your score">
            <div>
              <Icon name="wallet" />
              <span>Your score</span>
              <strong>
                {wallet.data
                  ? `${wallet.data.player?.points ?? 0} ${(wallet.data.player?.points ?? 0) === 1 ? "point" : "points"}`
                  : "Unavailable"}
              </strong>
            </div>
            <div>
              <span>Correct predictions</span>
              <strong>
                {wallet.data ? (wallet.data.player?.wins ?? 0) : "Unavailable"}
              </strong>
            </div>
            <div>
              <span>Leaderboard rank</span>
              <strong>
                {wallet.data?.player
                  ? `#${wallet.data.player.rank}`
                  : wallet.data
                    ? "Unranked"
                    : "Unavailable"}
              </strong>
            </div>
            {wallet.isError && (
              <p role="alert">
                Your score could not refresh.{" "}
                <button
                  className="inline-button"
                  onClick={() => void wallet.refetch()}
                >
                  Retry score
                </button>
              </p>
            )}
          </section>
        )}
        <div className="bottom-grid">
          <section
            className="history-panel surface"
            aria-labelledby="history-title"
          >
            <div className="section-top">
              <h2 id="history-title">A week on the wheel</h2>
              <button
                type="button"
                className="icon-button"
                aria-label="Refresh wheel history"
                disabled={market.isFetching}
                onClick={refresh}
              >
                <Icon name="refresh" size={18} />
              </button>
            </div>
            <div className="history-summary">
              <strong>
                {baseline?.averageMm ? (
                  <>
                    {km(baseline.averageMm)} <span>km / day</span>
                  </>
                ) : baseline ? (
                  "No complete days yet"
                ) : market.isPending ? (
                  "Loading history…"
                ) : (
                  "History unavailable"
                )}
              </strong>
              {baseline && (
                <span>
                  {baseline.ready
                    ? "Seven-day average"
                    : `Observed average · ${baseline.completeDays} complete days`}
                </span>
              )}
            </div>
            <HistoryChart baseline={baseline} />
            <div className="chart-key">
              <span>
                <i className="key-complete" /> Complete
              </span>
              <span>
                <i className="key-missing" /> Missing or partial
              </span>
              <span className="timezone">Noon to noon, UTC</span>
            </div>
            <details className="history-details">
              <summary>See daily distances</summary>
              <div className="daily-list">
                {baseline?.days.map((day) => (
                  <div key={day.date}>
                    <span>{dayLabel(day.date)}</span>
                    <span>
                      {day.distanceMm !== null
                        ? `${km(day.distanceMm)} km`
                        : "Unknown"}
                    </span>
                    <span>
                      {day.complete
                        ? "Complete"
                        : day.distanceMm
                          ? "Partial"
                          : "Missing"}
                    </span>
                  </div>
                ))}
              </div>
              <p>
                Only fully recorded days enter the average. The current,
                unfinished day is excluded.
              </p>
            </details>
          </section>
          <section
            className="leaderboard-panel surface"
            id="leaderboard"
            aria-labelledby="leaderboard-title"
          >
            <div className="section-top">
              <h2 id="leaderboard-title">
                <Icon name="trophy" size={21} /> The leaderboard
              </h2>
              <span className="muted">All time</span>
            </div>
            <div className="leaderboard-labels">
              <span>Rank</span>
              <span>Wallet</span>
              <span>Points</span>
            </div>
            {noService ? (
              <div className="leaderboard-empty">
                <span className="empty-icon">
                  <Icon name="trophy" size={25} />
                </span>
                <h3>A little friendly competition.</h3>
                <p>
                  Public scores will appear when the shared score service is
                  connected.
                </p>
                <button
                  className="text-button"
                  type="button"
                  onClick={() => setModal("service")}
                >
                  Connect score service <Icon name="arrow" size={16} />
                </button>
              </div>
            ) : leaders.isPending ? (
              <p className="empty-copy" role="status">
                Loading public scores…
              </p>
            ) : leaders.isError ? (
              <div className="empty-copy">
                <p>Scores couldn’t load.</p>
                <button
                  className="text-button"
                  onClick={() => void leaders.refetch()}
                >
                  Retry leaderboard
                </button>
              </div>
            ) : leaders.data?.items.length ? (
              <>
                <LeaderboardRows
                  players={leaders.data.items}
                  currentAddress={address}
                />
                <button
                  className="leaderboard-more text-button"
                  type="button"
                  onClick={() => setModal("leaders")}
                >
                  View all {leaders.data.total} players{" "}
                  <Icon name="arrow" size={16} />
                </button>
              </>
            ) : (
              <div className="leaderboard-empty">
                <span className="empty-icon">
                  <Icon name="trophy" size={25} />
                </span>
                <h3>The first point is up for grabs.</h3>
                <p>Make a prediction to join the public leaderboard.</p>
                <a className="text-button" href="#market">
                  Make a prediction <Icon name="arrow" size={16} />
                </a>
              </div>
            )}
            <div className="leaderboard-foot">
              <Icon name="info" size={15} />
              <span>Correct predictions earn one point each.</span>
            </div>
          </section>
        </div>
        {wallet.data && wallet.data.predictions.length > 0 && (
          <section className="past-predictions surface">
            <div className="section-top">
              <h2>Your predictions</h2>
              <span className="muted">Latest 50</span>
            </div>
            {wallet.data.predictions.map((prediction) => (
              <div className="prediction-history-row" key={prediction.id}>
                <span className="history-pick">
                  <Icon name={prediction.side === "over" ? "up" : "down"} />
                  {prediction.side === "over" ? "Over" : "Under"}
                </span>
                <span>{dateTime(prediction.startAt)}</span>
                <span>
                  {prediction.distanceMm === null
                    ? "Result pending"
                    : `${km(prediction.distanceMm)} km`}
                </span>
                <strong
                  className={prediction.state === "won" ? "positive" : ""}
                >
                  {prediction.state === "won"
                    ? "+1 point"
                    : prediction.state === "lost"
                      ? "No point"
                      : prediction.state === "tie"
                        ? "Exact tie"
                        : sourceNow >= prediction.expiresAt
                          ? "Awaiting evidence"
                          : "Running"}
                </strong>
              </div>
            ))}
          </section>
        )}
        <section className="how-strip" aria-label="How SPM works">
          <div>
            <span className="step-number">1</span>
            <div>
              <strong>Pick a side</strong>
              <p>Over or under the seven-day average.</p>
            </div>
          </div>
          <div>
            <span className="step-number">2</span>
            <div>
              <strong>Let him do his thing</strong>
              <p>Your prediction runs for 24 hours.</p>
            </div>
          </div>
          <div>
            <span className="step-number">3</span>
            <div>
              <strong>Collect your point</strong>
              <p>The right call moves you up the board.</p>
            </div>
          </div>
        </section>
      </main>
      <footer className="site-footer">
        <div>
          <a className="footer-brand" href="#market">
            SPM
          </a>
          <span>Powered by tiny paws &amp; Squeekhub data.</span>
        </div>
        <div>
          <button className="footer-link" onClick={() => setModal("rules")}>
            Rules &amp; scoring
          </button>
          <button className="footer-link" onClick={() => setModal("service")}>
            Score service
          </button>
          <a
            href="https://docs.squeekchain.com/developers/api/"
            target="_blank"
            rel="noreferrer"
          >
            API docs <Icon name="external" size={14} />
          </a>
        </div>
      </footer>
      {modal === "wallet" && <ConnectSheet onClose={() => setModal(null)} />}
      {modal === "rules" && <Rules onClose={() => setModal(null)} />}
      {modal === "service" && (
        <ServiceSettings
          apiBase={apiBase}
          onClose={() => setModal(null)}
          onSave={(value) => {
            client.setQueryData(["config"], value);
            setModal(null);
          }}
        />
      )}
      {modal === "leaders" && (
        <FullLeaderboard
          apiBase={apiBase}
          address={address}
          onClose={() => setModal(null)}
        />
      )}
    </>
  );
}
function ActivePrediction({
  prediction,
  now,
}: {
  prediction: Prediction;
  now: number;
}) {
  const due = now >= prediction.expiresAt;
  return (
    <div className="active-prediction">
      <div>
        <span className="active-check">
          <Icon name="check" size={20} />
        </span>
        <strong>
          You picked {prediction.side === "over" ? "Over" : "Under"}
        </strong>
      </div>
      <p>
        {due
          ? "Your 24 hours are complete. Waiting for verified wheel history before scoring."
          : `Squeektoshi has ${timeLeft(prediction.expiresAt, now)} to make his move.`}
      </p>
      <dl>
        <div>
          <dt>Your target</dt>
          <dd>{km(prediction.averageMm)} km</dd>
        </div>
        <div>
          <dt>Result due</dt>
          <dd>{dateTime(prediction.expiresAt)}</dd>
        </div>
      </dl>
      <p className="muted">
        Your pick is locked. A correct call earns 1 point.
      </p>
    </div>
  );
}
function HistoryChart({ baseline }: { baseline?: Baseline | null }) {
  if (!baseline)
    return (
      <div className="chart-empty">
        Wheel history will appear here when the feed is available.
      </div>
    );
  const maximum = Math.max(
    1,
    ...(baseline?.days.map((day) => Number(day.distanceMm || 0)) || []),
  );
  return (
    <div
      className="history-chart"
      role="img"
      aria-label={
        baseline
          ? `Seven completed calendar days. ${baseline.completeDays} days fully covered. Daily values follow in See daily distances.`
          : "Waiting for seven-day history."
      }
    >
      <div className="chart-grid-lines">
        <span>{(maximum / 1_000_000).toFixed(1)} km</span>
        <span>{(maximum / 2_000_000).toFixed(1)}</span>
        <span>0</span>
      </div>
      <div className="chart-bars">
        {baseline?.days.map((day) => (
          <div className="bar-column" key={day.date}>
            <div className="bar-track">
              <div
                className={`chart-bar ${day.complete ? "complete" : "incomplete"} ${day.distanceMm === null ? "missing" : ""}`}
                style={{
                  height:
                    day.distanceMm === null
                      ? "20%"
                      : `${Math.max(1.5, (Number(day.distanceMm) / maximum) * 100)}%`,
                }}
                title={`${dayLabel(day.date)}: ${day.distanceMm === null ? "Unknown" : `${km(day.distanceMm)} km`}${day.complete ? "" : " · Incomplete coverage"}`}
              />
            </div>
            <span>
              {new Date(`${day.date}T12:00:00Z`).toLocaleDateString("en-US", {
                weekday: "short",
                timeZone: "UTC",
              })}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
function LeaderboardRows({
  players,
  currentAddress,
}: {
  players: Player[];
  currentAddress?: string;
}) {
  return (
    <ol className="leaderboard-rows">
      {players.map((player) => (
        <li
          className={
            player.address.toLowerCase() === currentAddress?.toLowerCase()
              ? "is-you"
              : ""
          }
          key={player.address}
        >
          <span className="rank-number">{player.rank}</span>
          <span className="player-wallet">
            <span
              className={`wallet-avatar avatar-${player.rank % 4}`}
              aria-hidden="true"
            >
              <Icon name="wallet" size={17} />
            </span>
            <details>
              <summary>
                {shortAddress(getAddress(player.address))}
                {player.address.toLowerCase() === currentAddress?.toLowerCase()
                  ? " (you)"
                  : ""}
              </summary>
              <span className="full-address">{getAddress(player.address)}</span>
            </details>
          </span>
          <strong>{player.points}</strong>
        </li>
      ))}
    </ol>
  );
}
function Rules({ onClose }: { onClose: () => void }) {
  return (
    <Modal
      title="A good call goes a long way."
      onClose={onClose}
      className="rules-modal"
    >
      <p className="modal-intro">
        SPM is a free prediction game about Squeektoshi’s wheel distance.
      </p>
      <ol className="rules-list">
        <li>
          <strong>Seven days set the target.</strong>
          <p>
            The average uses the previous seven complete noon-to-noon UTC days.
            Missing data is never counted as zero. Kilometres are rounded for
            display; scoring uses exact millimetres and the unrounded average.
          </p>
        </li>
        <li>
          <strong>Pick Over or Under.</strong>
          <p>
            Connect an Ethereum wallet and sign a plain message to record your
            choice. No transaction, tokens or gas. You can have one active
            prediction per wallet.
          </p>
        </li>
        <li>
          <strong>Wait 24 hours.</strong>
          <p>
            Your window starts when the service accepts your signed prediction.
            The target stays fixed. Eligible hardware passages in that exact
            window determine the distance.
          </p>
        </li>
        <li>
          <strong>Earn a point.</strong>
          <p>
            A correct prediction earns 1 point for your wallet. An incorrect
            prediction or an exact tie earns 0. Points cannot be bought or
            transferred.
          </p>
        </li>
      </ol>
      <div className="notice-box">
        <Icon name="info" />
        <p>
          Source delays can delay your result. The service waits for complete
          passage history and never guesses a score. Distances are wheel-based
          estimates.
        </p>
      </div>
      <p className="muted privacy-note">
        Wallet addresses, predictions and points are public. SPM’s shared score
        service stores them; your wallet proves ownership. This is not a betting
        or payout service.
      </p>
      <button className="primary wide" onClick={onClose}>
        Got it <Icon name="check" size={18} />
      </button>
    </Modal>
  );
}
function ServiceSettings({
  apiBase,
  onSave,
  onClose,
}: {
  apiBase: string;
  onSave: (value: string) => void;
  onClose: () => void;
}) {
  const [value, setValue] = useState(apiBase),
    [error, setError] = useState(""),
    [pending, setPending] = useState(false);
  async function submit(event: FormEvent) {
    event.preventDefault();
    setError("");
    setPending(true);
    try {
      const normalized = normalizeApi(value);
      if (normalized) await getMarket(normalized);
      try {
        localStorage.setItem("spm-api-base", normalized);
      } catch {
        /* current session still works */
      }
      onSave(normalized);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Unable to connect. Check the URL and try again.",
      );
    } finally {
      setPending(false);
    }
  }
  return (
    <Modal title="Connect the score service" onClose={onClose}>
      <p className="modal-intro">
        Live wheel data is public. Shared predictions and points need the SPM
        score service included with this website.
      </p>
      <form onSubmit={(event) => void submit(event)}>
        <label className="field-label" htmlFor="service-url">
          Score service API URL
        </label>
        <input
          className="text-input"
          id="service-url"
          type="url"
          value={value}
          onChange={(event) => setValue(event.target.value)}
          placeholder="https://your-service.example/api"
          aria-describedby="service-help service-error"
          aria-invalid={!!error}
        />
        <p className="field-help" id="service-help">
          Use the operator’s public URL ending in /api. Leave blank for live
          data only.
        </p>
        <p id="service-error" className="error-message" role="alert">
          {error}
        </p>
        <button className="primary wide" disabled={pending} type="submit">
          {pending ? "Checking connection…" : "Save connection"}
          <Icon name="arrow" size={18} />
        </button>
      </form>
      <p className="muted privacy-note">
        This setting stays in this browser. Public scores live in the connected
        service, never in browser storage. The operator can set a default for
        every visitor in spm-config.json.
      </p>
    </Modal>
  );
}
function FullLeaderboard({
  apiBase,
  address,
  onClose,
}: {
  apiBase: string;
  address?: string;
  onClose: () => void;
}) {
  const [page, setPage] = useState(0);
  const result = useQuery({
    queryKey: ["leaders", apiBase, "full", page],
    queryFn: () =>
      request<Leaderboard>(
        `${apiBase}/leaderboard?limit=20&offset=${page * 20}`,
      ),
  });
  return (
    <Modal
      title="The public leaderboard"
      onClose={onClose}
      className="full-leaderboard"
    >
      <p className="modal-intro">
        All-time points. Ties are ordered by completed predictions, then wallet
        address.
      </p>
      <div className="leaderboard-labels">
        <span>Rank</span>
        <span>Wallet</span>
        <span>Points</span>
      </div>
      {result.data ? (
        <LeaderboardRows players={result.data.items} currentAddress={address} />
      ) : result.isError ? (
        <p role="alert">
          Unable to load scores.{" "}
          <button
            className="inline-button"
            onClick={() => void result.refetch()}
          >
            Retry
          </button>
        </p>
      ) : (
        <p role="status">Loading scores…</p>
      )}
      <div className="pagination">
        <button
          className="secondary"
          disabled={!page || result.isFetching}
          onClick={() => setPage((value) => value - 1)}
        >
          Previous
        </button>
        <span>Page {page + 1}</span>
        <button
          className="secondary"
          disabled={
            !result.data ||
            (page + 1) * 20 >= result.data.total ||
            result.isFetching
          }
          onClick={() => setPage((value) => value + 1)}
        >
          Next
        </button>
      </div>
    </Modal>
  );
}
