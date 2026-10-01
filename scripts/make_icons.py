"""
make_icons.py - draws the app icons (a baseball with a glowing ring) into public/icons/.

    python scripts/make_icons.py

Needs Pillow:  pip install pillow
"""

from pathlib import Path
from PIL import Image, ImageDraw

OUT = Path(__file__).resolve().parent.parent / "public" / "icons"
BG = (15, 18, 24)
GLOW = (255, 122, 26)
BALL = (245, 245, 240)
STITCH = (214, 54, 54)


def draw_icon(size, ball_fraction):
    """Draw at 4x size then shrink, which smooths the edges."""
    s = size * 4
    img = Image.new("RGB", (s, s), BG)
    d = ImageDraw.Draw(img)
    c = s / 2
    r = s * ball_fraction / 2

    # glow ring
    for i in range(14, 0, -1):
        grow = r + s * 0.012 * i
        shade = tuple(int(BG[k] + (GLOW[k] - BG[k]) * (1 - i / 14) * 0.55) for k in range(3))
        d.ellipse([c - grow, c - grow, c + grow, c + grow], fill=shade)

    d.ellipse([c - r, c - r, c + r, c + r], fill=BALL)

    # stitches: two arcs on the left and right edges
    w = max(4, int(s * 0.012))
    box_l = [c - r * 1.55, c - r * 0.95, c - r * 0.55, c + r * 0.95]
    box_r = [c + r * 0.55, c - r * 0.95, c + r * 1.55, c + r * 0.95]
    d.arc(box_l, -55, 55, fill=STITCH, width=w * 2)
    d.arc(box_r, 125, 235, fill=STITCH, width=w * 2)
    for k in range(-3, 4):
        y = c + k * r * 0.24
        off = r * 0.1
        d.line([c - r * 0.78 + abs(k) * r * 0.045 - off, y, c - r * 0.78 + abs(k) * r * 0.045 + off, y], fill=STITCH, width=w)
        d.line([c + r * 0.78 - abs(k) * r * 0.045 - off, y, c + r * 0.78 - abs(k) * r * 0.045 + off, y], fill=STITCH, width=w)
    return img.resize((size, size), Image.LANCZOS)


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    draw_icon(180, 0.58).save(OUT / "apple-touch-icon.png")   # iPhone home screen (iOS rounds corners itself)
    draw_icon(192, 0.58).save(OUT / "icon-192.png")
    draw_icon(512, 0.58).save(OUT / "icon-512.png")
    draw_icon(512, 0.46).save(OUT / "icon-maskable-512.png")  # smaller ball: Android may crop the edges
    print("icons written to", OUT)


if __name__ == "__main__":
    main()
