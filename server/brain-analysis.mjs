import { digest } from '../plugins/workspace-goal-intelligence/src/contracts.mjs';

/**
 * Definition of the scheduled business-analysis occurrence.
 *
 * It is a bounded template goal: every occurrence starts a fresh conversation
 * with only the explicitly selected inputs, so a scheduled analysis can never
 * inherit an older conversation's private history. The instructions repeat the
 * Brain contract because the model runs unattended: measure first, never invent
 * a number, and never turn the run into an external action.
 */
export const BRAIN_ANALYSIS_GOAL = Object.freeze({
  title: 'Scheduled business analysis',
  maxSteps: 4,
  maxOutputTokens: 6000,
  description: [
    'Analyse this enterprise\'s current business observations and propose at most three actions.',
    'Call workspace_brain_diagnose first and read the measured observations.',
    'Call workspace_brain_brief for the current action cards and unfinished decisions.',
    'Report only what those tools returned. Do not invent KPI values, benchmarks, probabilities or causes.',
    'If no supported metric exists, name the missing observation and stop; do not create a goal or a decision to fill the space.',
    'Never contact a buyer, change a price, spend budget or dispatch a Worker from this run.'
  ].join('\n')
});

/** A fresh copy, suitable for creating the source goal a template schedule repeats. */
export function brainAnalysisGoalInput() {
  return { ...BRAIN_ANALYSIS_GOAL };
}

/** Pure, order-insensitive fingerprint of an observation set. */
export function observationFingerprint(references) {
  const rows = (Array.isArray(references) ? references : [])
    .filter(reference => reference && typeof reference.id === 'string')
    .map(reference => [
      reference.kind, reference.id, reference.revision, reference.sha256,
      reference.windowStart ?? null, reference.windowEnd ?? null
    ]);
  rows.sort((a, b) => `${a[0]}:${a[1]}`.localeCompare(`${b[0]}:${b[1]}`));
  return digest(rows);
}

/**
 * A scheduler precondition that only allows the analysis to run when the
 * observations actually moved.
 *
 * Skipping is the default: an unconfigured gate, a first occurrence with no
 * baseline, or a changed observation all run; an unchanged observation does
 * not. The fingerprint is recorded on every occurrence so the next tick has a
 * baseline even when the previous one was skipped.
 */
export function createObservationGate({ goalId, readFingerprint } = {}) {
  if (typeof goalId !== 'string' || !goalId.trim()) throw new TypeError('An analysis goal id is required.');
  if (typeof readFingerprint !== 'function') throw new TypeError('A fingerprint reader is required.');
  return function observationGate(schedule, state) {
    if (schedule?.goalId !== goalId) return { run: true, reason: 'NOT_ANALYSIS_SCHEDULE' };
    const fingerprint = readFingerprint(state);
    const runs = state?.capabilities?.scheduleRuns ?? [];
    const previous = [...runs].reverse().find(run => run.scheduleId === schedule.id && typeof run.analysisFingerprint === 'string');
    if (!previous) return { run: true, reason: 'NO_BASELINE', fingerprint };
    if (previous.analysisFingerprint !== fingerprint) return { run: true, reason: 'OBSERVATIONS_CHANGED', fingerprint };
    return { run: false, reason: 'OBSERVATION_UNCHANGED', fingerprint };
  };
}
