/** Assert a public approval token is not stored on a domain event row. */
export function assertDomainEventHasNoToken(
  event: {
    payload: unknown;
    trace_id: string;
    entity_id: string;
  },
  token: string,
): void {
  expect(event.trace_id).not.toBe(token);
  expect(event.entity_id).not.toContain(token);
  if (event.payload !== null && event.payload !== undefined) {
    expect(JSON.stringify(event.payload)).not.toContain(token);
  }
}
