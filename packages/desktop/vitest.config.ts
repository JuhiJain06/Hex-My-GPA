import { defineConfig } from 'vitest/config';
// The controller/check-in/app-guard simulations step a real sql.js db through hours of fake time and
// take ~4-10 s each, so the default 5 s timeout fails them whenever the machine is busy.
export default defineConfig({ test: { env: { TZ: 'Asia/Kolkata' }, testTimeout: 30_000 } });
