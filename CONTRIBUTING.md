# Working on the code

The app is written in TypeScript and compiled to plain JavaScript that runs in the browser. There's no framework. The page loads `index.html`, which loads the compiled `js/app/main.js`, which imports everything else.

## Setup

You need [Node.js](https://nodejs.org) 22.18 or later. It's only used for the development tools; the published site is static files.

```sh
npm install      # installs the tools listed in package.json (like dotnet restore)
npm start        # builds the site and serves it at http://localhost:8000
npm run check    # formatting, type checks and tests (what GitHub runs)
```

| Command             | What it does                                                                   | .NET equivalent  |
| ------------------- | ------------------------------------------------------------------------------ | ---------------- |
| `npm run build`     | Compiles `src/` into `_site/js/` and assembles the site in `_site/`            | `dotnet publish` |
| `npm start`         | Builds, then serves `_site/` on this computer                                  | `dotnet run`     |
| `npm run watch`     | Recompiles the TypeScript whenever you save; reload the browser to see changes | `dotnet watch`   |
| `npm test`          | Runs the tests in `tests/` with Node's built-in test runner                    | `dotnet test`    |
| `npm run typecheck` | Type-checks everything without writing any files                               | `dotnet build`   |
| `npm run format`    | Prettier rewrites every file in the standard layout                            | `dotnet format`  |

For day-to-day work, run `npm start` once, then `npm run watch` in a second terminal, and reload the page after each change. If you change `index.html`, the CSS or the assets, run `npm run build` again, since only TypeScript is watched.

In VS Code, install the **Prettier** extension and turn on format-on-save. Type errors show as you type with no extra setup.

## Conventions

| Thing                            | Style                    | Example                             |
| -------------------------------- | ------------------------ | ----------------------------------- |
| Files                            | kebab-case               | `log-store.ts`                      |
| Classes, interfaces, types       | PascalCase               | `LogStore`, `ScorecardSummary`      |
| Functions, variables, properties | camelCase                | `summarizeScorecard`, `arrowScores` |
| Module-level constants           | UPPER_SNAKE_CASE         | `ARROW_COUNT`                       |
| CSS classes and element ids      | kebab-case               | `.round-total`, `#archer-input`     |
| State classes in CSS             | `is-` or `needs-` prefix | `.is-ten`, `.needs-review`          |

Some other habits:

- Use full words in names (`arrowIndex`, not `i` or `ai`). Short names are fine only for coordinates (`x`, `y`).
- Every exported function, class and interface has a `/** … */` comment saying what it does. Comments say why, not just what. Types go in the code, not the comments.
- Name tuning numbers as constants at the top of the file, with a comment saying what they control.
- Use `const` by default and `let` only when the value changes.
- Use `===`, never `==`.
- Import types with `import type`, so it's clear they disappear at compile time.

### TypeScript for C# developers

Most of it will look familiar. The differences worth knowing:

| C#                                      | TypeScript                                                                    |
| --------------------------------------- | ----------------------------------------------------------------------------- |
| `int? score`                            | `score: number \| null`                                                       |
| `record ScorecardSummary(int Total, …)` | `interface ScorecardSummary { total: number; … }`                             |
| `List<int>`, `IReadOnlyList<int>`       | `number[]`, `readonly number[]`                                               |
| `Dictionary<string, int>`               | `Map<string, number>` or `Record<string, number>`                             |
| `public` / `private` / `readonly`       | Same keywords; members are public by default                                  |
| `namespace` + `using`                   | Each file is a module: `export` makes something public, `import` brings it in |
| `enum BadgeKind { Sample, Read }`       | `type BadgeKind = "sample" \| "read"` (a union of string values)              |
| `Task<T>`, `async`/`await`              | `Promise<T>`, `async`/`await`                                                 |
| `obj as Foo` (checked cast)             | `obj as Foo` is unchecked; it only tells the compiler to trust you            |

Interfaces are structural: any object with the right properties counts, whether or not it says `implements`. And the types exist only at compile time. At run time it's plain JavaScript, so data from outside (local storage, a CSV file) has to be checked by hand, as `normalizeStoredScorecard` and `readImportedScorecard` do.

The project only uses TypeScript features that compile by deleting the types: no `enum`, no `namespace`, and no constructor parameter properties. That's what lets Node run the tests and build scripts directly from `.ts` files. The compiler reports an error if one of those features sneaks in.

### Why there's no ESLint

ESLint's TypeScript plugin doesn't support TypeScript 7 yet. In its place, the compiler's extra checks are switched on in `tsconfig.base.json` (unused code, missing returns, switch fall-through), which cover most of what ESLint caught here. When the plugin supports TypeScript 7, it's worth adding back.

## Project layout

```
index.html                 The page
css/styles.css             All styles; colours are variables at the top, with a dark-mode set
src/
  app/                     The page's behaviour
    main.ts                Starts the app and connects buttons to the parts below
    photo-panel.ts         Shows the photo and runs the reader
    reader-overlay.ts      Draws what the reader saw over the photo
    image-loading.ts       Opens and scales photo files
    score-sheet.ts         The editable arrows, totals and review list
    archer-fields.ts       How the archer and Shooter # fill each other in (pure functions)
    scoring.ts             NASP scoring rules (pure functions)
    scorecard.ts           The saved-scorecard record, and what makes one valid
    scorecard-format.ts    Bullseye and 3D, and the rotation of animals
    log-store.ts           Saves scorecards in the browser's local storage
    log-table.ts           The format tabs and table of saved scorecards
    csv.ts                 Export tables, CSV export and import, and spreadsheet copy
    xlsx.ts                Writes the Excel workbook (no outside libraries)
    dates.ts               Today's date in local time
    page-helpers.ts        Small helpers for finding and creating elements
  reader/                  The bubble reader (no page code; also runs in Node for tests)
    analyze-card.ts        Entry point: runs the steps below in order
    card-layout.ts         The card's measured geometry
    image-maps.ts          Step 1: removes lighting and paper colour
    mark-candidates.ts     Step 2: finds small dark bars
    timing-track.ts        Step 3: picks out the column of timing marks
    track-alignment.ts     Step 4: works out which mark is which row
    bubble-grid.ts         Step 5: fits the bubble grid to the printed ovals
    mark-reading.ts        Step 6: decides which bubble is filled
    geometry.ts            2D vector helpers
    statistics.ts          Median, quartile, least squares
service-worker/sw.ts       Offline support (compiled separately: it runs in a worker)
tests/                     Unit tests (*.test.ts); tests/fixtures/ holds real card photos
scripts/build.ts           Builds the site into _site/
scripts/serve.ts           Local web server for `npm start`
tsconfig.base.json         Compiler settings shared by the three below
tsconfig.json              The app (browser)
tsconfig.sw.json           The service worker (worker)
tsconfig.node.json         Tests and scripts (Node; type-checked only)
manifest.webmanifest       Home-screen app details
assets/                    Sample card and icons
assets/icons/alternative/  A spare icon design, with instructions for switching
_site/                     Build output; not committed
```

## How the reader works

The reader is an optical mark reader, like the machines that grade bubble tests, but built for a phone photo instead of a flat scan. `src/reader/analyze-card.ts` runs six steps:

1. **Prepare the image.** Estimates the paper's brightness across the photo and measures how much darker each pixel is, which removes shadows. It also measures how colourful each pixel is, which picks out the printed bubble outlines on green, red or blue cards.
2. **Find mark candidates.** Groups dark pixels into blobs and keeps the solid, bar-shaped ones.
3. **Find the timing track.** Finds the straight line through the most same-sized bars: the column of timing marks down the card's edge.
4. **Align to the card.** The gaps between marks form a known pattern (`card-layout.ts`). Matching it tells the reader which mark belongs to which row and which way up the card is. A projective fit allows for the card being tilted away from the camera. Marks hidden under a finger or clip are filled in from the fit.
5. **Locate bubbles.** A flat card in a photo follows one perspective transform. The timing marks fix it along the card's edge, leaving three unknowns across the card: the rows' angle, the bubble scale and the sideways foreshortening. The reader searches those for the placement that puts the most printed ink on the bubbles and the least between them, from a blurred copy of the photo to the sharp one. Each section then gets a small nudge for a card that isn't quite flat. A poor fit stops the read rather than returning made-up scores.
6. **Read marks.** Measures the lightest pixels inside each bubble, which ignores the printed digit, since an empty bubble always has bare paper between the strokes. It learns from the card itself what an empty bubble and a typical fill look like, then picks each row's bubble and flags blanks, double marks and faint marks.

The tuning numbers for each step are named constants at the top of its file. When you change one, check the result against real card photos as well as `npm test`.

## Releasing a change

1. Run `npm run check`.
2. Push to `master`. The GitHub workflow checks, builds and publishes the site within a couple of minutes. A failed check stops the publish.

The service worker's cache version comes from a hash of the built files, so installed copies of the app pick up every change on their next visit. There's nothing to bump by hand.
