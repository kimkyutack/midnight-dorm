# Survivor base assets

Each survivor's neutral concept and gameplay atlas lives under
`bases/<character>/`. The character catalogue uses `concept.png` from this
directory, so the catalogue never displays a completed outfit as a character.

Every movement atlas is a transparent 4 × 3 sheet with 362 px cells:

- row 1: front (`idle`, `walk-1`, `walk-2`, `walk-3`)
- row 2: back
- row 3: side (the renderer mirrors it for the opposite direction)

The base and the prepared full-skin atlases in
`public/assets/sprites/survivors/` share the same grid and a common foot
baseline. Run `npm run sprites` after changing source frames, then
`npm run sprites:verify` to reject clipped or vertically misaligned frames.
