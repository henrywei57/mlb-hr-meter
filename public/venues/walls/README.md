# Real wall photos

Drop a picture of a park's outfield wall here and the 3D stadium uses it instead of the painted wall.

- File name: the venue id from `public/data/venues.json`, e.g. `3.jpg` (Fenway Park), `17.jpg` (Wrigley Field), `22.jpg` (Dodger Stadium). `.jpg` or `.png`.
- Shape: one wide strip of the whole wall seen head-on, left field line on the left edge to right field line on the right edge. About 2048 x 256 px works well (any 8:1 shape).
- Only use photos you have the right to use.
- If you add a file, also add its path to `APP_FILES` in `sw.js` (optional, for offline) and bump `CACHE_NAME`.
