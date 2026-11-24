import { describe, test, expect, vi } from 'vitest';
import { clampHeight, MINI_H, MINI_MAX_H, SCREEN_MARGIN } from '../src/shared/layout';
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
  test('mini sizes are sane', () => {
    expect(MINI_H).toBeLessThan(MINI_MAX_H);
  });
});

describe('loggingGuardUi', () => {
  const fake = (): GuardUi => ({
    showOverlay: vi.fn(), hideOverlay: vi.fn(), showPrompt: vi.fn(), hidePrompt: vi.fn(), showOffer: vi.fn(),
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
