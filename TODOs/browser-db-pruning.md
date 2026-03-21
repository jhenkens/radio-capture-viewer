# Browser-side DB Pruning

`transmissionList.localDb` is an in-memory `Record<string, TransmissionDTO>` that grows
indefinitely. During hours of continuous autoplay this accumulates thousands of entries,
causing:

- Increasing memory use (each entry holds metadata + transcript)
- Slower `Object.values(localDb).sort(...)` rebuilds on every new transmission
- Alpine re-rendering the entire `x-for` list on every merge (even off-screen rows)

---

## Pruning strategies

### 1. Count cap (simplest)
After each `_mergeAndRebuild`, if `transmissions.length > MAX` trim the oldest entries
(lowest `recorded_at`) from `localDb`. E.g. keep the most recent 500.

**Risk**: If the user has scrolled far back and we prune what they're looking at, the
rows vanish mid-scroll. Mitigate by only pruning entries more than N rows behind the
viewport or behind the playhead.

### 2. Behind-playhead pruning
Keep a window of K entries before the currently-playing item and all entries after it.
Prune everything older than that window.

**Risk**: `autoplayPendingAfterId` stores the last-played id as an anchor. If that item
is pruned before the next WS push arrives, the autoplay anchor is lost and autoplay
stops. The anchor item must never be pruned.

### 3. Time-based TTL
Remove entries with `recorded_at < Date.now() - TTL_MS`. E.g. keep last 2 hours.

**Risk**: Breaks infinite-scroll pagination — items the server returns for `loadMore`
may fall outside the TTL window and get discarded immediately.

### 4. Virtual scrolling (avoids pruning altogether)
Replace the `x-for` DOM list with a virtual scroller (e.g. `@tanstack/virtual`,
`svelte-virtual-list`, or a lightweight custom implementation). Only the ~20 visible
rows are in the DOM regardless of how many are in `localDb`. No pruning needed.

**Tradeoff**: Significant refactor; Alpine doesn't natively support virtual lists.

---

## Recommended approach

**Short term**: Count cap (strategy 1) with a carve-out for the playhead window.

```
const MAX_ENTRIES = 500;
const PLAYHEAD_LOOKBACK = 50; // entries before playing item that are safe to keep

after sort:
  if transmissions.length > MAX_ENTRIES:
    const keepFrom = max(0, playingIdx - PLAYHEAD_LOOKBACK)
    const keepIds = new Set(transmissions.slice(keepFrom).map(t => t.id))
    // also always keep autoplayPendingAfterId if set
    for (id of Object.keys(localDb)):
      if !keepIds.has(id): delete localDb[id]
    rebuild transmissions from pruned localDb
```

**Long term**: Virtual scrolling to decouple DB size from DOM size entirely.

---

## Other considerations

- Pruning should only happen when the list isn't `loading` or `loadingMore` to avoid
  discarding items that are part of an in-flight paginated query result.
- The `cursor` (pagination bookmark) is a `recorded_at` timestamp. If we prune entries
  newer than the cursor, `loadMore` will re-fetch items we already discarded — harmless
  but wasteful. Keep `cursor` pointing to the oldest retained entry.
- On filter change (`load()`), `localDb` is already cleared entirely — no pruning needed
  at that point.
