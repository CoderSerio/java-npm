# The jpm mark

A green coffee bean sits over a curved stroke. Together they read as a semicolon or a lowercase **j** for Java. The hooked end hints at a cup handle. Keep the bean’s crease and the gap below it open so the silhouette reads at small sizes.

## README and icons

Use the symbol beside the lowercase wordmark. The dot on the wordmark’s own `j` matches its letters. The [SVG master](../../assets/brand/jpm.svg) contains both the standalone symbol and the wordmark as paths and shapes.

Both READMEs display a transparent PNG at 264 px wide. The [light-background version](../../assets/brand/jpm-readme.png) uses ink (#19191B) for the hook and lettering. The [dark-background version](../../assets/brand/jpm-readme-dark.png) uses off-white (#F3F4F5) in their place. The bean stays green (#00BC69) in both.

Use the [standalone icon](../../assets/brand/jpm-icon.png) on a light background for square placements. Preserve the proportions and the clear space around each export.

## How to draw the symbol

Use the `symbol` group in the SVG master as the source of the outline. Its three closed paths are defined in the same coordinate system, with x increasing to the right and y downwards. Scale and position the group as a unit.

| Path | Geometry |
| --- | --- |
| `bean-upper` | Four cubic Bézier segments. The last two form the upper edge of the crease. |
| `bean-lower` | Four cubic Bézier segments. The first two form the lower edge of the crease. The space between the two filled paths shows the background. |
| `hook` | Straight shoulders, quadratic corners and three cubic segments around the sweep and tip. |

Each `C` command defines a segment from the previous endpoint **P₀**, to **P₃**, with control points **P₁** and **P₂**. Its position at **0 ≤ t ≤ 1** is

```text
B(t) = (1−t)³ P₀ + 3(1−t)²t P₁ + 3(1−t)t² P₂ + t³ P₃
```

Each `Q` command uses one control point and follows `(1−t)² P₀ + 2(1−t)t P₁ + t² P₂`. The SVG lists the control points in drawing order. For example, the hook’s outer sweep begins at (191, 239), bends toward (191, 311) and (134, 373), and ends at (58, 382).

An HTML page served alongside the master can reference the group in an inline SVG:

```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="-84 0 418 418" fill="#19191b">
  <use href="jpm.svg#symbol"/>
</svg>
```

After editing the master, regenerate all three PNGs from the repository root with `uv run scripts/render-brand.py`. The script pins the renderer and PNG encoder and reads the same paths for every export.

## Terminal

Use the literal text `; jpm` as the header on the welcome screen, creation wizard, and doctor summary. The semicolon carries the identity into a single line of monospace text. Use the terminal’s normal foreground for the header and blue for the selected action. The arrow still identifies the selection with `NO_COLOR` enabled.

The visual concept was developed with AI image-generation assistance and human direction.
