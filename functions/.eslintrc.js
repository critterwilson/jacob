module.exports = {
  root: true,
  env: {
    es6: true,
    node: true,
  },
  parser: "@typescript-eslint/parser",
  parserOptions: {
    project: ["tsconfig.json"],
    tsconfigRootDir: __dirname,
    sourceType: "module",
  },
  plugins: ["@typescript-eslint"],
  extends: [
    "eslint:recommended",
    "plugin:@typescript-eslint/recommended",
  ],
  rules: {
    "no-console": "warn",
  },
  // __tests__ are excluded from the deploy bundle via tsconfig.json's
  // exclude list; lint them via vitest itself, not the typed-project
  // parser (which doesn't include them).
  ignorePatterns: ["lib/**", "node_modules/**", "src/__tests__/**"],
};
