# Home page: poster wall, Day blue

Source: mockup F (`docs/prototypes/home-redesign-2/f-bento.html?scheme=day-blue`), chosen by the owner in PR #342, with three follow-ups from the close-up review: brighter tile labels, a white "Continue" badge, and no "Sound on" text chip: the existing volume control (speaker button plus slider popover) stays and must still read as a volume control.

## What changes

1. **Layout** (`src/pages/HomePage.vue`): light page (paper `#eef1f5`, navy ink, blue `#1f6fd1` accent). Header: retro logo, GitHub link, `AudioControls` inline. Headline "Games about the boxes that move the world." with a short lede. Then the wall: first game is a large tile (7 of 12 columns), the next two stack to its right, the fourth is full width; any further games take half width. Then "Still being built": not-yet-playable sims and the future game teasers as dashed chips. Cookie notice and footer (copyright, GitHub, build stamp) restyled.
2. **Tiles** (`src/components/GameTile.vue`, new): the game's screenshot fills the tile, a dark navy scrim at the bottom, tags, title, text, a Play button, and "Your best: ..." from `progressSummary`. A link to the sim, tracked with the same `sim_card_click` event as before.
3. **Featured game**: the last game the player opened (remembered in local storage when a sim page opens) goes first and gets a "Continue" badge and button; with no history, the order from the definitions stands. Pure logic in `src/utils/lastPlayed.ts`, unit-tested.
4. **Cover images**: each sim's `cardImage` is now its home tile cover. New `assets/home-cover.jpg` for Stowage Master, Box Empire and Contenga (from the PR #342 captures); Terminal Twin keeps `home-card.png`.
5. **Removed**: `SimCard.vue`, `FutureGameCard.vue`, `HeroBackground.vue` (only the old home page used them).

## Checks

`pnpm run verify`; smoke specs touching the home page (`menu-music-volume`, `build-stamp`); screenshots at 1440 px and 390 px.
