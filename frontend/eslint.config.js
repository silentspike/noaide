import tsParser from "@typescript-eslint/parser";
import tsPlugin from "@typescript-eslint/eslint-plugin";
import solidPlugin from "eslint-plugin-solid";

export default [
  {
    files: ["src/**/*.{ts,tsx}"],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        ecmaVersion: "latest",
        sourceType: "module",
        ecmaFeatures: { jsx: true },
      },
    },
    plugins: {
      "@typescript-eslint": tsPlugin,
      solid: solidPlugin,
    },
    rules: {
      // TypeScript
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      "@typescript-eslint/no-explicit-any": "warn",

      // SolidJS
      "solid/reactivity": "warn",
      "solid/no-destructure": "error",
      "solid/jsx-no-duplicate-props": "error",
      "solid/no-react-specific-props": "error",
      "solid/prefer-for": "warn",

      // General
      "no-console": ["warn", { allow: ["warn", "error"] }],
      "no-debugger": "error",
    },
  },
  {
    ignores: ["dist/", "node_modules/", "*.config.*"],
  },
];
