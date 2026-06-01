const path = require('path');

const monorepoRoot = path.resolve(__dirname, '..', '..');

/** @type {import('jest').Config} */
module.exports = {
  moduleFileExtensions: ['js', 'json', 'ts'],
  rootDir: 'src',
  testRegex: '.*\\.spec\\.ts$',
  transform: {
    '^.+\\.(t|j)s$': [
      'ts-jest',
      { tsconfig: path.join(__dirname, 'tsconfig.json') },
    ],
  },
  collectCoverageFrom: ['**/*.(t|j)s', '!**/*.module.ts', '!**/main.ts', '!**/index.ts'],
  coverageDirectory: '../coverage',
  testEnvironment: 'node',
  moduleNameMapper: {
    // @transpro/shared → source directe (types, utils, enums)
    '^@transpro/shared$': path.join(monorepoRoot, 'packages/shared/src'),
    // @transpro/database → mock léger pour tests unitaires (évite d'instancier PrismaClient)
    '^@transpro/database$': '<rootDir>/common/test/mock-database.ts',
    // otplib a des dépendances ESM pures (@scure/base) incompatibles avec Jest CommonJS
    '^otplib$': '<rootDir>/common/test/__mocks__/otplib.ts',
  },
  coverageThreshold: {
    global: { branches: 60, functions: 70, lines: 70, statements: 70 },
  },
};
