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
