# /// script
# requires-python = ">=3.12"
# dependencies = ["pillow==13.0.0", "resvg-py==0.5.0"]
# ///

"""Render the README and icon PNGs from the canonical SVG geometry."""

from io import BytesIO
from pathlib import Path
from xml.etree import ElementTree as ET

from PIL import Image
from resvg_py import svg_to_bytes

ASSETS = Path(__file__).resolve().parents[1] / "assets" / "brand"
SVG = "http://www.w3.org/2000/svg"
ET.register_namespace("", SVG)


def render(svg, filename, width):
    data = svg_to_bytes(svg_string=ET.tostring(svg, encoding="unicode"), width=width)
    with Image.open(BytesIO(data)) as image:
        image.save(ASSETS / filename, optimize=True)


def main():
    master = ET.parse(ASSETS / "jpm.svg").getroot()
    render(master, "jpm-readme.png", 1368)

    icon = ET.Element(master.tag, {"viewBox": "-84 0 418 418", "fill": master.attrib["fill"]})
    symbol = master.find(f"{{{SVG}}}g[@id='symbol']")
    if symbol is None:
        raise ValueError("Missing #symbol in jpm.svg")
    icon.append(symbol)
    render(icon, "jpm-icon.png", 512)

    master.set("fill", "#f3f4f5")
    render(master, "jpm-readme-dark.png", 1368)


if __name__ == "__main__":
    main()
