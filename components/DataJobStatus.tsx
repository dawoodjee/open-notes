import React from 'react';
import { ActivityIndicator, Pressable, Text as RNText, View } from 'react-native';

import { clearJob, useJobState, type JobKind } from '@/lib/dataio/dataJobs';

/**
 * The running export or import, or how the last one ended.
 *
 * Reads the module-level job store (lib/dataio/dataJobs.ts) rather than any
 * component's state, which is what lets a user start an export, close
 * Settings, come back, and find it still going -- or finished, with its report.
 *
 * `only` limits it to one kind, so the Export page never shows an import's
 * report and vice versa. The Data menu passes nothing and shows either.
 */
export function DataJobStatus({ only }: { only?: JobKind }) {
  const job = useJobState();
  if (job.status === 'idle') return null;
  if (only && job.kind !== only) return null;

  const label = job.kind === 'export' ? 'Export' : 'Import';

  if (job.status === 'running') {
    const fraction = job.total > 0 ? Math.min(1, job.done / job.total) : 0;
    return (
      <View
        className="rounded-2xl bg-secondary px-4 py-4 gap-3 mb-6"
        accessibilityRole="progressbar"
        accessibilityLabel={`${label} in progress: ${job.phase}`}
        accessibilityValue={job.total ? { min: 0, max: job.total, now: job.done } : undefined}
      >
        <View className="flex-row items-center gap-3">
          <ActivityIndicator />
          <RNText className="text-base text-foreground flex-1">
            {job.phase}
            {job.total ? ` — ${job.done} of ${job.total}` : '…'}
          </RNText>
        </View>
        {job.total ? (
          <View className="h-1.5 rounded-full bg-foreground/10 overflow-hidden">
            <View className="h-full rounded-full bg-lime-500" style={{ width: `${fraction * 100}%` }} />
          </View>
        ) : null}
        <RNText className="text-sm text-muted-foreground">
          You can close Settings — this keeps going, and the result will be here.
        </RNText>
      </View>
    );
  }

  // Finished. Problems are capped on screen, never silently: the count of the
  // rest is always stated.
  const SHOWN = 12;
  const { lines, problems } = job.report;
  return (
    <View className="rounded-2xl bg-secondary px-4 py-4 gap-3 mb-6" accessibilityLiveRegion="polite">
      <RNText className={`text-base font-medium ${job.ok ? 'text-foreground' : 'text-red-600 dark:text-red-400'}`}>
        {job.ok ? `${label} finished` : `${label} didn’t finish`}
      </RNText>
      {lines.map((line, i) => (
        <RNText key={i} className="text-base text-foreground">
          {line}
        </RNText>
      ))}
      {problems.length ? (
        <View className="gap-1">
          {problems.slice(0, SHOWN).map((p, i) => (
            <RNText key={i} className="text-sm text-muted-foreground">
              {p}
            </RNText>
          ))}
          {problems.length > SHOWN ? (
            <RNText className="text-sm text-muted-foreground">…and {problems.length - SHOWN} more.</RNText>
          ) : null}
        </View>
      ) : null}
      <Pressable
        onPress={clearJob}
        hitSlop={8}
        className="self-start py-1"
        accessibilityRole="button"
        accessibilityLabel={`Dismiss the ${label.toLowerCase()} result`}
      >
        <RNText className="text-base font-medium text-lime-600 dark:text-lime-400">Done</RNText>
      </Pressable>
    </View>
  );
}
