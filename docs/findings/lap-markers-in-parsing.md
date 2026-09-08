# Do lap markers survive parsing?

Research for [#22](https://github.com/TheNightAngel17/fitcast/issues/22), a child of the wayfinder map
[#5](https://github.com/TheNightAngel17/fitcast/issues/5). Decides the scope of
[#23 "Snap the brush to lap boundaries"](https://github.com/TheNightAngel17/fitcast/issues/23).

**Verdict: #23 is not a UI-only ticket.** `fit-file-parser` hands us laps for free, but
`app/src/shared/fit-parser.ts` throws them away at the normalization boundary, so `RideData` has no
lap data for a UI to snap to. #23 needs a small, additive parser + data-model change first. It also
needs a new fixture: the one `.fit` file in the repo has exactly **one** lap covering the entire
ride, so snapping is a no-op against it.

Everything below was verified against source in `node_modules` and by parsing the real fixture on
Node v24.0.2 (repo targets `>=22.0.0`, `app/package.json:10`), not from documentation prose.

---

## 1. What `fit-file-parser` exposes for laps and sessions

### Version note: the installed version is 2.3.3, not 2.1.0

`app/package.json:26` declares `"fit-file-parser": "^2.1.0"`, and that caret range resolves to
**2.3.3**, which is what is locked and installed:

- `app/package-lock.json:4814-4817` — `"node_modules/fit-file-parser": { "version": "2.3.3", ... }`
- `app/node_modules/fit-file-parser/package.json:4` — `"version": "2.3.3"`

Both versions were checked. `npm pack fit-file-parser@2.1.0` and diffing the relevant code paths
shows 2.1.0 and 2.3.3 are **identical** in every respect this question turns on — same options
interface, same `fitObj.laps` assignment, same `ParsedFit.laps` declaration — and both produce the
same output for our fixture. The findings hold for either.

### There is no lap-related option, because laps are unconditional

The complete options surface (`app/node_modules/fit-file-parser/dist/fit-parser.d.ts:3-11`):

```ts
export interface FitParserOptions {
    force?: boolean;
    speedUnit?: string;
    lengthUnit?: string;
    temperatureUnit?: string;
    elapsedRecordField?: boolean;
    pressureUnit?: string;
    mode?: 'list' | 'cascade' | 'both';
}
```

No `includeLaps`, no message filter, nothing to switch on. Every `lap` message in the file is
collected unconditionally as it is read (`dist/fit-parser.js:117-119`):

```js
case 'lap':
    laps.push(message);
    break;
```

Only `mode` decides *where* they land (`dist/fit-parser.js:231-251`):

| `mode` | top-level `data.laps` | top-level `data.records` | `data.activity.sessions[].laps` |
| --- | --- | --- | --- |
| `'list'` (default, **and what FitCast passes**) | populated | populated | absent |
| `'cascade'` | absent | absent | populated, each lap carrying its own sliced `records[]` |
| `'both'` | populated | populated | populated |

```js
if (isCascadeNeeded) {           // mode === 'cascade' || mode === 'both'
    laps = mapDataIntoLap(laps, 'records', records);
    laps = mapDataIntoLap(laps, 'lengths', lengths);
    sessions = mapDataIntoSession(sessions, laps);
    fitObj.activity = { ...fitObj.activity, sessions, events, ... };
}
if (!isModeCascade) {            // mode === 'list' || mode === 'both'
    fitObj.sessions = sessions;
    fitObj.laps = laps;
    ...
}
```

FitCast already passes `mode: 'list'` (`app/src/shared/fit-parser.ts:74`), so **`data.laps` is
already being populated on every parse today.** Nothing needs configuring — the data is arriving and
being ignored.

In cascade mode, `mapDataIntoLap` (`dist/helper.js:1-25`) assigns records to laps by comparing each
record's timestamp against the *next* lap's `start_time`. Useful to know, but not needed here:
cascade would also cost us the flat `records` array the sample builder depends on.

### The declared shape of a lap

`ParsedFit` (`dist/fit_types.d.ts:1008-1043`) declares laps as a top-level sibling of records and
sessions:

```ts
export interface ParsedFit {
    ...
    laps?: ParsedLap[];       // line 1019
    records?: ParsedRecord[];
    sessions?: ParsedSession[];
    events?: ParsedEvent[];
    ...
}
```

`ParsedSession` carries its own `laps?: ParsedLap[]` (`dist/fit_types.d.ts:470`), populated only in
cascade/both.

`ParsedLap` (`dist/fit_types.d.ts:472-541+`) is rich. The fields that matter for boundaries:

| Field | Use |
| --- | --- |
| `start_time` (required) | lap start — the reliable boundary anchor |
| `total_elapsed_time` | wall-clock lap duration in seconds |
| `total_timer_time` | duration excluding pauses |
| `timestamp` | nominally lap end — **see the caveat in §2, do not trust it** |
| `lap_trigger` | `manual` / `distance` / `time` / `session_end` / … — tells you whether a human pressed lap |
| `message_index` | lap ordering |

Plus the usual summary stats (`avg_power`, `max_power`, `normalized_power`, `avg_heart_rate`,
`avg_cadence`, `total_distance`, `total_ascent`, …) — enough to label or tooltip a lap later.

### Declared types say `string`, runtime gives `Date`

`ParsedLap.start_time` is declared `string`, but at runtime the parser converts every `date_time`
field to a real `Date` (`dist/binary.js:93-97`):

```js
case 'date_time':
case 'local_date_time':
    return new Date(data * 1000 + GarminTimeOffset);   // GarminTimeOffset = 631065600000
```

Confirmed empirically: `lap[0].start_time` came back as a `Date` (`constructor.name === 'Date'`).
This mismatch already exists for `records[].timestamp`, which `fit-parser.ts:24` correctly types as
`Date` against the library's own declaration. Any lap typing we add should do the same.

---

## 2. Does the fixture contain lap messages? Yes — exactly one, spanning the whole ride

Fixture: `app/example-data/24162810642_ACTIVITY.fit` (863,655 bytes). A Garmin activity file
(`file_id.manufacturer: 'garmin'`, `product: 4440`), `sport: cycling`, `sub_sport: road`.

Parsed with the **exact** options `app/src/shared/fit-parser.ts:68-75` uses:

```
records : 12443
sessions: 1
laps    : 1
events  : 139
```

`session.num_laps` is `1`, agreeing.

The single lap covers the entire ride:

| | |
| --- | --- |
| `lap.start_time` | `2026-08-29T12:30:57.000Z` |
| `lap.total_elapsed_time` | `14480.299` s (~4h01m) |
| ride record span (`records[0]` → `records[12442]`) | `12:30:57Z` → `16:32:17Z` = `14480` s |
| `lap.lap_trigger` | `session_end` |
| `lap.total_distance` | `97774` m |
| `lap.avg_power` / `normalized_power` | `170` W / `228` W |

`lap_trigger: 'session_end'` is the tell: the rider never pressed the lap button. The device
auto-closed one lap when the activity ended. **There are no interior lap boundaries in this file.**

Identical numbers under both 2.1.0 and 2.3.3.

### Caveat: `lap.timestamp` is *not* the lap end in this file

`lap.timestamp` came back equal to `lap.start_time` (`12:30:57Z`), even though the ride ends at
`16:32:17Z`. Same for `session.timestamp` and `activity.timestamp`.

This is **not** a parser bug. An independent byte-level decoder (written from the FIT record/
definition-message layout, with no `fit-file-parser` involved) read the raw uint32s straight out of
the file:

```
--- global msg 19 (lap) x1 ---
  fileOffset=2303  raw253=1156941057 -> 2026-08-29T12:30:57.000Z   raw2(start_time)=1156941057 -> 2026-08-29T12:30:57.000Z   delta=0s
--- global msg 18 (session) x1 ---
  fileOffset=1326  raw253=1156941057 -> 2026-08-29T12:30:57.000Z   raw2(start_time)=1156941057 -> 2026-08-29T12:30:57.000Z   delta=0s
--- global msg 34 (activity) x1 ---
  fileOffset=141   raw253=1156941057 -> 2026-08-29T12:30:57.000Z
```

Field 253 (`timestamp`) and field 2 (`start_time`) hold the same raw value in the file itself. The
parser's message definitions are correct (`dist/fit.js:1799-1828` maps lap field 253 → `timestamp`
and field 2 → `start_time`, both `date_time`) and it decodes both faithfully.

Those low file offsets (141 / 1326 / 2303, ahead of the 12,443 record messages) also show this is a
**summary-first** FIT layout — the summary messages are written before the data.

**Consequence for #23:** derive lap end as `start_time + total_elapsed_time`, never from
`lap.timestamp`. That arithmetic gives `2026-08-29T16:32:17.299Z`, matching the record stream.

### Adjacent: pause boundaries are also available and also dropped

The fixture has 139 events, 35 of them `timer` events alternating `start` / `stop_all` — real pause
boundaries at 0 s, 86 s, 113 s, 1356 s, 1374 s, 2556 s, … These live in `data.events`, which
`fit-parser.ts` also ignores. They are a plausible second snap target (and arguably a more useful one
for this fixture), but they are out of scope for #22. Noting so it isn't rediscovered later.

---

## 3. Does `fit-parser.ts` retain laps? No — it silently drops them

Three independent confirmations:

**The input type doesn't declare laps.** `app/src/shared/fit-parser.ts:53-57`:

```ts
interface FitData {
  records?: FitRecord[];
  sessions?: FitSession[];
  [key: string]: unknown;
}
```

The index signature keeps `data.laps` technically reachable, but it is untyped and never read.

**The normalizer never reads them.** `buildRideData` (`app/src/shared/fit-parser.ts:92-179`) touches
`data.records` (line 93) and `data.sessions?.[0]` (line 99) and nothing else. `data.laps` is never
mentioned.

**The output model has nowhere to put them.** `RideData` (`app/src/shared/ride-data.ts:57-72`) has
`startTimestamp`, `totalElapsedSeconds`, `movingTimeSeconds`, `sampleCount`, `channels`, `summary`,
`samples` — no lap field. `AvailableChannels` (`ride-data.ts:31-39`) has no lap flag either.

A case-insensitive grep for `lap` across all of `app/src` returns **zero** real hits — every match is
the substring inside "elapsed" / "elapsedSeconds".

So laps are parsed successfully, arrive in `data.laps` on every single parse, and are discarded at
the `FitData` → `RideData` boundary.

---

## What this means for #23

**Parser + data-model work, then UI.** The parser side is small and additive: no new dependency, no
new parse option, no second parse pass, no change to how samples are built.

1. **`app/src/shared/ride-data.ts`** — add a `RideLap` interface and a `laps: RideLap[]` field on
   `RideData`. Keep it to plain numbers (`startElapsedSeconds` / `endElapsedSeconds`, epoch ms), no
   `Date` objects: `RideData` crosses the contextBridge IPC boundary
   (`app/src/preload/index.ts:12`, `parseFitFile: (filePath: string) => Promise<RideData>`) and is
   structured-cloned, and the rest of the model is already plain numbers keyed off `elapsedSeconds`.

2. **`app/src/shared/fit-parser.ts`** — add `laps?: FitLap[]` to `FitData` and map each lap relative
   to the same `startMs` the samples already use (line 105), so lap times and sample times share one
   origin. End time from `start_time + total_elapsed_time` (§2), not `lap.timestamp`. Apply the same
   `elapsedSeconds < 0` guard the record loop uses (line 116).

3. **UI** — `RideTimeline` already receives the whole `rideData`
   (`app/src/renderer/src/components/timeline/RideTimeline.tsx:10-15`), so it only has to thread a
   `laps` prop down to `OverviewTrack`, which currently takes `samples` / `totalSeconds` /
   `selection` rather than the ride (`OverviewTrack.tsx:13-23`). Snapping belongs in `commit` /
   `handlePointerMove` (`OverviewTrack.tsx:95-128`) with the modifier key bypassing it, and should
   apply to `handleKeyDown` (lines 137-165) too so keyboard users get the same behavior. The snap
   target set is each lap start plus the ride end.

4. **A multi-lap fixture is required.** With the current fixture the only boundaries are `0` and
   `totalElapsedSeconds` — which `Home`/`End` already reach (`OverviewTrack.tsx:151-156`), so
   snapping would be indistinguishable from doing nothing. #23 cannot be manually verified or
   demoed without a `.fit` file that has real interior laps (`lap_trigger: 'manual'` or `distance`).
   Sourcing one should be part of #23's scope.

---

## How to reproduce

From inside `app/` (where `node_modules` lives), with Node >= 22:

```js
import { readFileSync } from 'node:fs';
const FitParser = (await import('fit-file-parser')).default;
const parser = new FitParser({
  force: true, speedUnit: 'm/s', lengthUnit: 'm', temperatureUnit: 'celsius',
  elapsedRecordField: true, mode: 'list',           // exactly what fit-parser.ts passes
});
const data = await new Promise((res, rej) =>
  parser.parse(readFileSync('example-data/24162810642_ACTIVITY.fit'),
    (e, d) => (e ? rej(new Error(e)) : res(d))));

console.log(Object.keys(data).sort());              // includes "laps"
console.log(data.laps.length);                      // 1
console.log(data.laps[0].start_time, data.laps[0].total_elapsed_time, data.laps[0].lap_trigger);
```

## Sources

All primary — library source as installed, the fixture's own bytes, and this repo's source.

- `app/node_modules/fit-file-parser/dist/fit-parser.d.ts` — options and callback surface
- `app/node_modules/fit-file-parser/dist/fit-parser.js` — lap collection (117-119), mode branching (231-251)
- `app/node_modules/fit-file-parser/dist/fit_types.d.ts` — `ParsedFit` (1008-1043), `ParsedSession.laps` (470), `ParsedLap` (472+)
- `app/node_modules/fit-file-parser/dist/binary.js` — `formatByType` date handling (93-97)
- `app/node_modules/fit-file-parser/dist/fit.js` — lap message field definitions (1799-1828)
- `app/node_modules/fit-file-parser/dist/helper.js` — `mapDataIntoLap` (1-25)
- `fit-file-parser@2.1.0` npm tarball — cross-checked against 2.3.3
- `app/example-data/24162810642_ACTIVITY.fit` — parsed, and independently decoded at the byte level
- `app/src/shared/fit-parser.ts`, `app/src/shared/ride-data.ts`, `app/src/preload/index.ts`,
  `app/src/renderer/src/components/timeline/{RideTimeline,OverviewTrack}.tsx`
- `app/package.json:26`, `app/package-lock.json:4814-4817`
