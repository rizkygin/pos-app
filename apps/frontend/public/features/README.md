# Feature tile artwork

Corner illustrations for the tiles on `/dashboard/order`.

Wired up in `lib/order-features.ts` (`image` field) and rendered by `FeatureArt`
in `components/order/feature-picker.tsx`.

| File                     | Tile           |
| ------------------------ | -------------- |
| `food.svg`               | Layanan Makan  |
| `drink.svg`              | Layanan Minum  |
| `service.svg`            | Layanan Jasa   |
| `mart.svg`               | Belanja        |
| `building-materials.svg` | Bahan Bangunan |

The current files are simple flat vector shapes — deliberately plain, and meant
to be replaced with real illustration when there is any.

## Replacing one

Drop the new file in and update that feature's `image` path. A file that fails
to load renders nothing and the tile keeps its flat gradient, so a wrong path
costs the illustration and breaks nothing else. They can be swapped one at a
time.

- **Format:** SVG preferred. Raster works, but drop `unoptimized` from
  `FeatureArt` first so Next can compress it, and keep it under ~60 KB — five
  of these load on first paint.
- **Canvas:** square-ish. `object-contain` fits the whole image into a box about
  55% of the tile's width, anchored bottom-right, so nothing is cropped —
  a wide canvas just renders smaller.
- **Background:** must be transparent. The tile's own gradient shows through,
  and an opaque rectangle would read as a pasted-on box.
- **Both themes:** rendered at 90% opacity in light, 60% in dark, over the same
  pale gradient. Check it in dark mode — mid-tone shapes hold up there, very
  light ones disappear.
