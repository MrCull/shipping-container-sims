# Home page redesign mockups

Three static mockups of the main menu (`src/pages/HomePage.vue`), for the owner to choose a direction. Nothing here is wired into the app.

| File | Direction |
|---|---|
| `a-arcade.html` | Keeps the arcade identity and current tokens; pixel type only for the logo and small labels; one featured game, then a 2 by 2 grid of screenshot covers |
| `b-yard.html` | The page is a container stack: each game is a painted, corrugated box with stencilled lettering and an ISO 6346 number (valid check digits); planned games are empty slots |
| `c-daylight.html` | Light, daytime look; one wide row per game with the screenshot as the main thing |

`shots/` holds each one rendered at 1440 px and 390 px, plus the live page (`current-*`) for comparison. `img/` holds crops of `docs/readme/*-gameplay.png` and the Terminal Twin home card.

Progress lines ("level 3", "14 moves") and the build stamp are example values. The cookie notice is a corner toast in all three; it is hidden in the shots.
