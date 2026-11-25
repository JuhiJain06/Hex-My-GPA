import { $, buddy, IPC } from './api';
import type { OfferAnswerMsg, PromptAnswerMsg } from '../shared/ipc';
import { createClickArming } from '../shared/arming';

const params = new URLSearchParams(location.search);
const exe = params.get('exe') ?? '';
const offer = params.get('kind') === 'offer';
const app = exe.replace(/\.exe$/i, '');

$('app').textContent = app;
$(offer ? 'offer' : 'gray').classList.remove('hidden');
$('q').textContent = offer ? `You've been in ${app} for 2 min. Block it during focus?` : 'Is this for study?';

const prompt = (study: boolean) => buddy.send(IPC.promptAnswer, { exe, study } satisfies PromptAnswerMsg);
const choose = (choice: OfferAnswerMsg['choice']) => buddy.send(IPC.offerAnswer, { exe, choice } satisfies OfferAnswerMsg);

// Shown inactive, possibly right under the pointer: ignore clicks in its first 500 ms (click-through).
const arming = createClickArming(() => performance.now());
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') arming.shown(); });

$('yes').addEventListener('click', arming.guard(() => prompt(true)));
$('no').addEventListener('click', arming.guard(() => prompt(false)));
$('block').addEventListener('click', arming.guard(() => choose('block')));
$('fine').addEventListener('click', arming.guard(() => choose('fine')));
$('later').addEventListener('click', arming.guard(() => choose('later')));
