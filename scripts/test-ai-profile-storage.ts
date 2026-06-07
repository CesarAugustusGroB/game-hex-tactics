// Profiles persist to localStorage; load returns defaults when empty/corrupt. Run: npx tsx scripts/test-ai-profile-storage.ts
// Stub localStorage BEFORE calling load/save (the module reads it at call time, not import time).
const store = new Map<string, string>();
(globalThis as unknown as { localStorage: Storage }).localStorage = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => { store.set(k, v); },
  removeItem: (k: string) => { store.delete(k); },
  clear: () => store.clear(),
  key: () => null,
  length: 0,
} as Storage;

import { loadAiProfiles, saveAiProfiles, AI_PROFILES_KEY, profileFromDifficulty } from '../src/data/ai-profile';

let pass = 0, fail = 0;
const check = (name: string, cond: boolean, extra = '') => {
  console.log(`${cond ? '✓' : '✗'} ${name}${extra ? ` — ${extra}` : ''}`);
  if (cond) pass++; else fail++;
};

check('empty store → defaults (normal/normal)',
  loadAiProfiles().red.difficulty === 'normal' && loadAiProfiles().blue.difficulty === 'normal');

saveAiProfiles({ red: profileFromDifficulty('test'), blue: profileFromDifficulty('hard') });
const loaded = loadAiProfiles();
check('round-trips red', loaded.red.difficulty === 'test');
check('round-trips blue', loaded.blue.difficulty === 'hard');

store.set(AI_PROFILES_KEY, 'not json{');
check('corrupt JSON → defaults', loadAiProfiles().red.difficulty === 'normal');

store.set(AI_PROFILES_KEY, JSON.stringify({ red: profileFromDifficulty('easy') })); // missing blue
check('missing-side → defaults', loadAiProfiles().blue.difficulty === 'normal');

console.log(`\n${pass}/${pass + fail} passed`);
process.exit(fail > 0 ? 1 : 0);
