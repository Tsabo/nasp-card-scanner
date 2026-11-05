# Alternative icon: "Scan the card"

A small score card (timing marks and bubbles) inside yellow scan brackets.
Kept as a ready-made alternative to the current "target in a viewfinder" icon.

To switch to it, copy these files over the ones in `assets/icons/`:

| Copy this                         | Over this                 |
| --------------------------------- | ------------------------- |
| `scan-the-card.svg`               | `icon.svg`                |
| `scan-the-card-32.png`            | `icon-32.png`             |
| `scan-the-card-192.png`           | `icon-192.png`            |
| `scan-the-card-512.png`           | `icon-512.png`            |
| `scan-the-card-maskable-512.png`  | `icon-maskable-512.png`   |
| `scan-the-card-apple-touch.png`   | `apple-touch-icon.png`    |

Then rebuild. Phones that already installed the app may keep the old icon
until it's removed from the home screen and added again.

The fine detail blurs at browser-tab size (16–32 px), so consider keeping the
target as the favicon (`icon.svg` and `icon-32.png`) even if you switch.
