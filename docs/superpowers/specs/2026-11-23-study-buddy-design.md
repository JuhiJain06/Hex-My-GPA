# Study Buddy — Design

Date: 2026-11-23
Status: Approved 2026-11-23

## Intent and why

The user wants to study continuously for long hours. Four things break their sessions today, and the user said all four happen:

1. **Distractions** pull them away to other sites.
2. **Their mind wanders** while they're still at the desk.
3. **Their energy runs out** after an hour or two.
4. **Studying alone** is hard to stick with.

They study mostly on a Windows laptop (videos, PDFs, notes) and sometimes from books. Study Buddy is a personal tool that sits with them during a session and pushes back on each of the four problems.

## Goals

- Keep the user on task in the browser and on the desktop during a session.
- Make drifting visible without being so annoying that the user turns it off.
- Pace long sessions with focus blocks and breaks so energy lasts.
- Feel like a companion that keeps count: a visible timer, today's total, a streak.
- Work for both laptop study and book study.

## Non-goals

- Blocking the phone. Nothing on the laptop can do that, so the app at most reminds the user to put the phone away when a session starts.
- Accounts, cloud sync, multiple users, mobile app.
- Judging whether study content is "good". The buddy trusts the user's one-click answers.

## Later (not in the first version)

- A weekly chart of the hours when the user focuses best.
- A daily plan that pre-fills each session's topic.

## Anti-goals (failure even if it technically works)

- **Getting in the way of real study.** YouTube, Claude (claude.ai) and Gemini/NotebookLM are study tools. Blocking them, or nagging the user while they use Claude and NotebookLM, makes the tool worthless.
- **Check-ins that break flow.** Every prompt must be answerable in one click or one key.
- **Easy to bypass on impulse.** A one-click "turn off blocking" mid-session defeats the point.

## Approaches considered

1. **Browser extension only (Chrome/Edge).** Handles every web behaviour below and is simplest to build, but it can't see desktop apps.
2. **Windows desktop app only.** Sees every app and gives an always-on-top companion, but it can't hide YouTube Shorts or the feed, or ask per video. Blocking websites needs hosts-file edits or admin rights.
3. **Both: desktop app + browser extension talking to each other.** Covers everything, at roughly twice the build.

**Chosen: 3 (user's pick).** Claude recommended 1. The user chose full coverage, including desktop apps, over getting something usable sooner.

## Behaviour

### Starting a session

The user starts a session from the desktop app (or the extension side panel). They enter:

- **Topic:** free text, e.g. "Physics ch. 4 — numericals".
- **Mode:** Laptop or Book.
- **Planned length:** optional, e.g. 3 hours. It's open-ended if left blank.

- **Goal:** what "done" looks like for this session, e.g. "finish 20 numericals". Optional, but the start screen nudges for it.

On start, the app shows a one-line reminder: "Phone in another room?"

### End-of-session reflection (user asked for this)

- When a session ends, before the summary, the buddy asks:
  1. "Did you reach your goal?" with **Yes / Partly / No**.
  2. "What got in the way?" with one-click tags (Phone, Tired, Wandering mind, Distracting site, Hard material, Interrupted) plus an optional free-text note.
- Answers are saved with the session. The history view shows which tags come up most over the last 30 days, so the user can see what actually breaks their focus.
- Skipping the reflection is allowed but takes one click. *(Claude's call.)*

### Focus/break pacing (energy)

- Default rhythm: **45 min focus / 10 min break**, and every third break is **25 min**. This is Claude's call, and the user can change it in settings.
- The break starts with a clear signal (sound + window). When a break ends, the app prompts "Back to <topic>?" and the next block starts on one click.
- While a break is on, hard-blocked sites and apps unlock. They lock again when the next focus block starts.
- The user can end a block early or extend it by 10 minutes.

**Break suggestions (user asked for this):**
- Each break starts with one off-screen suggestion that fits its length, e.g. "Stand up and stretch", "Drink water", "Look out a window for 20 s" for short breaks, and "Walk around", "Eat something" for long ones. Suggestions rotate so they don't repeat back to back.
- At **1 minute left**, a clear countdown plays (sound + window), and at 0 it prompts "Back to <topic>?" so breaks don't quietly run long.
- If the user doesn't start the next block within 3 min after a break ends, it counts as overrun and shows in the summary. *(Claude's call.)*

### Site lists (distractions)

There are three lists, all editable in settings:

| List | Default contents | During focus |
|---|---|---|
| **Always fine** | claude.ai, notebooklm.google.com, gemini.google.com | Never interrupts. |
| **Gray zone** | youtube.com | Allowed, with the YouTube rules below. |
| **Hard block** | instagram.com, facebook.com, x.com, reddit.com, netflix.com, common game sites | The page won't load. A "blocked until break at 4:30" screen shows instead. |

Any site not on a list is treated as fine (Claude's call: the safe default against blocking real study).

**YouTube rules during focus:**
- **Shorts are blocked** (any `/shorts/` URL).
- **The home feed, recommendations sidebar, and end-screen suggestions are hidden.** Search and the video itself still work.
- **Opening a video asks once, "Is this for study?"** It's a one-click yes or no. A yes means no further prompts for that video. A no, or no answer within 30 s, counts as a **slip** and shows a "Back to <topic>?" reminder. The video keeps playing; nothing is blocked. If the user is still on it 5 min later, it asks again and logs another slip. *(Claude's call.)*

### Desktop apps (distractions)

- The desktop app watches which app is in the foreground.
- Apps go on the same three lists (fine / gray / hard block). Defaults: browsers and study tools (PDF readers, note apps) are fine. Hard-block starts empty, and the app offers to add any non-fine app the user spends over 2 minutes in.
- **Browsers count as "fine" only while their extension is connected** (see Firm mode below).
- **A hard-blocked app** gets a full-screen "Blocked until break" overlay over it while it's in front. The app isn't killed, so no work is lost.
- **A gray-zone app** gets the same "Is this for study?" prompt as a YouTube video.

### Check-ins (wandering mind)

- These are small prompts that never take focus away from what the user is typing in. They're answerable with one click or a hotkey.
- **Laptop mode:** about every 25 min, "Still on <topic>?" with **Yes / Switched topic / Drifted**.
- **Book mode:** about every 15 min, "Still on <topic>? Pages since last check?" with a quick number or Yes / Drifted.
- Intervals are randomised ±5 min so they don't become background noise.
- Unanswered for 2 min (laptop mode) or 5 min (book mode) means the user is probably away. The timer pauses and doesn't count that time. *(Claude's call.)*
- **Book mode check-ins play a soft chime** and appear larger, since the user isn't looking at the screen. *(Claude's call.)*
- **While paused**, the focus block's countdown freezes (the break moves later), blocking stays on, and the pause ends on answering the check-in or any keyboard/mouse input. Paused time doesn't count toward today's total or the streak. *(Claude's call.)*
- Site and app blocking apply in both modes.

### Companion and stats (studying alone)

- **An always-on-top mini window** (draggable, small) shows: current topic, time left in block, today's total focus time, and streak.
- **Today's total** counts only focus time, not breaks or paused time.
- **Streak:** consecutive days with at least a minimum of focus time (default 2 h, adjustable).
- **End-of-session summary:** total focus, blocks completed, slips (with which sites/apps), check-in answers, and a comparison with the user's average.
- **History view:** daily totals for the last 30 days.

### Focus sounds (user asked for this)

- Built-in sounds play during focus blocks and fade out at breaks: **ambient** (rain, brown noise, café) and **frequencies**.
- **Frequencies** are generated in-app (no audio files needed), so pitch and beat can be adjusted:
  - **Binaural beats** (headphones required; the app says so): e.g. 40 Hz gamma ("focus"), ~10 Hz alpha ("calm focus"), ~14–18 Hz beta ("alert").
  - **Isochronic tones** (work on speakers too), at the same beat rates.
  - **Pure tones**, e.g. 432 Hz / 528 Hz, for users who like them.
- Frequencies can play alone or layered under an ambient sound, with separate volume sliders.
- The last choice is remembered and starts automatically with the next session; a mute hotkey is always available.
- Research on binaural beats for focus is mixed; the app presents them as an option, not a promise. *(Claude's call.)*

### Bypass friction

- During focus, blocking can't be turned off with one click. Turning it off requires **typing a sentence** ("I am choosing to stop studying") and is logged in the session summary. It unlocks both sites and apps **until the next break**; check-ins keep running. *(Claude's call.)*
- Ending the whole session is always allowed. It's the honest way out, and it shows in stats.

**Firm mode (user's choice).** The easy escapes are closed or logged during focus. It still can't be made *impossible* to get around without admin-level lockdown, which is out of scope.
- **Browsers without the extension:** During focus, any browser window whose extension isn't connected to the desktop app (Firefox, a Chrome profile without it, etc.) gets the full-screen "Blocked until break" overlay, the same as a hard-blocked app.
- **Incognito:** On first setup, the buddy walks the user through turning on "Allow in Incognito" for the extension. If an Incognito window opens during focus and the extension doesn't report from it, the window gets the overlay.
- **Extension switched off or removed mid-session:** The desktop app notices the connection drop and treats every browser as unconnected (overlay). It also logs a "bypass" slip.
- **Desktop app closed mid-session:** A small watchdog process restarts it and logs a "bypass" slip. Ending the session properly stops the watchdog.
- **The end-of-session summary** lists every bypass event separately from ordinary slips.

### When one half isn't running

- **Extension without the desktop app:** if it loses contact mid-block, it keeps blocking with the last-known lists **until that block's scheduled end time**, then stops blocking (so a crash never locks sites forever). Outside a known focus block it does nothing. It shows "Desktop buddy not running" in the side panel and doesn't run its own timer. *(Claude's call.)*
- **Desktop app without the extension:** the timer, check-ins, and app watching all work. It shows "Browser buddy not connected — websites aren't being watched".

## How it gets made (Claude's calls, user can override)

- **The desktop app is the source of truth.** It owns session state, timer, lists, settings, and history. The extension is a thin client that enforces web rules and reports web events.
- **The desktop app is built with Electron (Node.js).** This means the same language as the extension and an easy always-on-top window. Foreground-app detection uses a native active-window library.
- **The browser extension is Chrome Manifest V3**, which also works in Edge. It uses `declarativeNetRequest` for hard blocks, a content script on YouTube for Shorts/feed hiding and the study prompt, and a side panel showing the same info as the mini window.
- **The two parts talk over a local WebSocket on localhost only**, with a shared secret generated at install. Nothing leaves the machine.
- **Storage:** a local SQLite file in the user's app-data folder.
- **Windows only** for now.

## Left to the builder

- Project structure, libraries (beyond the choices above), and test approach.
- Exact UI styling, which should be calm and unobtrusive.
- The exact default game-site list.
- Packaging/installer approach for the desktop app, and how the extension is loaded (unpacked is fine for a personal tool).
- Build order. A sensible order is: desktop timer + mini window, then the extension with blocking, then the link between them, then check-ins, then stats.

## Addendum (2026-11-25): Cute animal companion and pastel look

User request: "make it cute animal like". User chose: pick the animal in Settings, offer a variety of animals including a fox, and give the whole app a soft pastel look.

### Animal companion
- **Animals (6):** Cat, Fox, Panda, Bunny, Penguin, Hamster. Default: Cat. Chosen in Settings ("Your study buddy") with a preview of each; the choice is saved in settings.
- **Original art, drawn in code:** each animal is a simple, round, chibi-style SVG built from shapes (no image files, no copied characters). All animals share one face/pose system so moods work the same for every animal.
- **Where it appears:** the mini window (small, beside the timer), the break window (larger), the start window (waving), and the summary (happy, or encouraging if the session was short).
- **Moods, driven by app state:**
  | State | Mood |
  |---|---|
  | Idle / start screen | Waves hello |
  | Focus | Content, gentle breathing, occasional blink; "studying" prop (tiny book) |
  | Break | Stretches, then relaxed; holds a cup |
  | 1-minute warning / "Back to topic?" | Perks up, looks at you |
  | Paused (away) | Curls up asleep, "z z" |
  | Slip / drifted / blocked app or site | Briefly sad (3 s), then back to content — never scolding |
  | Planned length reached / session summary | Celebrates (little hearts/sparkles) |
- **Animations:** subtle CSS animations only (breathing, blinking, tail/ear wiggle). Respect `prefers-reduced-motion` (static poses).
- **Calm rule still applies:** the animal never pops up on its own or makes sound; it only lives inside existing windows.

### Pastel look
- One shared theme (`common.css` tokens): soft pastel palette (cream background, peach/mint/lavender accents), rounded corners, rounded friendly font stack, gentle shadows. Applied to all desktop windows and the extension pages (blocked page, side panel, options, YouTube prompt card).
- Text contrast stays readable (WCAG AA for body text). Dark mode gets a matching muted pastel-on-dark variant.
- The blocked page and overlay show the chosen animal looking a little sad but kind: "Blocked until break at HH:MM".
- The extension gets the chosen animal via the existing state message (add `animal` field).

## Addendum 2 (2026-11-26): Desktop pet that studies along

User request: "make it like a cute pet that show up on screen and studies along". User chose: the pet **sits on the taskbar** (draggable), and the pet **replaces the mini timer window**.

- **The pet window:** a small transparent, frameless, always-on-top window (about 200×220) that sits just above the taskbar in the bottom-right corner by default. It has no taskbar button. The user can drag the pet anywhere; the position is remembered (per display, clamped on-screen). Clicks on empty, transparent areas pass straight through to the apps underneath — only the pet, its bubble and its menu catch the mouse.
- **Studies along:** the pet has its own tiny desk and lamp. In focus it reads, writes in a notebook, turns pages and occasionally sips from a mug (gentle looping animation, never fast or flashy). Break: it stretches, then relaxes. Away/paused: dozes at the desk. Slip: briefly sad. Celebrate: happy bounce with hearts. Same 6 animals and mood rules as Addendum 1.
- **Speech bubble** above the pet shows the essentials: time left in the block (mm:ss), "Paused", or "Break · 4:12". One-off messages appear in the bubble for a few seconds instead of in the old mini window: "Phone in another room?" at start, the planned-length banner (with End session / Keep going), and "Browser buddy not connected — websites aren't being watched". The bubble can be turned off in Settings (the pet still shows).
- **Click the pet** → a small menu pops up beside it with today's total, streak, and the old mini buttons: +10 min, End block, Turn off blocking, Sound…, End session. Clicking elsewhere or pressing Esc closes it.
- **The mini window is removed.** Everything it did moves to the pet: it hosts the focus sounds (and the end-of-session fade), receives the state/engine broadcasts, and is shown/hidden by the same session lifecycle (shown on session start/restore, faded and closed at session end).
- **Stacking:** the pet is always-on-top at a normal level, below the block overlay, check-ins and prompts.
- **Settings:** "Your study buddy" section gains *Show speech bubble* (on by default) and *Reset pet position*.
- **Calm rule still applies:** the pet never walks around, never makes sounds of its own, never steals focus (the pet window is non-focusable except while its menu is open), and respects reduced-motion.

## Addendum 3 (2026-11-26): The user's own character art

The user rejected the code-drawn styles (pastel chibi, pixel, doodle) and supplied a character sheet to use exactly as drawn ("Use these"; approved the cutout preview and mood plan: "Yes, build it").

- **Animals change to:** Cat (wizard), Fox (fire, lantern), Panda (bamboo ranger), Bunny (hooded cloak), **Dog** (knight, replaces Penguin), Hamster (alchemist). Default: Cat. Saved settings with `penguin` migrate to `dog`.
- **Art:** the six transparent PNG cutouts in `packages/core/buddy/art/` (cut from `source-sheet.webp` by `cutout.py`) are the pets, unaltered. No code-drawn animals remain in the UI.
- **Moods:** one pose per pet; moods are shown with small sketch-style doodle overlays and gentle CSS motion around the unchanged art:
  - wave/idle: a small hop; study: gentle breathe/bob; break: stretch hop + steaming-mug doodle; alert: "!" doodle; sleep: slightly dimmed + floating "z z"; sad (drift, 3 s): sweat-drop doodle + tiny shake; celebrate: hearts + sparkles.
  - All motion off under reduced-motion (overlays still shown).
- **Desk scene removed.** The pet stands directly on the taskbar (~150 px tall), speech bubble above, same click menu/drag/click-through as Addendum 2. Click-through hit-testing uses the image's alpha (not the bounding box).
- **Everywhere the animal appears** (pet window, start, break, summary, overlay, Settings picker, extension blocked page and side panel) uses the same PNGs.
- **Personal use:** the bunny closely follows a third-party drawing; the app is for the user's own use.

## Addendum 4 (2026-11-26): Mood scenes with ear and tail motion

The user supplied a studying / on break / asleep (away) sheet for each pet ("use these add a little animation in each like a movement"), approved the animated preview, asked that fox and bunny ears not be clipped, and asked for ear and tail movement on **all six pets** ("Yes, all six pets").

- **Scenes:** 18 transparent PNGs in `packages/core/buddy/art/scenes/{animal}-{study|break|sleep}.png` (cut from `art/sheets/*.webp` by `art/cut-scenes.py`), shown unaltered apart from motion.
- **Mood → picture:** study → `-study` scene; break → `-break` scene (+ "!" doodle in alert/last minute and awaitingNext); sleep (paused/away) → `-sleep` scene; sad (drift, 3 s) → `-study` scene with sweat-drop doodle + tiny shake; wave (idle/start) and celebrate → the standing pose from Addendum 3 (+ hearts/sparkles for celebrate).
- **Whole-picture motion (CSS):** study = slow breathing; break = gentle sway; sleep = deeper slower breathing + floating "z" doodles that rise and fade; study also has a few twinkling sparkles; break has rising steam wisps.
- **Part motion (ears and tails):** each scene and standing pose has a small rig of parts (ear/tail: base point → tip point). Parts bend with a smooth inverse-mapped rotation about the base with weight rising toward the tip and soft radial falloff (no duplicated pixels). Ears: small sway plus an occasional quick twitch, parts slightly out of phase; tails: slow swish. Asleep: much smaller and slower, no twitch. Pets where a part is hidden (e.g. a curled-under tail) simply have no rig for it.
- **Reduced motion:** all whole-picture and part motion off; doodles still shown statically.
- **Performance:** part warp only touches each part's bounding box, ~30 fps, and pauses when the pet window is hidden.
- **Size:** scenes are wider than standing poses; on the taskbar the pet is ~150 px tall and up to ~320 px wide; click-through still uses the picture's alpha.
