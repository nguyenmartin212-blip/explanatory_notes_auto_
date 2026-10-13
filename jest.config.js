export default {
    preset: 'jest-expo',

    testMatch: [
        '**/tests/**/*.test.ts',
        '**/tests/**/*.test.tsx',
    ],

    moduleNameMapper: {
        '^@/(.*)$': '<rootDir>/src/$1',
    },
};