import { expect, it } from 'vitest';
import { assertEphemeralDatabase, testResourceNames } from '../../scripts/test-resources';

it('generates independent run namespaces and rejects cleanup outside the exact generated database', () => {
  const names = testResourceNames('0123456789abcdef');
  expect(names.queue).not.toBe(testResourceNames('fedcba9876543210').queue);
  expect(() =>
    assertEphemeralDatabase(`postgresql://test@localhost/${names.database}`, names.database),
  ).not.toThrow();
  for (const database of ['niticket', 'postgres', 'niticket_test'])
    expect(() =>
      assertEphemeralDatabase(`postgresql://test@localhost/${database}`, database),
    ).toThrow('Refusing cleanup');
  expect(() =>
    assertEphemeralDatabase('postgresql://test@localhost/niticket', names.database),
  ).toThrow();
  expect(() => testResourceNames('invalid; DROP DATABASE')).toThrow();
});
