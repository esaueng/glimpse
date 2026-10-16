# Glimpse identity

The Reveal mark suggests a brief view through an opening: two pale-blue panels
and a bright inner edge. The production artwork uses flat fills and no effects.

- `public/brand/mark.svg`: transparent symbol for the dashboard and dark surfaces.
- `public/brand/logo.svg`: transparent horizontal lockup for dark surfaces.
- `public/brand/logo-light.svg`: horizontal lockup for light surfaces.
- `public/brand/icon.svg` and `public/brand/icon-512.png`: rounded navy app icon.
- `public/favicon.svg`: simplified geometry with a wider opening for small sizes.
- `public/favicon.ico`: 16, 32 and 48 pixel fallback using the simplified mark.
- `public/apple-touch-icon.png`: opaque 180 pixel touch icon; the platform supplies
  corner rounding.

The palette is the dashboard's pale blue (`#a9c9fa`), near-white (`#e8eef7`) and
navy (`#10151f`). The light lockup uses navy panels and a muted blue inner edge
(`#60718a`) to preserve contrast. Keep clear space around the symbol of at least
one quarter of its height. Use the simplified favicon artwork below 24 pixels.
Wordmark SVGs use a system sans-serif font stack; the live header uses the
dashboard's existing typography.

To regenerate PNG and ICO exports without changing project dependencies, use
an SVG renderer such as `rsvg-convert` and ImageMagick:

```sh
rsvg-convert -w 512 -h 512 public/brand/icon.svg -o public/brand/icon-512.png
rsvg-convert -b '#10151f' -w 180 -h 180 public/brand/icon.svg -o public/apple-touch-icon.png
rsvg-convert -w 256 -h 256 public/favicon.svg -o /tmp/glimpse-favicon.png
magick /tmp/glimpse-favicon.png -define icon:auto-resize=48,32,16 public/favicon.ico
```
