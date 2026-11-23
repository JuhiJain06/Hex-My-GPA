import { $, buddy, IPC } from './api';
import type { OfferAnswerMsg, PromptAnswerMsg } from '../shared/ipc';

const params = new URLSearchParams(location.search);
const exe = params.get('exe') ?? '';
const offer = params.get('kind') === 'offer';
const app = exe.replace(/\.exe$/i, '');

$('app').textContent = app;
$(offer ? 'offer' : 'gray').classList.remove('hidden');
$('q').textContent = offer ? `You've been in ${app} for 2 min. Block it during focus?` : 'Is this for study?';

const prompt = (study: boolean) => buddy.send(IPC.promptAnswer, { exe, study } satisfies PromptAnswerMsg);
const choose = (choice: OfferAnswerMsg['choice']) => buddy.send(IPC.offerAnswer, { exe, choice } satisfies OfferAnswerMsg);

$('yes').addEventListener('click', () => prompt(true));
$('no').addEventListener('click', () => prompt(false));
$('block').addEventListener('click', () => choose('block'));
$('fine').addEventListener('click', () => choose('fine'));
$('later').addEventListener('click', () => choose('later'));
