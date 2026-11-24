# Sound credits

No audio files are bundled. Every sound in Study Buddy is generated in code at runtime
(`src/renderer/audio.ts`) with the Web Audio API:

- **Brown noise**: white noise passed through a leaky integrator, looped.
- **Rain**: pink-ish filtered noise plus sparse random droplet clicks, looped.
- **Binaural, isochronic and pure tones**: oscillators.

The **café** ambience is not included. It is pending a recording whose CC0 license can be verified.
The `'cafe'` value is still accepted in saved settings for compatibility and plays as "None".
The option is hidden in the UI.
