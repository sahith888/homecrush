# HomeCrush

Design and find your dream home, all live and through text.

**Live site:** [homecrush.sahiths.workers.dev](https://homecrush.sahiths.workers.dev/)

Build a furnished two-floor home with an AI guide, walk through it like a game, and explore real U.S. properties with a Tinder-inspired pass-and-heart experience. **Love knows no bounds.**

## What works

- A colored, furnished Three.js home with eight editable spaces across two floors, including the central hallway and upstairs landing.
- Iterative Gemma edits through a LangGraph workflow: understand, validate, apply, respond. One bounded repair attempt handles malformed model output; unsuccessful edits preserve the previous home.
- Alternate grouped edit output is normalized and validated; repairs receive the precise invalid setting. Rate limits show a retry countdown, while exhausted daily quota and hosting errors have distinct messages.
- Walking controls, connected stairs, collision detection, floor switching, room focus, day/golden-hour/night views, warm lighting, layered decorations, undo and redo.
- A text description generated from the house and loved rooms, with optional location, price and rent/buy preferences.
- Up to three real property cards with source photos, prices, links, evidenced feature matches, pass/heart/undo controls, and saved crushes.
- Device-local house, chat, revision and favorite persistence, plus JSON export and scene screenshots.

## Run locally

Use Node.js 24 (see `.nvmrc`).

```sh
npm ci
cp .dev.vars.example .dev.vars
npm run dev
```

Open the URL printed in the terminal, normally `http://localhost:5173`.

Add a Google AI Studio key to the ignored `.dev.vars` file to enable live edits:

```dotenv
GEMINI_API_KEY="your-key-here"
```

The key is read only by server routes. Without it, the designer runs clearly labeled deterministic preview edits. No key is included in this repository. Never rename it with a browser-exposed prefix such as `VITE_` or `NEXT_PUBLIC_`.

## Check and build

```sh
npm run check
npm run preview
```

`check` runs TypeScript, behavioral regressions and the production build. `preview` serves the built Worker locally. GitHub Actions runs these same checks on pushes and pull requests.

## Hosting

**Cloudflare Workers is the prepared deployment target.** This repository includes a standalone `wrangler.jsonc`, standard Vite configuration, and Worker entrypoint. It does not need a Codex session or the original ChatGPT Site's hosting identity.

The live Worker is connected to this repository. Pushes to `main` trigger a Cloudflare build and deployment. `GEMINI_API_KEY` is stored as an encrypted production runtime secret in Cloudflare.

See [the hosting guide](docs/HOSTING.md) for build settings, secrets, pricing considerations, and alternatives.

## Current limits

- The house uses a fixed layout and a supported object/parameter library. It does not produce arbitrary meshes or construction plans.
- Matching compares text features, not images or 3D geometry. It is not an exhaustive internet/MLS search.
- Broad discovery uses Google Search grounding with `gemini-3.8-flash`. When unavailable or quota-limited, the interface labels its fallback: a starter collection of 10 U.S. listing URLs researched on October 25, 2026. Every request rechecks source status and primary photo availability; closed/sold/inaccessible properties are excluded. Restrictive filters can return fewer than three homes or no results.
- The current listing adapter supports Compass individual property pages. Listing imagery may be staged, rendered, or show a similar floorplan; notices are shown where the source identifies that. Confirm availability on the source.
- Favorites and designs are saved in this browser, not synchronized between devices. Use JSON export to retain a copy before changing hosting origins.
- The standalone app has no login system. A private demo can be protected at the hosting layer; public AI access needs an appropriate request/usage limit.

## Architecture

| Area | Files |
| --- | --- |
| Studio and walkthrough controls | `components/home/Studio.tsx` |
| Three.js world and movement | `lib/home/engine.ts` |
| House schema and validated edits | `lib/home/schema.ts` |
| LangGraph / Gemma integration | `lib/home/workflow.ts` |
| Matchmaker UI | `components/home/Matches.tsx` |
| Text preferences and ranking | `lib/home/match-profile.ts`, `lib/home/matching.ts` |
| Listing discovery seeds | `lib/home/listing-sources.ts` |
| Server routes | `app/api/design`, `app/api/matches`, `app/api/status` |

Stack: React 19, TypeScript, Three.js, Vinext/Vite, Cloudflare Workers, LangGraph and Zod. The designer uses `gemma-4-26b-a4b-it` through the Gemini API. API timeouts, rate limits and invalid edits have distinct handling.

## License

[MIT](LICENSE). Model access and third-party dependencies remain subject to their own terms. The application does not redistribute Gemma weights or listing images.
