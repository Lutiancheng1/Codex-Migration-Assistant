import { useMemo } from "react";

export function formatTime(value?: string): string {
  if (!value) {
    return "-";
  }
  const ts = Date.parse(value);
  return Number.isNaN(ts) ? value : new Date(ts).toLocaleString();
}

export function formatPercent(value?: number): string {
  if (typeof value !== "number") {
    return "-";
  }
  return `${Math.max(0, Math.min(100, value)).toFixed(0)}%`;
}

export function formatRemainingPercent(value?: { remainingPercent: number } | undefined): string {
  return typeof value?.remainingPercent === "number" ? formatPercent(value.remainingPercent) : "-";
}

export function getPlanBadge(plan?: string): { label: string; tone: "neutral" | "good" | "caution" } | undefined {
  const normalized = plan?.trim().toLowerCase();
  if (!normalized) {
    return undefined;
  }
  if (normalized.includes("team")) {
    return { label: "TEAM", tone: "good" };
  }
  if (normalized.includes("free")) {
    return { label: "FREE", tone: "neutral" };
  }
  return { label: plan!.trim().toUpperCase(), tone: "caution" };
}

type UsageErrorItem = {
  name: string;
  usageError?: string;
};

export function summarizeUsageErrors(items: UsageErrorItem[]): string | undefined {
  const failures = items
    .filter((item) => item.usageError)
    .map((item) => ({
      name: item.name,
      error: item.usageError as string
    }));

  if (failures.length === 0) {
    return undefined;
  }

  const groups = new Map<string, string[]>();
  for (const item of failures) {
    const names = groups.get(item.error) ?? [];
    names.push(item.name);
    groups.set(item.error, names);
  }

  return Array.from(groups.entries())
    .map(([reason, names]) => `${names.join("、")}：${reason}`)
    .join("；");
}

export function useStableSelection<T extends { id: string }>(items: T[], preferredId?: string): T | undefined {
  return useMemo(() => {
    if (items.length === 0) {
      return undefined;
    }
    if (preferredId) {
      const matched = items.find((item) => item.id === preferredId);
      if (matched) {
        return matched;
      }
    }
    return items[0];
  }, [items, preferredId]);
}
