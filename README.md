# Void Runner

A retro pixel-art space shooter. Shoot the aliens, dodge the rocks, survive 100 waves.

Everything is in `index.html` — one self-contained file, no build step and no
dependencies. Open it in a browser, or drop it on any static host.

## Playing

- **Touch** — the ship goes wherever your finger is.
- **Keyboard** — left and right arrows.
- The gun is automatic. The ship only moves on one axis; the aliens only move
  on the other.

Aliens that get past you cost a life, and three of them ends the run. Rocks can
be shot apart, and the debris hurts anything nearby. Every tenth wave is a boss,
each one different, and beating one patches you back up.

## Deploying

Serve the directory as a static site. On Netlify: no build command, publish
from the root.
