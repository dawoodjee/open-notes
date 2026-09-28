import { useSyncExternalStore } from 'react';

/**
 * The state of the export or import that is running, if any.
 *
 * ── WHY A MODULE-LEVEL STORE AND NOT COMPONENT STATE ──────────────────────
 *
 * The Stage 15 prompt: "let the user navigate away". Component state dies with
 * the component, so an export started from Settings -> Data would lose its
 * progress -- and its result -- the moment the sheet closed. The job itself is
 * just a promise and keeps running regardless; what needs to outlive the
 * screen is the READOUT. Holding it here means reopening Data shows the job
 * exactly where it is, or how it ended.
 *
 * `useSyncExternalStore` is React's own hook for exactly this: a value that
 * lives outside React and changes on its own schedule.
 *
 * ONE JOB AT A TIME, deliberately. An import reading folders while an export
 * is writing them is two views of a moving target, and nobody needs both at
 * once.
 *
 * What this is NOT: OS background execution. iOS suspends JavaScript when the
 * app is backgrounded; a job paused there resumes when the app returns, and a
 * job killed there is gone. Import is safe against that by construction --
 * each note is its own write, existing notes are never touched unless
 * overwrite is on, and re-running the same zip skips what already landed.
 */

export type JobKind = 'export' | 'import';

export interface JobReport {
  /** One line per outcome worth stating, in the order a user wants them. */
  lines: string[];
  /** Individual problems -- which note, what happened. */
  problems: string[];
}

export type JobState =
  | { status: 'idle' }
  | { status: 'running'; kind: JobKind; phase: string; done: number; total: number }
  | { status: 'finished'; kind: JobKind; ok: boolean; report: JobReport };

let state: JobState = { status: 'idle' };
const listeners = new Set<() => void>();

function set(next: JobState) {
  state = next;
  listeners.forEach((l) => l());
}

export function getJobState(): JobState {
  return state;
}

export function useJobState(): JobState {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => state
  );
}

export function isJobRunning(): boolean {
  return state.status === 'running';
}

/** Reset a finished job's readout, e.g. when the user dismisses it. */
export function clearJob() {
  if (state.status === 'finished') set({ status: 'idle' });
}

/**
 * Run a job, reporting progress into the store.
 *
 * The job function receives `progress(phase, done, total)` and `yieldToUi()`,
 * and returns its report. A throw becomes a failed report rather than an
 * unhandled rejection -- the user must always get an answer.
 */
export async function runJob(
  kind: JobKind,
  job: (tools: {
    progress: (phase: string, done: number, total: number) => void;
    yieldToUi: () => Promise<void>;
  }) => Promise<JobReport>
): Promise<void> {
  if (isJobRunning()) return;
  set({ status: 'running', kind, phase: 'Starting', done: 0, total: 0 });

  let lastEmit = 0;
  const progress = (phase: string, done: number, total: number) => {
    // Throttled: a re-render per note would cost more than the note does.
    const now = Date.now();
    if (done !== total && now - lastEmit < 100) return;
    lastEmit = now;
    set({ status: 'running', kind, phase, done, total });
  };

  try {
    const report = await job({ progress, yieldToUi });
    set({ status: 'finished', kind, ok: true, report });
  } catch (err) {
    set({
      status: 'finished',
      kind,
      ok: false,
      report: {
        lines: [`${kind === 'export' ? 'Export' : 'Import'} stopped: ${err instanceof Error ? err.message : String(err)}`],
        problems: [],
      },
    });
  }
}

/**
 * Hand the thread back to the UI for a frame.
 *
 * Conversion and encryption are synchronous, and a thousand notes of them in
 * one go would freeze scrolling and taps until the last one finished. Yielding
 * between notes keeps the app responsive at the cost of a few milliseconds per
 * note -- the "don't block the UI thread" half of running in the background.
 */
export function yieldToUi(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}
