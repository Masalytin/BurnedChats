import eslint from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
    eslint.configs.recommended,
    ...tseslint.configs.recommended,
    {
        ignores: ['build/**', 'node_modules/**', 'dist/**'],
    },
    {
        files: ['tests/**/*.ts'],
        languageOptions: {
            globals: globals.jest,
        },
    },
    {
        files: ['scripts/**/*.ts', 'tests/**/*.ts'],
        rules: {
            'no-console': 'off',
        },
    },
    {
        rules: {
            '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
        },
    },
);
