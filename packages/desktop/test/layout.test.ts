import { describe, test, expect, vi } from 'vitest';
import { ANIMALS } from '@study-buddy/core';
import { spriteWidth } from '@study-buddy/core/buddy/sprite';
import { clampHeight, PET_ART_H, PET_BUBBLE_ROOM, PET_FOOT_GAP, PET_H, PET_W, SCREEN_MARGIN, stackBounds, type StackSlot } from '../src/shared/layout';
import { createClickArming } from '../src/shared/arming';
import { loggingGuardUi, type GuardUi } from '../src/main/appGuard';

describe('clampHeight', () => {
  test('keeps heights that fit', () => {
    expect(clampHeight(700, 1040)).toBe(700);
    expect(clampHeight(1000, 1040)).toBe(1000);
  });
  test('clamps to the work area minus the margin', () => {
    expect(clampHeight(700, 680)).toBe(680 - SCREEN_MARGIN);
    expect(clampHeight(1001, 1040)).toBe(1000);
  });
  test('never below 100 px', () => {
    expect(clampHeight(700, 50)).toBe(100);
  });
  test('the pet window is small (about 200 x 220)', () => {
    expect(PET_W).toBeGreaterThanOrEqual(180);
    expect(PET_W).toBeLessThanOrEqual(220);
    expect(PET_H).toBeGreaterThanOrEqual(200);
    expect(PET_H).toBeLessThanOrEqual(240);
  });
  test('the pet art is about 150 px tall, every animal fits the width, and the bubble fits above its head', () => {
    expect(PET_ART_H).toBe(150);
    for (const a of ANIMALS) expect(spriteWidth(a.id, PET_ART_H), a.id).toBeLessThanOrEqual(PET_W - 16);
    expect(PET_FOOT_GAP + PET_ART_H + PET_BUBBLE_ROOM).toBeLessThanOrEqual(PET_H);
    expect(PET_BUBBLE_ROOM).toBeGreaterThanOrEqual(60); // the planned-length notice with its two buttons
  });
});

describe('loggingGuardUi', () => {
  const fake = (): GuardUi => ({
    showOverlay: vi.fn(), hideOverlay: vi.fn(), showPrompt: vi.fn(), hidePrompt: vi.fn(), showOffer: vi.fn(), hideOffer: vi.fn(),
  });

  test('logs and forwards every call normally', () => {
    const ui = fake();
    const log = vi.fn();
    const g = loggingGuardUi(ui, log, false);
    g.showOverlay({ label: 'x', until: null });
    g.hideOverlay();
    g.showPrompt('a.exe');
    g.hidePrompt();
    g.showOffer('b.exe');
    expect(ui.showOverlay).toHaveBeenCalledWith({ label: 'x', until: null });
    expect(ui.hideOverlay).toHaveBeenCalled();
    expect(ui.showPrompt).toHaveBeenCalledWith('a.exe');
    expect(ui.hidePrompt).toHaveBeenCalled();
    expect(ui.showOffer).toHaveBeenCalledWith('b.exe');
    expect(log).toHaveBeenCalledTimes(5);
  });

  test('with noGuard it only logs: no overlay, prompt or offer is shown', () => {
    const ui = fake();
    const log = vi.fn();
    const g = loggingGuardUi(ui, log, true);
    g.showOverlay({ label: 'x', until: 5 });
    g.hideOverlay();
    g.showPrompt('a.exe');
    g.hidePrompt();
    g.showOffer('b.exe');
    for (const fn of Object.values(ui)) expect(fn).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalledTimes(5);
    expect(log.mock.calls[0]!.join(' ')).toMatch(/NO_GUARD/);
  });
});

describe('stackBounds (I1: prompts never share a slot)', () => {
  const wa = { x: 0, y: 0, width: 1920, height: 1040 };
  const slots: StackSlot[] = ['checkin-laptop', 'checkin-book', 'prompt', 'offer'];
  const overlap = (a: ReturnType<typeof stackBounds>, b: ReturnType<typeof stackBounds>) =>
    a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

  test('the check-in (either mode), gray prompt and offer never overlap, and all fit the work area', () => {
    for (const area of [wa, { x: 100, y: 50, width: 1280, height: 680 }]) {
      const r = Object.fromEntries(slots.map((s) => [s, stackBounds(s, area)]));
      for (const a of slots) {
        expect(r[a].x + r[a].width).toBeLessThanOrEqual(area.x + area.width);
        expect(r[a].y).toBeGreaterThanOrEqual(area.y);
        expect(r[a].y + r[a].height).toBeLessThanOrEqual(area.y + area.height);
      }
      for (const c of ['checkin-laptop', 'checkin-book'] as const) {
        expect(overlap(r[c], r.prompt)).toBe(false);
        expect(overlap(r[c], r.offer)).toBe(false);
      }
      expect(overlap(r.prompt, r.offer)).toBe(false);
    }
  });

  test('the check-in sits bottom-right; the prompt above it', () => {
    const c = stackBounds('checkin-laptop', wa);
    expect(c.x + c.width).toBe(1920 - 16);
    expect(c.y + c.height).toBe(1040 - 16);
    expect(stackBounds('prompt', wa).y).toBeLessThan(stackBounds('checkin-book', wa).y);
  });
});

describe('createClickArming (I1: no click-through answers)', () => {
  test('clicks within 500 ms of being shown are ignored; re-showing re-arms', () => {
    let t = 1000;
    const arm = createClickArming(() => t);
    expect(arm.ready()).toBe(false);
    t += 499;
    expect(arm.ready()).toBe(false);
    t += 1;
    expect(arm.ready()).toBe(true);
    arm.shown();
    t += 200;
    expect(arm.ready()).toBe(false);
    t += 300;
    expect(arm.ready()).toBe(true);
  });

  test('guard() wraps a handler so it only runs when armed', () => {
    let t = 0;
    const arm = createClickArming(() => t);
    const hits: number[] = [];
    const h = arm.guard(() => hits.push(t));
    h();
    t = 600;
    h();
    expect(hits).toEqual([600]);
  });
});
