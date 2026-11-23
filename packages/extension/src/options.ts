import { browserKind, isPairingCode } from './util';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const code = $<HTMLInputElement>('code');
const saveMsg = $('saveMsg');
const status = $('status');

void chrome.storage.local.get('secret').then(({ secret }) => {
  if (typeof secret === 'string') code.value = secret;
});

$('save').addEventListener('click', () => {
  const v = code.value.trim().toLowerCase();
  if (!isPairingCode(v)) {
    saveMsg.textContent = 'That doesn’t look like a pairing code (letters a–f and digits only).';
    saveMsg.className = 'bad';
    return;
  }
  code.value = v;
  void chrome.storage.local.set({ secret: v }).then(() => {
    saveMsg.textContent = 'Saved. Connecting…';
    saveMsg.className = 'muted';
    void refreshStatus();
  });
});

interface Status { connected: boolean; paired: boolean; badCode: boolean }

async function refreshStatus(): Promise<void> {
  let s: Status | undefined;
  try { s = await chrome.runtime.sendMessage({ t: 'status' }); } catch { s = undefined; }
  if (s?.connected) { status.textContent = 'Connected'; status.className = 'ok'; }
  else if (s?.badCode) { status.textContent = 'Not connected: the desktop app rejected this code'; status.className = 'bad'; }
  else if (s && !s.paired) { status.textContent = 'Not connected: no pairing code saved'; status.className = 'bad'; }
  else { status.textContent = 'Not connected: is the desktop app running?'; status.className = 'bad'; }
}

const brands = (navigator as Navigator & { userAgentData?: { brands: { brand: string }[] } }).userAgentData?.brands;
$('extUrl').textContent = browserKind(brands) === 'edge' ? 'edge://extensions' : 'chrome://extensions';

async function recheck(): Promise<void> {
  let allowed: boolean;
  try {
    const r: { incognitoAllowed: boolean } | undefined = await chrome.runtime.sendMessage({ t: 'recheck' });
    allowed = r?.incognitoAllowed ?? (await chrome.extension.isAllowedIncognitoAccess());
  } catch {
    allowed = await chrome.extension.isAllowedIncognitoAccess();
  }
  $('incogOk').hidden = !allowed;
  $('incogSteps').hidden = allowed;
}

$('recheck').addEventListener('click', () => void recheck());

void refreshStatus();
void recheck();
setInterval(() => void refreshStatus(), 2000);
