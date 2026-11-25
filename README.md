# Study Buddy

A cute desktop study pet for Windows that keeps you focused through long study sessions.

Pick a pet (a wizard cat, fire fox, bamboo panda, hooded bunny, knight dog or alchemist hamster). It sits on your taskbar and studies along with you. While you focus it reads and writes, on breaks it relaxes, and when you step away it falls asleep. Its ears and tails move, and a speech bubble shows your timer.

## What it does

- **Focus and break rhythm:** 45 min focus / 10 min break, with a longer 25 min break every third time. You can change it in Settings.
- **Check-ins:** "Still on your topic?" every so often, answerable with one click or a hotkey. If you've stepped away, the timer pauses on its own.
- **Blocks distractions:**
  - Sites on your block list stay blocked until your break.
  - YouTube stays usable for study: Shorts and the feed are hidden, and each video asks "Is this for study?".
  - Distracting desktop apps get a gentle "Blocked until break" screen.
  - Claude, NotebookLM and Gemini are never blocked.
- **Focus sounds:** rain, brown noise, binaural beats, isochronic tones and pure tones.
- **Stats:** today's focus time, your streak, an end-of-session reflection and summary, and 30 days of history.
- **Firm mode:** turning blocking off mid-session means typing a sentence. If the app or the browser extension is closed mid-session, it's noted in your summary.
- **Private:** everything stays on your computer. There are no accounts and no cloud.

## Requirements

- Windows 10 or 11
- [Node.js](https://nodejs.org/) 20 or newer
- Google Chrome or Microsoft Edge (for website blocking)

## Install and run

```powershell
git clone https://github.com/<your-username>/hex-my-gpa.git
cd hex-my-gpa
npm install
npm run build
npm start
```

`npm start` opens Study Buddy. On first launch, Settings opens at the browser-extension pairing code.

### Add the browser extension (for website blocking)

1. Open `chrome://extensions` (or `edge://extensions`) and turn on **Developer mode**.
2. Click **Load unpacked** and choose the `packages/extension/dist` folder.
3. Open the extension's **Options**, paste the pairing code from Study Buddy's Settings, and save.
4. Optional: in the extension's **Details**, turn on **Allow in Incognito**.

## How to use

1. Type what you're studying, choose Laptop or Book mode, and optionally set a goal. Then press **Start**.
2. Your pet appears above the taskbar. Click it for the menu: +10 min, end block, sound, turn off blocking and end session.
3. Drag the pet anywhere you like.
4. End the session from the pet's menu to see your reflection and summary.

## Development

```powershell
npm test          # run all tests
npm run build     # build the desktop app and the extension
```

The code is an npm-workspaces monorepo:

- `packages/core`: timer, check-ins, stats, pets and moods (pure TypeScript)
- `packages/desktop`: the Electron app
- `packages/extension`: the Chrome/Edge extension

Design notes are in `docs/superpowers/`.

## License

[MIT](LICENSE)
