import { describe, expect, it } from 'vitest';
import lockFile from '../registry.lock.json';
import { lockOf, lockViolations, registry } from '../src/core/catalog/registry';

describe('variant registry', () => {
  const now = lockOf(registry());
  const locked: Record<string, Record<string, string>> = lockFile;

  it('no released variant number is removed, redefined or handed out twice', () => {
    expect(lockViolations(locked, now)).toEqual([]);
  });

  it('every variant in the schema is recorded in the lock (run `npm run lock` after adding one)', () => {
    expect(now).toEqual(locked);
  });

  it('spots a renumbering', () => {
    const moved = structuredClone(now);
    moved.R!['02'] = 'devil';
    expect(lockViolations(now, moved).length).toBeGreaterThan(0);
  });
});
