# NASP Card Scanner

Reads NASP practice score cards from a photo and keeps a log of them for export to a spreadsheet.

## Language

**Archer**:
A person who shot a scorecard, known by a name, a Shooter #, or both. Every scorecard needs at least one of the two. The log is the only record of archers, so an archer whose scorecards are all deleted is forgotten. Names that differ only in capitalization or stray spaces are the same name.

**Arrow**:
One shot, scored 0 to 10, or left blank.

**Round**:
Five arrows shot together. A scorecard has six. In Bullseye, Rounds 1 to 3 are from 10 meters and Rounds 4 to 6 from 15 meters. In 3D, the distance depends on the round's animal.
_Avoid_: End (some printed cards still say "End")

**Scorecard**:
One archer's six rounds (30 arrows) on one date, in one format, out of 300.
_Avoid_: Round, card, practice round

**Score sheet**:
The scorecard being read or typed in, before it's saved. Saving adds it to the log as a new scorecard, and a saved scorecard can't be edited.

**Format**:
What a scorecard was shot at: Bullseye or 3D. NASP has only these two, so no other format is planned.
_Avoid_: Discipline, type, target type

**Animal**:
One of the six 3D targets, each at a fixed distance. In order: Alert Turkey (10 m), Coyote (11 m), Cinnamon Bear / Black Bear (12 m), Pronghorn Antelope (13 m), Alert Deer / White-tailed Deer (14 m), Standing Stone Sheep / Mountain Sheep (15 m). A name with a slash is one animal, not two.
_Avoid_: Target

**Side**:
The side of the 3D range an archer shot from: Left or Right. On the left side the archer moves from the turkey toward the sheep, and from the sheep back to the turkey. On the right side they move the other way, from the sheep toward the turkey, and from the turkey back to the sheep.

**First animal**:
The animal shot in Round 1 of a 3D scorecard. Together with the side, it sets the animal for all six rounds.

**Log**:
The scorecards saved in this browser, viewed and exported one format at a time.
_Avoid_: Practice log

**Shooter #**:
The five-digit number that identifies an archer on the card, including any leading zeros (00123, not 123). A new scorecard has all five digits or none.
_Avoid_: Shooter number, archer ID
