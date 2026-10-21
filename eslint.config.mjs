import tsPlugin from "@typescript-eslint/eslint-plugin";
import tsParser from "@typescript-eslint/parser";
import globals from "globals";
import react from "eslint-plugin-react";
import reactHooks from "eslint-plugin-react-hooks";

const eslintConfig = [
  { ignores: [".next/**", "node_modules/**", "next-env.d.ts", "out/**"] },
  {
    files: ["**/*.ts", "**/*.tsx"],
    languageOptions: {
      parser: tsParser,
      parserOptions: { ecmaFeatures: { jsx: true }, ecmaVersion: "latest", sourceType: "module" },
      globals: { ...globals.browser, ...globals.node },
    },
    plugins: { "@typescript-eslint": tsPlugin, react, "react-hooks": reactHooks },
    settings: { react: { version: "detect" } },
    rules: {
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-unused-vars": ["warn", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
      "react/jsx-no-undef": "error",
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "warn",
    },
  },
];
export default eslintConfig;
