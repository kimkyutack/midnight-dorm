# Paper-doll avatar assets

Every survivor uses a neutral 4 × 3 movement base under `bases/<character>/`:

- row 1: front (`idle`, `walk-1`, `walk-2`, `walk-3`)
- row 2: back
- row 3: side (the renderer mirrors it for the opposite direction)

Wearables use the exact same 362 px cell grid. Hats are character-specific;
outfits, shoes and accessories share the `slim`, `standard` or `broad` fit
profile. `face-overlay-sheet.png` restores the lower face above high collars.

`scripts/build_paperdoll_bases.py` and `scripts/build_paperdoll_layers.py`
rebuild the runtime files from the generated source sheets and item images.
The chroma-key source sheets live under `scripts/paperdoll-source/`, outside
this public directory, so they are not shipped with the game.
