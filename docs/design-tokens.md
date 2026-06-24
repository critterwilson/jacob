# Design tokens

For the full color / type / spacing system, see `docs/design-system.md`.
This file is the sticker-color subset, kept separate because the values
are seeded into Firestore (`firestore/seed/stickers.ts`) and a re-seed
is required when they change.

## Sticker colors

Each sticker has a hex color used for its badge text and border ring.
The badge background is the same hex with 15 % opacity (`color + "26"`).

Values were retuned in the design sweep (PR 9) for the dark-first ground:
~30-50 % saturation, mid-luminance, each readable as text on its own
15 %-alpha background. Sticker identities are preserved (blue-ish stays
blue-ish, etc.).

### Christian audience

| Slug             | Name           | Hex       |
|------------------|----------------|-----------|
| `check-in`       | Check-In       | `#7AA2D9` |
| `prayer-request` | Prayer Request | `#A98EE0` |
| `praise-report`  | Praise Report  | `#D9B068` |
| `offering-help`  | Offering Help  | `#7E9B7C` |
| `need-help`      | Need Help      | `#C16B5C` |
| `event-meetup`   | Event / Meetup | `#D58FA8` |

### General (cross-audience)

| Slug             | Name           | Hex       |
|------------------|----------------|-----------|
| `encouragement`  | Encouragement  | `#7FB39A` |
| `question`       | Question       | `#82A2C2` |
| `praise`         | Praise         | `#D9BE7C` |

## Re-seeding after a value change

Values are written to Firestore by `firestore/seed/stickers.ts`. Existing
documents in production will keep their old colors until the seed is
re-run. To pick up new values:

```bash
pnpm seed:stickers              # → live Firestore (ADC)
pnpm seed:stickers --emulator   # → local emulator
```
