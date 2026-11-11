interface CollectedSuite {
  title?: string;
  column?: number;
  specs?: { file: string; title: string; tests: { projectName: string }[] }[];
  suites?: CollectedSuite[];
}
export function collectedTests(report: { errors?: unknown[]; suites: CollectedSuite[] }): string[];
export function balanceShards(
  tests: string[],
  durations: Record<string, number>,
  count: number,
): { tests: string[]; duration: number }[];
