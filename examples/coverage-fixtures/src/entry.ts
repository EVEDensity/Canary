import { branch, throwsOnDemand } from "../src/fixture.js";

export function runFixture(input: unknown): string {
  const value = input === true;
  try {
    return `${branch(value)}:${throwsOnDemand(false)}`;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}
