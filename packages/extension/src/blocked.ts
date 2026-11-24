import { drawBuddy } from '@study-buddy/core/buddy/draw';
import { animalOf } from './panelLogic';
import { blockedMessage } from './util';

const params = new URLSearchParams(location.search);
const site = params.get('site') ?? '';

document.getElementById('msg')!.textContent = blockedMessage(params.get('until'));
document.getElementById('site')!.textContent = site;

void chrome.storage.local.get('lastState').then(({ lastState }) => {
  // The chosen animal, a little sad but kind (drawn once the animal is known, so no cat flashes by).
  document.getElementById('buddy')!.replaceChildren(drawBuddy(animalOf(lastState), 'sad', 140));
  const topic = (lastState as { topic?: unknown } | undefined)?.topic;
  if (typeof topic === 'string' && topic.trim() !== '') {
    const el = document.getElementById('topic')!;
    el.textContent = `Back to: ${topic}`;
    el.hidden = false;
  }
});

// One hard-block-visit slip per page load; the background forwards it if connected, else drops it.
if (site) void chrome.runtime.sendMessage({ t: 'slip', target: site }).catch(() => {});

document.getElementById('back')!.addEventListener('click', () => {
  if (history.length > 1) { history.back(); return; }
  void chrome.tabs.getCurrent().then((tab) => {
    if (tab?.id !== undefined) void chrome.tabs.update(tab.id, { url: 'chrome://newtab/' });
  });
});
