module.exports = {
  testEnvironment: 'node',
  setupFiles: ['jest-webextension-mock', './tests/setup.js'],
  testMatch: ['**/tests/**/*.test.js'],
  collectCoverageFrom: ['utils/**/*.js', 'scripts/**/*.js', 'background/**/*.js', 'popup/**/*.js'],
  transform: {
    '^.+\\.js$': ['babel-jest', { parserOpts: { allowReturnOutsideFunction: true } }]
  }
};
