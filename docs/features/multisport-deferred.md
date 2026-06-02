# Multisport Deferred Items

Parking lot for issue #21 follow-up work. These are intentionally out of scope
for the first implementation pass unless the implementation proves they are
needed sooner.

## Database and Migration

- Automatic additive migration for existing DuckDB databases.
  - First pass targets a fresh schema.
  - Likely future work if upstream wants existing users to upgrade without
    wiping/reimporting.
- First-class `activity_laps` table.
  - MVP keeps laps in `metadata_json.laps` with segment assignment fields.
  - Future work can migrate all lap display to `activity_laps` and add a general
    lap API.

## Activity List and Navigation

- URL/query-string support for opening a specific child leg directly.
  - MVP keeps selected child leg in frontend state.
  - Future URL support should use stable `segment_index`, not database
    `segment_id`.
- Detail-page segment selector.
  - MVP selects parent/child legs from the activity list only.
- Child leg rename/custom labels.
  - MVP uses generated names from sport/sub-sport and transition order.
  - Future work could add `activity_segments.custom_name` and a segment-specific
    rename endpoint.

## Overview

- Leg-aware Overview aggregation.
  - MVP Overview remains parent-activity based.
  - Future work could report matching child-leg distance, duration, counts,
    heatmap entries, weekly trend entries, and activity-type donut slices.
- Leg composition chart or leg-aware activity-type donut.
  - MVP Activity Types donut counts the parent as `Multisport`.
  - Future work could show bike/run/transition share inside a multisport event or
    inside filtered/search results.

## Detail Page and Maps

- Garmin Connect-style parent detail page.
  - MVP reuses the existing Individual tab layout for both parent and child
    selections.
- Segment-colored route overlays.
  - MVP maps render the selected record set.
  - Future work could color parent routes by segment and mark segment boundaries.
- Manual leg-boundary editing.

## Calculations and Insights

- Parent-level sport-specific calculations on mixed-sport data.
  - Parent calculation behavior is TBD after the first implementation slice.
  - Segment-scoped calculations are the safer path because each child leg has one
    sport/sub-sport and expected output stream.
- Heart-rate drift on multisport.
  - If/when HR drift exists upstream, it should be disabled on multisport parent
    activities and evaluated on eligible child legs only.

## Export and Compare

- Child-row export.
  - MVP can remain parent-only if needed.
  - Future work could export the currently selected child leg records.
- Child-row compare.
  - MVP should keep compare parent-only unless child rows are represented clearly
    in the compare selection UI.

## Test Fixtures

- Upstream-safe multisport FIT fixture.
  - Synthetic parsed-data tests are safest for MVP.
  - A fabricated or sanitized FIT binary requires extra tooling because FIT is a
    binary format with checksums and possible personal/GPS data.
