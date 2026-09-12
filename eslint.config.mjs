import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: ["**/dist/**", "**/node_modules/**", "**/.canary/**", "**/coverage/**", "apps/web/node_modules/**"],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      globals: { ...globals.node },
    },
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-unused-vars": "off",
      "@typescript-eslint/no-empty-object-type": "off",
      "@typescript-eslint/no-require-imports": "off",
      "no-undef": "off",
      "no-unused-vars": "off",
      "no-empty": "off",
      "no-constant-condition": "off",
      "no-useless-escape": "off",
      "no-control-regex": "off",
      "prefer-const": "off",
      "preserve-caught-error": "off",
    },
  },
);
