import { digest } from '../plugins/workspace-goal-intelligence/src/contracts.mjs';
import { analyzeBusinessSources } from '../plugins/workspace-goal-intelligence/src/diagnostics.mjs';
import { draftDecisionFromDiagnosis } from '../plugins/workspace-goal-intelligence/src/decision-planner.mjs';
import { buildBusinessPulse } from '../plugins/workspace-goal-intelligence/src/pulse.mjs';
import { businessBrainSourceSnapshot } from './business-brain-source-adapter.mjs';

const time = value => { const parsed = Date.parse(value ?? ''); return Number.isFinite(parsed) ? parsed : null; };

/** An empty enterprise has nothing to announce; silence is the correct output. */
function observable(sources) {
  return sources.some(item => Number(item.values?.eligible) > 0 || Number(item.values?.total) > 0);
}

/**
 * The message that would be pushed for this enterprise right now, or null when
 * there is nothing observable.
 *
 * It is deterministic and model-free: the same observations always produce the
 * same `contentHash`, which is what makes duplicate pushes detectable without
 * keeping a second copy of the business data.
 */
export function buildBrainNotification({ state, workspaceId = 'local', clock = Date.now } = {}) {
  if (!state) throw new TypeError('A store snapshot is required.');
  if (typeof clock !== 'function') throw new TypeError('A clock is required.');
  const now = clock();
  const sources = businessBrainSourceSnapshot({ state, workspaceId, clock });
  if (!observable(sources)) return null;
  const diagnosis = analyzeBusinessSources(sources, now);
  const decisionDrafts = diagnosis.signals.slice(0, 3).map(signal =>
    draftDecisionFromDiagnosis({ diagnosis: { signals: [signal] }, context: null }));
  // Same card projection as the Business Brain home, including its three-card cap.
  const cards = buildBusinessPulse({ context: { context: null, sources }, diagnosis, decisionCards: [], decisionDrafts });
  const starts = sources.map(item => time(item.reference.windowStart)).filter(value => value !== null);
  const ends = sources.map(item => time(item.reference.windowEnd)).filter(value => value !== null);
  const startAt = new Date(starts.length ? Math.min(...starts) : now).toISOString();
  const endAt = new Date(ends.length ? Math.max(...ends) : now).toISOString();
  const contentHash = digest({
    workspaceId, startAt, endAt, status: diagnosis.status,
    cards: cards.map(card => [card.id, card.title, card.reason, card.evidenceIds]),
    gaps: diagnosis.gaps.map(gap => gap.reason ?? gap)
  });
  return {
    channel: 'brain-brief',
    messageId: `brain-brief:${workspaceId}`,
    revision: 1,
    contentHash,
    startAt, endAt,
    provisional: diagnosis.status !== 'measured' || diagnosis.gaps.length > 0,
    notificationCount: 1,
    title: `经营观察 ${startAt.slice(0, 10)} 至 ${endAt.slice(0, 10)}`,
    cards,
    evidence: sources.map(item => ({ evidenceId: item.evidenceId, reference: item.reference, observedAt: item.observedAt })),
    executable: false,
    businessGoalVerified: false
  };
}

/**
 * De-duplication guard for transports that may be retried. A retry with the
 * same content is not a new notification.
 */
export function shouldNotifyBrain({ notification = null, previousContentHash = null } = {}) {
  if (!notification) return false;
  if (typeof previousContentHash !== 'string' || !previousContentHash) return true;
  return previousContentHash !== notification.contentHash;
}
