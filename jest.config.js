/** @type {import('jest').Config} */
module.exports = {
  preset: "ts-jest",
  testEnvironment: "node",
  roots: ["<rootDir>/src"],
  testMatch: ["**/*.test.ts"],
  collectCoverageFrom: [
    "src/**/*.ts",
    "!src/server.ts",
    "!src/config/env.ts",
    "!src/**/*.test.ts",
  ],
  coverageReporters: ["text", "lcov", "json-summary"],
  reporters: [
    "default",
    [
      "jest-junit",
      { outputDirectory: "reports", outputName: "junit.xml" },
    ],
  ],
  moduleFileExtensions: ["ts", "js", "json"],
};
