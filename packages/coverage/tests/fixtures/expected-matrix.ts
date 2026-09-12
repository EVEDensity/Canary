export const expectedCoverageMatrix = {
  branch: { functions: ["branchFixture", "conditionalFixture"], branches: 4 },
  function: { covered: ["calledFunction"], uncovered: ["uncalledFunction"] },
  error: { throws: true, collectorStatus: "partial" },
  unloaded: { status: "unavailable", denominatorIncluded: true },
} as const;
