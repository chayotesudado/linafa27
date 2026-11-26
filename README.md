# Linafa 27

Top-down arcade football in the browser. No build step and no dependencies.

**Play online:** https://chayotesudado.github.io/linafa27/

To play locally, open `index.html` in a browser (`xdg-open index.html`).

## Controls
| | Player 1 | Player 2 |
|---|---|---|
| Move | Arrow keys | WASD |
| Fire | Space | Left Shift |

Gamepads work too (pad 1 → P1, pad 2 → P2).

- **With the ball:** tap fire to pass (it auto-targets a teammate in the direction you face). Hold fire to shoot; the longer you hold, the harder the shot.
- **Aftertouch:** for half a second after any kick, push sideways to bend the ball, back to lift it (chips, crosses), or forward to keep it low.
- **Without the ball:** fire = slide tackle. If the ball is in the air nearby, fire = jump for a header.
- Control switches automatically to the teammate nearest the ball.
- The menu plays an 8-bit samba. It starts straight away if the browser allows autoplay; otherwise on the first click or key press anywhere (the menu shows a hint until then).
- Esc pauses, M mutes (in the menu too), C toggles the CRT scanline filter, ` (backtick) shows the frame rate.

The game runs at 80% of real time (`SPEED` in `game.js`).

## Teams
Edit `teams.js`. The format is documented at the top of the file. Each player is `["Name", "GK|DF|MF|FW", rating]`, or an object with individual stats (pace, shooting, passing, tackling, keeping).

## Styles of play
Each team has a `style` in `teams.js`, and the AI plays it for both CPU teams and the human team's off-ball players:

| Style | Plays like | Weak to |
|---|---|---|
| `positional` | Short passes, wingers on the touchline, swarms the ball for 5 s after losing it, high line. A one-two gives a burst of pace. | Balls over the top |
| `gegenpress` | Everyone near the ball charges it the moment it's lost, then straight forward and shoot fast. Narrow and high. | Fades as each half goes on |
| `lowblock` | Two deep, narrow lines and two forwards kept up. Presses only near its box, then goes long and sprints ("COUNTER!"). | Concedes possession and long shots |
| `direct` | Long balls to the forwards, team-mates crowd the knock-down, shoots from anywhere, centre-backs go up for corners. Harder, wilder headers and long shots. | Gives the ball away constantly |
| `manmark` | Everyone follows his man anywhere, defenders bomb on, lots of tackles. | Beat your man and there's no cover |
| `flair` | Crowds the ball, dribbles and skill moves, sudden switches to the one man left wide. Tricks work more often but fail badly. | The empty far side |

Every style is the same set of knobs (line height, pressing zone and counter-press, pass preferences, width, tempo, risk, transitions) with different values: see `STYLES` in `sim.js`. A possession clock forces a risky ball when a team goes nowhere for too long. When a team keeps pulling off its signature move (a long passing move, high turnovers, counter-attack shots, aerial wins, tricks), it goes *hot* for a few seconds and its traits are exaggerated ("ATB TIKI-TAKA!").

## Files
- `sim.js`: match simulation (physics, rules, AI). No DOM code, so it runs headless.
- `sprites.js`: player sprites (16x22 pixel art drawn at 2x, see `SCALE`), the crowd and the ball, all in the style of the sprite sheet. Standing and running use the hand-drawn grids from the sprite sheet (8 directions, 7 hairstyles, moustache/beard). Every other animation comes from the pose rig: a small 3D skeleton posed by joint angles, drawn in the same style with the hand-drawn head stamped on. Add an animation by adding a case to `poseParams`.
- `render.js`: stadium, crowd behaviour, officials, particles, the pixel-font HUD and banners. 640×400, 2 screen pixels per world unit.
- `game.js`: input, synthesised sound and jingles, menus, the demo match, the main loop.

## Rules
- **Fouls:** a slide that takes the man before the ball, or a standing tackle through the back of him. From behind or late is worse.
- **Advantage:** in their attacking half the ref waits a moment; if the fouled side keeps the ball, play on ("ADVANTAGE"). If they lose it within a couple of seconds, he brings it back for the free kick.
- **Free kicks:** defenders retreat ten yards. In shooting range they put up a wall of 2-5 men (they jump for a chipped one) and the attackers line up in the box, onside. Tap fire to pass, hold to shoot, aftertouch to bend it round the wall.
- **Penalties:** for fouls in the box. Everyone waits outside the box and the D; the keeper guesses a side.
- **Cards:** yellow for a reckless foul, red for a second yellow, a nasty one, or the last man stopping a clear run on goal. Cards are shown at the next stoppage; a sent-off player walks to the bench and his side plays a man down (red cards show under the score).
- **Offside:** judged when a team-mate plays the ball (not from throw-ins, corners or goal kicks); flagged when the offside player gets involved, for an indirect free kick. CPU strikers hold the line and CPU passers rarely pick out an offside man; you have to time it yourself.

## Not yet implemented
Substitutions, career mode.
