// eslint.config.mjs
import obsidianmd from "eslint-plugin-obsidianmd";
import tseslint from "typescript-eslint";
import globals from "globals";

export default tseslint.config(
  ...obsidianmd.configs.recommended,   // ← все рекомендуемые правила

  {
    files: ["**/*.ts"],
    languageOptions: {
      globals: {
        ...globals.browser,
        ...globals.node,
      },
      parserOptions: {
        project: true,                    // можно оставить true или "./tsconfig.json"
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      // Правила, которые ты хочешь изменить:
      "obsidianmd/sample-names": "off",

      // ✅ Исправленное правило:
      "obsidianmd/prefer-file-manager-trash-file": "error",
    },
  }
);