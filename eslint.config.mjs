import js from "@eslint/js";
import globals from "globals";

export default [
  { ignores: ["**/node_modules/**", "**/.next/**", "**/dist/**", "coverage/**"] },
  {
    files: ["**/*.{js,jsx,mjs}"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      parserOptions: { ecmaFeatures: { jsx: true } },
      globals: { ...globals.browser, ...globals.node },
    },
    rules: js.configs.recommended.rules,
  },
];
