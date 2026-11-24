import { $, buddy, IPC } from './api';
import { staticBuddy } from './buddy/live';

staticBuddy($('buddy'), 160, () => 'sad');

const params = new URLSearchParams(location.search);
const until = Number(params.get('until'));

/** HH:MM in local time. */
const hhmm = (ms: number): string => {
  const d = new Date(ms);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};

$('msg').textContent = params.get('until') && Number.isFinite(until)
  ? `Blocked until break at ${hhmm(until)}`
  : 'Blocked during focus';
$('label').textContent = params.get('label') ?? '';
$('back').textContent = `Back to ${params.get('topic') ?? 'studying'}`;
// Only hides the overlay: the user switches to their study app themselves.
$('back').addEventListener('click', () => buddy.send(IPC.overlayDismiss));
