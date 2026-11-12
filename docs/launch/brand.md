# Brand direction

The README and web artwork use a **green coffee bean containing a terminal prompt**, paired with a lowercase `jpm` wordmark.

- The coffee bean refers to Java and gives the project a recognizable, approachable symbol.
- The `>_` prompt names its actual interface: a developer's command line.
- Dark green carries the main silhouette; a brighter green dot above `j` adds a small accent.
- The rounded wordmark shares the bean's curves. Shorter `j`/`p` descenders and a deeper `m` balance the lower edge without making the letters indistinguishable.

The reference to npm is the familiar workflow and consideration of optical alignment. Keep jpm's bean, rounded forms, and green palette as its own identity.

## Terminal identity

The terminal interface uses a separate coffee-cup character mark: flowing red-orange steam (`#FF6B45`) above a blue cup and saucer (`#3B9EFF`). It preserves the familiar Java coffee colors while fitting a fixed-width character grid. This terminal direction does not replace the green README/web assets.

Ship the mark as solid Unicode half-block characters (`▀`, `▄`, `█`) with ANSI foreground colors, not as a bitmap. Keep the terminal's own background and normal text foreground; avoid bold and dim styles because terminal profiles can make them unreadable. Use truecolor when supported, with 256-color and bright 16-color fallbacks. Use a compact layout when space is limited, and respect `NO_COLOR`. Generated images are design references; the actual terminal rendering is the source of truth for spacing and legibility.

Use the full mark on the interactive welcome page, creation wizard, and doctor summary. Machine-readable output and routine build logs remain free of decorative banners.

## Usage

Use the transparent [dark green lockup](../../assets/brand/jpm-readme.png) on light backgrounds and the transparent [light green lockup](../../assets/brand/jpm-readme-dark.png) on dark backgrounds. Both READMEs select the appropriate static PNG through a `<picture>` element, with the light-background version as the fallback. Do not add a rectangular background panel.

Preserve the aspect ratio and leave at least one wordmark-stroke width of clear space around the lockup. For avatars, use the [standalone icon](../../assets/brand/jpm-icon.png) on a light background; do not squeeze the entire wordmark into a square. Check the terminal cuts at the actual display size, particularly below 32 px.

The current assets are PNG refinements, not vector masters. Do not describe them as SVGs or scale them indefinitely for print. Monochrome exports need a separate review. The design was developed with AI image-generation assistance and human direction; the logo must not imply endorsement by Java, npm, Maven, or Spring.
