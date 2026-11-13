export function testResourceNames(id: string) {
  if (!/^[a-f0-9]{16}$/.test(id)) throw new Error('Invalid ephemeral test run identifier');
  return {
    database: `niticket_${id}_test`,
    bucket: `niticket-test-${id}`,
    queue: `niticket-test-${id}`,
  };
}

export function assertEphemeralDatabase(url: string, expected: string) {
  if (!/^niticket_[a-f0-9]{16}_test$/.test(expected) || new URL(url).pathname !== `/${expected}`)
    throw new Error('Refusing cleanup outside this isolated test database');
}
