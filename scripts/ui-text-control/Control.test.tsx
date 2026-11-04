it('a test file may hold an em dash — on purpose, and must NOT be flagged', () => {
  expect('—').toBe('—');
});
