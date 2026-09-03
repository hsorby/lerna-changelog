import { defineConfig } from "eslint/config";
import globals from "globals";
import tsParser from "@typescript-eslint/parser";
import typescriptEslint from "@typescript-eslint/eslint-plugin";
import js from "@eslint/js";

import { FlatCompat } from "@eslint/eslintrc";

const __dirname = new URL(".", import.meta.url).pathname;

const compat = new FlatCompat({
    baseDirectory: __dirname,
    recommendedConfig: js.configs.recommended,
    allConfig: js.configs.all
});

export default defineConfig([{
    languageOptions: {
        globals: {
            ...globals.node,
            Atomics: "readonly",
            SharedArrayBuffer: "readonly",
        },

        parser: tsParser,
        ecmaVersion: 2018,
        sourceType: "module",
        parserOptions: {},
    },

    extends: compat.extends(
        "plugin:@typescript-eslint/eslint-recommended",
        "plugin:prettier/recommended",
    ),

    plugins: {
        "@typescript-eslint": typescriptEslint,
    },

    rules: {
        "prefer-const": "off",
    },
}]);
