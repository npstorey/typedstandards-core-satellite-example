# Fonts

The two typefaces typedstandards.org loads (`apps/web/src/app/layout.tsx` in npstorey/typedstandards at
68c6bf0): Space Grotesk at weights 500 to 700, and Noto Sans at weights 400 to 600, each subset to the Latin
range. They are committed here so that the page loads nothing from any other host.

| File | SHA-256 | Bytes | Licence |
|---|---|---|---|
| `space-grotesk-latin.woff2` | `102bfab82d206ec142e070c99fd4eba18eac6943630d4473a1ffd40639ee75fa` | 25460 | SIL Open Font License 1.1, `OFL-SpaceGrotesk.txt` |
| `noto-sans-latin.woff2` | `3256648535f0c969c7704dd534f2c8114bc5e263a76ef4e3ac6d80453db089a8` | 33928 | SIL Open Font License 1.1, `OFL-NotoSans.txt` |

Each licence file is the `OFL.txt` beside its source font, byte for byte. Neither names a Reserved Font Name,
so the subset copies keep the fonts' names.

## Sources

Fetched 2026-09-24 (UTC) from google/fonts at commit `b5efa9c32e8f9b63005f5cdb1ad5527a77d2cd04`, each with
HTTP 200:

| Path | SHA-256 | Bytes |
|---|---|---|
| `ofl/spacegrotesk/SpaceGrotesk[wght].ttf` | `acad6de1fc93436f5c0f1f4137751ef04f1aea3063e7036535970ffcfbd79f72` | 136676 |
| `ofl/spacegrotesk/OFL.txt` | `564ce565c371c5e5bbf286006565a7c9aa55a9f56e7ca58d56e05d649dd61a72` | 4495 |
| `ofl/notosans/NotoSans[wdth,wght].ttf` | `bfb7bb691513f12e734dc346c03a03f784912432d7e3fa8e56efcf906fe86b3d` | 2049096 |
| `ofl/notosans/OFL.txt` | `cee9892f9f0cc8fe882c9e9537ee6a89621d86ee7ceaf70b02e2b2b1c25c061a` | 4396 |

Each at `https://raw.githubusercontent.com/google/fonts/b5efa9c32e8f9b63005f5cdb1ad5527a77d2cd04/<path>`, with
`[` and `]` written `%5B` and `%5D`.

## How they were made

With `subset-font` 2.9.0 (harfbuzzjs 1.6.2) on Node 22.23.1, outside this repository, which does not depend on
it. Two runs wrote identical bytes. The characters are Google Fonts' `latin` range, with U+2190 to U+2193
(the arrows, including → and ←) in place of its U+2191 and U+2193. Space Grotesk keeps its weight axis from
500 to 700. Noto Sans keeps weight from 400 to 600, with width fixed at 100.

```js
import fs from 'node:fs';
import subsetFont from 'subset-font';
const ranges = [[0x0000, 0x00ff], [0x0131], [0x0152, 0x0153], [0x02bb, 0x02bc], [0x02c6], [0x02da], [0x02dc], [0x0304], [0x0308], [0x0329],
  [0x2000, 0x206f], [0x20ac], [0x2122], [0x2190, 0x2193], [0x2212], [0x2215], [0xfeff], [0xfffd]];
let text = '';
for (const [a, b = a] of ranges) for (let c = a; c <= b; c += 1) text += String.fromCodePoint(c);
const [src, out, axes] = process.argv.slice(2);
fs.writeFileSync(out, await subsetFont(fs.readFileSync(src), text, { targetFormat: 'woff2', variationAxes: JSON.parse(axes) }));
```

    node subset.mjs 'SpaceGrotesk[wght].ttf' space-grotesk-latin.woff2 '{"wght":{"min":500,"max":700}}'
    node subset.mjs 'NotoSans[wdth,wght].ttf' noto-sans-latin.woff2 '{"wght":{"min":400,"max":600},"wdth":100}'
