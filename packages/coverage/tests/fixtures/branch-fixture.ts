export function branchFixture(value: string | undefined): string {
  if (value) return value.trim();
  return "fallback";
}

export function conditionalFixture(value: number): string {
  return value > 0 ? "positive" : "non-positive";
}
