# NASP Card Scanner

Photograph a NASP practice score card and the page reads the bubbles, totals each round, and keeps a log you can export to a spreadsheet. It's meant for practice, not official tournament scoring.

Everything runs in the browser. There's no server, no tracking, and photos never leave the device.

This is an independent project. It isn't affiliated with, endorsed by or sponsored by the National Archery in the Schools Program (NASP). The NASP name and the official score card belong to their respective owners. The sample cards in `assets/` are original drawings in the style of the official card, so the reader has something to show on first load. They follow its layout of bubbles, timing marks and black bars, but leave out its logos and form numbers.

## Using it at practice

- **Take photo** opens the phone camera. **Upload image** picks an existing photo.
- The reader marks what it saw on the photo. Spots it isn't sure about (two bubbles filled, a faint mark, a blank row) are outlined in amber and listed under the score sheet. A completely blank Shooter # section isn't flagged, since it's optional.
- Tap any arrow to change it, add the archer's name, then **Save to log**. A scorecard needs a name or a Shooter #. A Shooter # needs all five digits, including any leading zeros (`00123`), or it can be left blank.
- The log remembers archers. Choosing a known name fills in their latest Shooter #, and a known Shooter # fills in a blank name. A number that was read cleanly or typed by hand is never replaced. If it differs from the archer's last scorecard, it's listed for you to check, and you can still save it.
- Choose **Bullseye** or **3D** for each scorecard. For 3D, also choose the **Side** and the **First animal**, the one shot in Round 1. The archer moves to the next animal after each round. On the left side the order is Alert Turkey, Coyote, Cinnamon Bear / Black Bear, Pronghorn Antelope, Alert Deer / White-tailed Deer, Standing Stone Sheep / Mountain Sheep, then back to the turkey. On the right side it's the reverse, from the sheep to the turkey, then back to the sheep.
- The **Log** has a tab for each format.
- **Download Excel** saves the whole log as one workbook, with a `Bullseye` sheet and a `3D` sheet.
- **Download CSV** saves the tab that's showing, with one row per scorecard. A Bullseye row has the date, archer, shooter number, the six round totals, the 10 m and 15 m subtotals, the total, the count of 10s, and every arrow (`R1A1` to `R6A5`). A 3D row adds the format, side and first animal, puts each round's animal beside its total, and leaves out the 10 m and 15 m subtotals.
- **Import CSV** adds each row to its own format's tab, whichever tab is showing. It also accepts older files with `E1A1` to `E6A5` columns, and counts files without a `Format` column as Bullseye and 3D rows without a `Side` as the left side.
- **Copy for spreadsheet** copies the tab that's showing, so it pastes straight into Excel or Google Sheets.
- **Leading zeros:** Excel usually drops them when it opens a CSV or receives pasted data, turning `00123` into `123`. Use **Download Excel** for spreadsheets, and don't import a CSV that's been saved from Excel. Import keeps short numbers as they are, so they'd count as new scorecards and wouldn't be used to fill in names.

### Add it to the home screen

- **iPhone or iPad (Safari):** Share → Add to Home Screen.
- **Android (Chrome):** menu → Add to Home screen (or Install app).

It then opens full screen like an app and works without a signal once it has loaded once.

## Where the scores are stored

The log lives in the browser's local storage on that device:

- **Each device has its own log.** To combine logs, use **Download CSV** on each tab on one device and **Import CSV** on the other. Import skips scorecards that are already there, so it's safe to repeat.
- **Safari may clear it.** iOS Safari deletes a website's stored data if you don't open the site for 7 days. Apps added to the home screen are exempt, so add it there on an iPhone.
- **Private browsing and clearing site data erase it.** Download the CSV now and then as a backup.

## Getting a clean read

- Lay the card flat in even light and avoid glare across the bubbles.
- Keep the black timing marks down the card's left edge in the frame, since those are how the reader finds each row. A clip over the top of the card is fine.
- Blue, red and green cards all work, at any angle or rotation.
- Dark pencil fills read best. Erase changed answers completely.

## License

[MIT](LICENSE) © 2026 Jeremy Brown. You may use, change and share the code freely, as long as you keep the copyright and license notice.
