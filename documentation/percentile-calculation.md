# Commander Percentile Calculation

## Overview

This document explains how we calculate the "top X% of pilots" statistic shown on commander profile pages.

## The Challenge

When a commander has competed in multiple races, we need to summarize their performance with a single percentage. This is non-trivial because:

1. **Field sizes vary** — some races have 5 pilots, others have 100+
2. **Participation varies** — pilots choose which races to enter
3. **It's not a global ranking** — we can't compare pilot A vs pilot B directly, as they may have competed in different races

The key insight: **This metric is a personal performance summary, not a global leaderboard position.**

## Original Implementation (Before April 2026)

```python
overall_pct = round(sum(r["percentile"] for r in races) / len(races), 1)
```

Where `percentile = (position / total_entries) * 100` for each race.

### Problems

- **Field size ignorance**: 50th percentile in a 5-pilot race (3rd of 5) treated identically to 50th percentile in a 100-pilot race
- **Outlier sensitivity**: One bad performance in a small race heavily skews the average
- **Small-race exploitation**: Doing well in races with few competitors inflates the metric
- **Not intuitive**: Averaging percentages loses information about actual competitive outcomes

## Current Implementation (April 2026+)

**Method: Pilots Beaten / Pilots Faced**

```python
total_beaten = sum(r["total_entries"] - r["position"] for r in races)
total_faced = sum(r["total_entries"] for r in races)
overall_pct = round((total_beaten / total_faced) * 100, 1)
```

### How It Works

For each race a commander has competed in:
- Calculate how many pilots they beat: `total_entries - position`
- Sum across all races to get total pilots beaten
- Sum all field sizes to get total pilots faced
- The percentage is: `(total_beaten / total_faced) * 100`

### Example

Commander "Razz" competes in three races:
- **Race A**: 3rd of 10 → beat 7 pilots
- **Race B**: 50th of 100 → beat 50 pilots
- **Race C**: 2nd of 20 → beat 18 pilots

**Total**: Beat 75 out of 130 pilots = **top 42.3%**

### Advantages

✅ **Naturally weights larger races** — a 100-pilot race has 100× the impact of a 1-pilot race
✅ **Accurate** — reflects actual competitive outcomes
✅ **Intuitive** — "You beat X% of all the pilots you raced against"
✅ **Resistant to gaming** — can't inflate the metric by cherry-picking small races
✅ **Fast** — same O(n) performance as the original, no additional database queries

### Limitations

⚠️ **Not a global rank** — two pilots with the same percentage aren't necessarily equal performers (they may have competed in different races)
⚠️ **Large races dominate** — one bad performance in a large race has more impact than in a small race (but this is arguably fairer)
⚠️ **Participation matters** — pilots self-select which races to enter, introducing selection bias

## Alternative Approaches Considered

### Option 2: Median Percentile
```python
percentiles = sorted([r["percentile"] for r in races])
overall_pct = percentiles[len(percentiles) // 2]
```
**Rejected**: Ignores field size entirely, not representative for small sample sizes.

### Option 3: Weighted Average by Field Size
```python
weighted_sum = sum(r["percentile"] * r["total_entries"] for r in races)
total_weight = sum(r["total_entries"] for r in races)
overall_pct = round(weighted_sum / total_weight, 1)
```
**Rejected**: Still averages percentiles (losing information), more complex than Option 1 with similar results.

### Option 4: Trimmed Mean (Drop Outliers)
```python
sorted_pcts = sorted([r["percentile"] for r in races])
trim_count = max(1, len(sorted_pcts) // 10)
trimmed = sorted_pcts[trim_count:-trim_count]
overall_pct = round(sum(trimmed) / len(trimmed), 1)
```
**Rejected**: Arbitrary trim percentage, still ignores field size, added complexity.

## UI Considerations

The display text **"You are in the top X% of pilots overall"** is intentionally worded to indicate performance summary rather than global rank. The word "overall" refers to "across all your races," not "across all pilots in the database."

A tooltip or help text could clarify: *"This shows your performance across all races you've competed in, weighted by field size. It's not a global ranking—different pilots compete in different races."*

## Performance Impact

**None.** The calculation is a simple arithmetic operation on data already fetched from the database. No additional queries required.

Time complexity: O(n) where n = number of races competed (typically 10-100).

## Implementation

**Backend**: [app/queries.py](../app/queries.py) — `get_commander_stats()` function
**Frontend**: [static/js/cmdr.js](../static/js/cmdr.js) — `renderSummary()` function

---

*Last updated: April 14, 2026*
