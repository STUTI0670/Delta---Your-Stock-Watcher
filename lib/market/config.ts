/**
 * P1 configuration for meaningful-change detection and alerting.
 *
 * Everything here is deliberately deterministic and tunable from one place so
 * the product thresholds can be adjusted without touching business logic.
 */

/** A price move is "meaningful" once |%| reaches this value. */
export const MEANINGFUL_PRICE_CHANGE_PCT = 3;

/** A larger move that we surface with stronger emphasis. */
export const LARGE_PRICE_CHANGE_PCT = 6;

/**
 * Volume is only considered when the provider gives us both a current and a
 * baseline figure. A spike is a multiple of the baseline.
 */
export const MEANINGFUL_VOLUME_SPIKE_RATIO = 2;

/** Quotes older than this are labelled stale in the UI. */
export const STALE_QUOTE_AFTER_MS = 15 * 60 * 1000;

/**
 * Minimum gap between two checkpoints. Opening the dashboard twice inside this
 * window keeps the older checkpoint so a quick refresh does not erase the
 * "what changed" comparison the user just started reading.
 */
export const MIN_CHECKPOINT_INTERVAL_MS = 30 * 60 * 1000;

/**
 * Re-arm hysteresis for alerts, as a percentage of the threshold price.
 * A buy alert at $165 only re-arms once price recovers above $165 * 1.02,
 * which stops a price hovering on the threshold from re-triggering.
 */
export const ALERT_REARM_BUFFER_PCT = 2;

/** Hard floor between two notifications for the same alert. */
export const ALERT_MIN_RENOTIFY_MS = 6 * 60 * 60 * 1000;

/** Trading sessions of daily history used for the volume baseline. */
export const VOLUME_BASELINE_SESSIONS = 20;

/** Minimum sessions before a volume baseline is trustworthy enough to use. */
export const MIN_SESSIONS_FOR_VOLUME_BASELINE = 8;

/* -------------------------------------------------------------------------- */
/*                 P2 — attention scoring, cadence, personalization            */
/* -------------------------------------------------------------------------- */

/** Trading sessions of history used for behaviour statistics. */
export const BEHAVIOR_LOOKBACK_SESSIONS = 20;

/** Minimum sessions before behaviour statistics are trustworthy enough to show. */
export const MIN_SESSIONS_FOR_BEHAVIOR = 8;

/** A daily close-to-close move at or above this counts as a "large move". */
export const LARGE_DAILY_MOVE_PCT = 4;

/**
 * Attention score bands. The score is a sum of independent signals, and these
 * turn that total into the label the interface shows.
 */
export const ATTENTION_BANDS = {
  worthWatching: 3,
  important: 6,
} as const;

/**
 * Monitoring-cadence thresholds, expressed in average absolute daily movement.
 * These describe how often a stock is worth *looking at* — never whether to
 * buy or sell it.
 */
export const CADENCE_HIGH_AVG_MOVE_PCT = 2.5;
export const CADENCE_LOW_AVG_MOVE_PCT = 1.2;

/** Large moves in the window that on their own justify closer monitoring. */
export const CADENCE_FREQUENT_LARGE_MOVES = 3;

/** Threshold crossings in the window that justify closer monitoring. */
export const CADENCE_FREQUENT_CROSSINGS = 2;

/** Window used when counting how often a symbol crossed the user's thresholds. */
export const CROSSING_LOOKBACK_DAYS = 30;

/**
 * Feedback personalization. Votes shift how much a signal contributes to the
 * attention score, clamped so no amount of feedback can silence a signal
 * entirely or let one dominate.
 */
export const FEEDBACK_WEIGHT_STEP = 0.15;
export const FEEDBACK_WEIGHT_MIN = 0.5;
export const FEEDBACK_WEIGHT_MAX = 1.5;

/** Votes older than this stop influencing personalization. */
export const FEEDBACK_LOOKBACK_DAYS = 90;
