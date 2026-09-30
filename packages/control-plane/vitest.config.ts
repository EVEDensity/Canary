import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  // Vitest 4 no longer excludes dist by default. Run source tests once.
  test: { exclude: [...configDefaults.exclude, "**/dist/**"] },
});
