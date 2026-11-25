import { petSprite } from '@study-buddy/core/buddy/sprite';
import { animalOf } from './panelLogic';
import { blockedMessage, continueUrl } from './util';

const params = new URLSearchParams(location.search);
const site = params.get('site') ?? '';

document.getElementById('msg')!.textContent = blockedMessage(params.get('until'));
document.getElementById('site')!.textContent = site;

void chrome.storage.local.get('lastState').then(({ lastState }) => {
  // The chosen animal, a little sad but kind (drawn once the animal is known, so no cat flashes by).
  document.getElementById('buddy')!.replaceChildren(petSprite(animalOf(lastState), 'sad', 140));
  const topic = (lastState as { topic?: unknown } | undefined)?.topic;
  if (typeof topic === 'string' && topic.trim() !== '') {
    const el = document.getElementById('topic')!;
    el.textContent = `Back to: ${topic}`;
    el.hidden = false;
  }
});

// "Continue to <site>" once blocking is off (break, turn-off sentence, session ended): a reload or
// restored tab must not leave the user stuck on this page.
const original = continueUrl(location.hash);
const cont = document.getElementById('continue') as HTMLAnchorElement;
if (original) cont.href = original;
cont.textContent = `Continue to ${site || 'the site'}`;
const showContinue = (state: unknown): void => {
  const blocking = (state as { blocking?: unknown } | undefined)?.blocking === true;
  cont.hidden = blocking || !original;
};
void chrome.storage.local.get('lastState').then(({ lastState }) => showContinue(lastState));
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && 'lastState' in changes) showContinue(changes.lastState.newValue);
});

// One hard-block-visit slip per page load; the background forwards it only if connected and blocking.
if (site) void chrome.runtime.sendMessage({ t: 'slip', target: site }).catch(() => {});

document.getElementById('back')!.addEventListener('click', () => {
  if (history.length > 1) { history.back(); return; }
  void chrome.tabs.getCurrent().then((tab) => {
    if (tab?.id !== undefined) void chrome.tabs.update(tab.id, { url: 'chrome://newtab/' });
  });
});
