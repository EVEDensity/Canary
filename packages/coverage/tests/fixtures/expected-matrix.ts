export const expectedCoverageMatrix = {
  functionFixture: { functions: { executed: 1, total: 2 }, statements: { total: 2 } },
  branchFixture: { branches: { covered: 1, total: 2 } },
  ternaryFixture: { branches: { total: 2 } },
  errorFixture: { branches: { total: 2 }, functions: { total: 1 } },
  unloadedFixture: { files: { loaded: 0, total: 1 }, lines: { covered: 0 } },
} as const;
