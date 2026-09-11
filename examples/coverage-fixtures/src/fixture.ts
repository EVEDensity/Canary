export function branch(value: boolean): string {
  if (value) return "true-branch";
  return "false-branch";
}

export function neverLoaded(): string {
  return "never-loaded";
}

export function throwsOnDemand(value: boolean): string {
  if (value) throw new Error("fixture-error");
  return "safe";
}
