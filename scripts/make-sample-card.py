"""Draws the sample score cards in assets/.

- sample-card.jpg: a photo of a filled-in card, shown when the app opens.
- sample-card-blank.jpg: the same photo with nothing filled in, shown while
  scores are entered by hand.
- sample-card-blank.json: where the blank card's timing marks and bubbles are
  in that photo, so the app can draw rings on it without running the reader.

The card follows the layout of the official NASP card (the AccuScan /
DataLink 1200 form), read from src/reader/card-layout.ts so the two can't
drift apart, but leaves out the official logos and form numbers.

Run it by hand when the card's look or layout changes, then run `npm test`:

    python scripts/make-sample-card.py

Needs Python 3.10 or later, Pillow and NumPy (`pip install pillow numpy`).
It isn't part of the build.
"""

import json
import random
import re
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont

ROOT = Path(__file__).resolve().parent.parent
ASSETS = ROOT / "assets"

# ---------------------------------------------------------------------------
# Card layout, in pixels of the official card at 200 dpi
# ---------------------------------------------------------------------------


def read_layout_constants() -> dict:
    """Reads the reader's measurements of the official card from card-layout.ts."""
    source = (ROOT / "src" / "reader" / "card-layout.ts").read_text(encoding="utf-8")
    positions = re.search(r"TIMING_MARK_POSITIONS[^=]*=\s*Object\.freeze\(\[([^\]]*)\]", source)
    constants = {
        name: float(re.search(rf"export const {name} = ([0-9.]+);", source).group(1))
        for name in ("TEMPLATE_MARK_PITCH", "FIRST_BUBBLE_OFFSET", "BUBBLE_SPACING")
    }
    constants["TIMING_MARK_POSITIONS"] = [float(value) for value in positions.group(1).split(",") if value.strip()]
    return constants


LAYOUT = read_layout_constants()
PITCH = LAYOUT["TEMPLATE_MARK_PITCH"]

CARD_WIDTH, CARD_HEIGHT = 992, 2326
# The card is drawn with its marks this far below the reader's template positions,
# as on a scan of the official card.
TOP_MARGIN = 9
# Each mark's left and right edges.
MARK_LEFT, MARK_RIGHT = 27, 57
MARK_CENTER_X = (MARK_LEFT + MARK_RIGHT) / 2
MARK_HEIGHT = 11

ROUND_COUNT, ROWS_PER_SECTION = 6, 5
SCORE_BUBBLES, SHOOTER_BUBBLES = 11, 10

SECTION_LEFT = 118
ROUND_SECTION_RIGHT = 833
SHOOTER_SECTION_RIGHT = 773
TAB_WIDTH = 34
BUBBLE_WIDTH, BUBBLE_HEIGHT = 48, 23

# The official card's colors.
PAPER = (251, 251, 248)
INK_BLUE = (52, 86, 168)
TAB_BLUE = (45, 78, 170)
ROW_LIGHT = (232, 240, 250)
ROW_DARK = (214, 226, 241)
BLACK = (18, 18, 20)

# The filled-in sample: 30 arrows in card order, the Shooter #, and one arrow
# with a stray mark. The reader tests in tests/reader.test.ts expect exactly these.
SAMPLE_SCORES = [
    9, 8, 10, 7, 9, 8, 9, 9, 6, 10, 10, 8, 7, 9, 8, 7, 9, 8, 8, 6, 9, 7, 10, 8, 7, 8, 6, 9, 9, 7,
]
SAMPLE_SHOOTER_NUMBER = "40712"
DOUBLE_MARKED_ARROW, STRAY_MARK = 13, 6

# Drawn at this multiple of the card's size, then shrunk, for smooth edges.
SUPERSAMPLE = 2


def row_y(row_index: int) -> float:
    """The center of a row's timing mark and bubbles, in card pixels."""
    return LAYOUT["TIMING_MARK_POSITIONS"][1 + row_index] + TOP_MARGIN


def bubble_x(bubble_index: int) -> float:
    """The center of a bubble in a row, in card pixels."""
    first = MARK_CENTER_X + LAYOUT["FIRST_BUBBLE_OFFSET"] * PITCH
    return first + bubble_index * LAYOUT["BUBBLE_SPACING"] * PITCH


def bubble_count(row_index: int) -> int:
    return SCORE_BUBBLES if row_index < ROUND_COUNT * ROWS_PER_SECTION else SHOOTER_BUBBLES


def load_font(size: float, bold: bool = False) -> ImageFont.FreeTypeFont:
    """Arial or DejaVu Sans when installed, otherwise Pillow's built-in font."""
    names = ["arialbd.ttf", "DejaVuSans-Bold.ttf"] if bold else ["arial.ttf", "DejaVuSans.ttf"]
    for name in names:
        try:
            return ImageFont.truetype(name, round(size * SUPERSAMPLE))
        except OSError:
            continue
    return ImageFont.load_default(round(size * SUPERSAMPLE))


# ---------------------------------------------------------------------------
# Drawing the card
# ---------------------------------------------------------------------------


class CardCanvas:
    """Draws in card pixels on a canvas SUPERSAMPLE times larger."""

    def __init__(self) -> None:
        self.image = Image.new("RGBA", (CARD_WIDTH * SUPERSAMPLE, CARD_HEIGHT * SUPERSAMPLE), PAPER + (255,))
        self.draw = ImageDraw.Draw(self.image)

    @staticmethod
    def scale(*values: float) -> list[float]:
        return [value * SUPERSAMPLE for value in values]

    def rectangle(self, left, top, right, bottom, fill=None, outline=None, width=0, radius=0):
        self.draw.rounded_rectangle(
            self.scale(left, top, right, bottom), radius=radius * SUPERSAMPLE,
            fill=fill, outline=outline, width=round(width * SUPERSAMPLE),
        )

    def text(self, x, y, text, size, fill, bold=False, anchor="la"):
        self.draw.text(self.scale(x, y), text, font=load_font(size, bold), fill=fill, anchor=anchor)

    def vertical_text(self, center_x, center_y, text, size, fill):
        """Text reading from bottom to top, as on the card's section tabs."""
        font = load_font(size, bold=True)
        left, top, right, bottom = font.getbbox(text)
        label = Image.new("RGBA", (right - left + 4, bottom - top + 4), (0, 0, 0, 0))
        ImageDraw.Draw(label).text((2 - left, 2 - top), text, font=font, fill=fill)
        label = label.rotate(90, expand=True)
        self.image.alpha_composite(
            label,
            (round(center_x * SUPERSAMPLE - label.width / 2), round(center_y * SUPERSAMPLE - label.height / 2)),
        )

    def finish(self) -> Image.Image:
        return self.image.resize((CARD_WIDTH, CARD_HEIGHT), Image.LANCZOS)


def draw_section(canvas: CardCanvas, first_row: int, label: str, right: float, bubbles: int) -> None:
    """One section: a tab, five shaded rows, and a row of bubbles on each."""
    top = row_y(first_row) - PITCH / 2 - 1
    bottom = row_y(first_row + ROWS_PER_SECTION - 1) + PITCH / 2 + 1
    canvas.rectangle(SECTION_LEFT, top, right, bottom, fill=ROW_LIGHT, outline=INK_BLUE, width=2, radius=8)
    for offset in range(ROWS_PER_SECTION):
        center = row_y(first_row + offset)
        if offset % 2 == 1:
            canvas.rectangle(SECTION_LEFT + TAB_WIDTH, center - PITCH / 2 + 1, right - 2, center + PITCH / 2 - 1, fill=ROW_DARK)
    canvas.rectangle(SECTION_LEFT, top, SECTION_LEFT + TAB_WIDTH, bottom, fill=TAB_BLUE, radius=8)
    canvas.vertical_text(SECTION_LEFT + TAB_WIDTH / 2, (top + bottom) / 2, label, 21, (255, 255, 255))
    for offset in range(ROWS_PER_SECTION):
        center = row_y(first_row + offset)
        for bubble in range(bubbles):
            x = bubble_x(bubble)
            canvas.rectangle(
                x - BUBBLE_WIDTH / 2, center - BUBBLE_HEIGHT / 2, x + BUBBLE_WIDTH / 2, center + BUBBLE_HEIGHT / 2,
                fill=(246, 249, 253), outline=INK_BLUE, width=2, radius=BUBBLE_HEIGHT / 2,
            )
            canvas.text(x, center + 0.5, str(bubble), 18, INK_BLUE, bold=True, anchor="mm")


def draw_card() -> Image.Image:
    """The printed card, with nothing filled in."""
    canvas = CardCanvas()

    # The row of marks across the top, and the lone corner mark.
    for left, top, right, bottom in [(122, 52, 161, 71), (182, 52, 221, 71), (242, 52, 281, 71), (363, 51, 401, 70), (783, 53, 821, 66)]:
        canvas.rectangle(left, top, right, bottom, fill=BLACK)
    corner = LAYOUT["TIMING_MARK_POSITIONS"][0] + TOP_MARGIN
    canvas.rectangle(MARK_LEFT - 1, corner - MARK_HEIGHT / 2, MARK_RIGHT, corner + MARK_HEIGHT / 2, fill=BLACK)

    canvas.text(SECTION_LEFT, 104, "Score Card", 44, BLACK, bold=True)

    # The black bars across the card.
    canvas.rectangle(119, 170, 832, 211, fill=BLACK)
    canvas.rectangle(119, 850, 832, 891, fill=BLACK)
    canvas.rectangle(120, 1748, 899, 1780, fill=BLACK)

    # A timing mark beside every row.
    for row_index in range(ROUND_COUNT * ROWS_PER_SECTION + ROWS_PER_SECTION):
        center = row_y(row_index)
        canvas.rectangle(MARK_LEFT, center - MARK_HEIGHT / 2, MARK_RIGHT, center + MARK_HEIGHT / 2, fill=BLACK)

    for round_index in range(ROUND_COUNT):
        first_row = round_index * ROWS_PER_SECTION
        draw_section(canvas, first_row, f"End #{round_index + 1}", ROUND_SECTION_RIGHT, SCORE_BUBBLES)
        # A box for the round's total.
        box_top = (row_y(first_row) + row_y(first_row + ROWS_PER_SECTION - 1)) / 2 - 25
        canvas.rectangle(904, box_top, 954, box_top + 50, outline=BLACK, width=2)
    draw_section(canvas, ROUND_COUNT * ROWS_PER_SECTION, "Shooter #", SHOOTER_SECTION_RIGHT, SHOOTER_BUBBLES)

    # Name and signature boxes.
    for top, bottom, label in [(1795, 1880, "Shooter Name:"), (1892, 1985, "Archer's Signature"), (1997, 2105, "Witness Signature")]:
        canvas.rectangle(SECTION_LEFT, top, 899, bottom, fill=ROW_LIGHT, outline=INK_BLUE, width=2, radius=6)
        canvas.text(SECTION_LEFT + 8, top + 8, label, 21, INK_BLUE)
    canvas.text(SECTION_LEFT, 2135, "Sample card for the NASP Card Scanner. Not an official form.", 17, (110, 110, 115))
    return canvas.finish()


def fill_bubbles(card: Image.Image) -> Image.Image:
    """Pencils in the sample's arrows and Shooter #."""
    marks = [(row, score, 0.86) for row, score in enumerate(SAMPLE_SCORES)]
    # The archer meant a 9 but also filled in a 6, more darkly.
    marks[DOUBLE_MARKED_ARROW] = (DOUBLE_MARKED_ARROW, SAMPLE_SCORES[DOUBLE_MARKED_ARROW], 0.62)
    marks.append((DOUBLE_MARKED_ARROW, STRAY_MARK, 0.92))
    first_shooter_row = ROUND_COUNT * ROWS_PER_SECTION
    marks += [(first_shooter_row + index, int(digit), 0.86) for index, digit in enumerate(SAMPLE_SHOOTER_NUMBER)]

    random_source = random.Random(7)
    pencil = Image.new("RGBA", (CARD_WIDTH * SUPERSAMPLE, CARD_HEIGHT * SUPERSAMPLE), (0, 0, 0, 0))
    draw = ImageDraw.Draw(pencil)
    for row, bubble, darkness in marks:
        x = bubble_x(bubble) + random_source.uniform(-1.5, 1.5)
        y = row_y(row) + random_source.uniform(-1, 1)
        # A few overlapping strokes, like a pencil going back and forth.
        for stroke in range(5):
            half_width = BUBBLE_WIDTH / 2 - 3 + random_source.uniform(-1.5, 1)
            half_height = BUBBLE_HEIGHT / 2 - 2.5 + random_source.uniform(-1, 0.5)
            shift = random_source.uniform(-1, 1)
            alpha = round(255 * darkness * random_source.uniform(0.6, 0.75))
            draw.ellipse(
                [value * SUPERSAMPLE for value in (x - half_width + shift, y - half_height, x + half_width + shift, y + half_height)],
                fill=(58, 58, 62, alpha),
            )
    pencil = pencil.resize(card.size, Image.LANCZOS)
    return Image.alpha_composite(card, pencil)


# ---------------------------------------------------------------------------
# Photographing the card
# ---------------------------------------------------------------------------

# The card lies flat and square to the frame, at three quarters of its size,
# with a margin of table around it.
CARD_SCALE = 0.75
PHOTO_MARGIN = 36
PHOTO_WIDTH = round(CARD_WIDTH * CARD_SCALE) + 2 * PHOTO_MARGIN
PHOTO_HEIGHT = round(CARD_HEIGHT * CARD_SCALE) + 2 * PHOTO_MARGIN
CARD_CORNERS_IN_PHOTO = [
    (PHOTO_MARGIN + x * CARD_SCALE, PHOTO_MARGIN + y * CARD_SCALE)
    for x, y in [(0, 0), (CARD_WIDTH, 0), (CARD_WIDTH, CARD_HEIGHT), (0, CARD_HEIGHT)]
]


def find_homography(source: list, destination: list) -> np.ndarray:
    """The perspective transform taking four points to four others."""
    rows = []
    for (x, y), (u, v) in zip(source, destination):
        rows.append([x, y, 1, 0, 0, 0, -u * x, -u * y, -u])
        rows.append([0, 0, 0, x, y, 1, -v * x, -v * y, -v])
    _, _, vectors = np.linalg.svd(np.array(rows, dtype=float))
    matrix = vectors[-1].reshape(3, 3)
    return matrix / matrix[2, 2]


CARD_CORNERS = [(0, 0), (CARD_WIDTH, 0), (CARD_WIDTH, CARD_HEIGHT), (0, CARD_HEIGHT)]
CARD_TO_PHOTO = find_homography(CARD_CORNERS, CARD_CORNERS_IN_PHOTO)


def to_photo(x: float, y: float) -> tuple[float, float]:
    """Where a point on the card lands in the photo."""
    u, v, w = CARD_TO_PHOTO @ np.array([x, y, 1.0])
    return u / w, v / w


def photograph(card: Image.Image) -> Image.Image:
    """Lays the card flat on a plain table and takes a slightly soft photo."""
    random_source = np.random.default_rng(11)
    photo_to_card = np.linalg.inv(CARD_TO_PHOTO)
    photo_to_card /= photo_to_card[2, 2]
    warped = card.transform(
        (PHOTO_WIDTH, PHOTO_HEIGHT), Image.PERSPECTIVE, tuple(photo_to_card.flatten()[:8]), Image.BICUBIC,
    )

    # A plain gray table.
    rows, columns = np.mgrid[0:PHOTO_HEIGHT, 0:PHOTO_WIDTH]
    texture = random_source.normal(0, 0.012, (PHOTO_HEIGHT, PHOTO_WIDTH))
    table = np.stack([196 * (1 + texture), 198 * (1 + texture), 201 * (1 + texture)], axis=-1)
    photo = Image.fromarray(np.clip(table, 0, 255).astype(np.uint8)).convert("RGBA")

    # The card's soft shadow, then the card.
    alpha = warped.getchannel("A")
    shadow = Image.new("RGBA", photo.size, (0, 0, 0, 0))
    shadow.putalpha(alpha.point(lambda value: value * 0.25).filter(ImageFilter.GaussianBlur(8)))
    photo.alpha_composite(shadow, (4, 6))
    photo.alpha_composite(warped)

    # Light a touch brighter at the top, a little sensor noise, and soft focus.
    pixels = np.asarray(photo.convert("RGB"), dtype=float)
    light = 1.01 - 0.04 * (rows / PHOTO_HEIGHT)
    pixels = pixels * light[..., None] + random_source.normal(0, 1.5, pixels.shape)
    photo = Image.fromarray(np.clip(pixels, 0, 255).astype(np.uint8))
    return photo.filter(ImageFilter.GaussianBlur(0.5))


def describe_blank_card() -> dict:
    """Where the timing mark and each bubble of every row land in the photo."""
    row_count = ROUND_COUNT * ROWS_PER_SECTION + ROWS_PER_SECTION
    point = lambda x, y: dict(zip(("x", "y"), (round(value, 1) for value in to_photo(x, y))))
    return {
        "width": PHOTO_WIDTH,
        "height": PHOTO_HEIGHT,
        "timingMarks": [point(MARK_CENTER_X, row_y(row)) for row in range(row_count)],
        "rows": [[point(bubble_x(bubble), row_y(row)) for bubble in range(bubble_count(row))] for row in range(row_count)],
    }


def main() -> None:
    blank = draw_card()
    photograph(fill_bubbles(blank)).save(ASSETS / "sample-card.jpg", quality=88, optimize=True)
    photograph(blank).save(ASSETS / "sample-card-blank.jpg", quality=88, optimize=True)
    (ASSETS / "sample-card-blank.json").write_text(json.dumps(describe_blank_card(), separators=(",", ":")) + "\n")
    print("Wrote sample-card.jpg, sample-card-blank.jpg and sample-card-blank.json in assets/.")


if __name__ == "__main__":
    main()
