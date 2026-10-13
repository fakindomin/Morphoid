/** Writes registry.lock.json: run after adding a variant, commit with it. Refuses to drop or redefine a number. */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { lockOf, lockViolations, registry, type Lock } from '../src/core/catalog/registry';

const path = new URL('../registry.lock.json', import.meta.url);
const now = lockOf(registry());
const old: Lock = existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : {};
const bad = lockViolations(old, now);
if (bad.length) { console.error('Nie zapisano blokady:\n' + bad.join('\n')); process.exit(1); }
writeFileSync(path, JSON.stringify(now, null, 2) + '\n');
console.log('registry.lock.json zapisany');
