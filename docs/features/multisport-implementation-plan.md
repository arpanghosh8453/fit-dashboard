# Multisport Support Implementation Plan

## Status

Implementation planning notes for issue #21. This document is intended to sit
beside the design proposal and translate it into an ordered build plan.

The design proposal is in `docs/features/multisport-support.md`.

## Implementation Principles

- Keep the first pass narrow: parent and child selections reuse the existing
  Individual tab layout.
- Put multisport selection in the activity list. Parent rows expand to child
  leg rows.
- Child rows appear on parent expansion and can also appear in search/filter
  results when they match.
- Do not double-count child rows in overview totals.
- Preserve existing single-sport behavior.
- Treat automatic database migration as deferred but likely future work. Build
  the first implementation against a fresh schema.

## Current Code Baseline

### Backend

- `src-tauri/src/fit_parser.rs`
  - Parses `record`, `session`, and `lap` messages.
  - Session fields are stored in single local variables, so multiple sessions
    overwrite earlier session values.
  - Laps are collected into `metadata_json.laps`.
- `src-tauri/src/models.rs`
  - `ParsedActivity` has one flat activity summary and one flat record list.
  - `RecordPoint` has no segment identifier.
- `src-tauri/src/database.rs`
  - `activities` stores one row per imported file.
  - `records` stores telemetry rows keyed only by `activity_id`.
  - There is no `activity_segments` table.
  - There is no `activity_laps` table.
  - `delete_activity` deletes `records`, then `activities`.
  - `records_downsampled(activity_id, resolution_ms)` returns all records for
    one activity.
- `src-tauri/src/server.rs`
  - `GET /api/records/{activity_id}` returns downsampled activity records.
  - There are no segment or lap endpoints.

### Frontend

- `src/stores/activityStore.ts`
  - Stores one selected activity and one `records` array.
  - `selectActivity(activity)` fetches all records for `activity.id`.
- `src/components/Dashboard.tsx`
  - The sidebar renders one row per imported activity.
  - Sport/search/date/duration filtering is based on the activity list.
  - Activity details, charts, map, stats, and insights render from the selected
    activity and selected `records`.
  - The lap table is built from `selectedActivity.metadata_json.laps`.
- `src/components/ActivityInsights.tsx`
  - Existing upstream insights are telemetry charts, not persisted calculations.
  - There is no heart-rate drift feature in upstream at the time of this plan.

## Decisions For First Pass

### Migration Timing

Implement on a fresh database first. Automatic additive migration is deferred but
likely future work.

Reasoning:

- Parser, segment assignment, insert/delete, API, and UI behavior can be tested
  more directly on a fresh schema.
- Migration code adds compatibility complexity and should not block the first
  implementation slice.
- Upstream maintainer preference is not known yet. The first implementation can
  document the fresh-database requirement, then add automatic migration later if
  upstream wants existing databases to upgrade without wipe/reimport.

### Lap Scope

First pass: keep laps in `metadata_json.laps` and add segment assignment fields
to those lap objects for multisport imports. Defer first-class `activity_laps`.

Current app support:

- Laps are supported in the UI today, but only through `metadata_json.laps`.
- Laps are not supported as database rows or API resources.

Implementation choice:

- Keep existing `metadata_json.laps` shape unchanged for compatibility.
- For single-sport activities, continue using existing metadata-backed laps.
- For multisport, add fields such as `segment_index`, `segment_type`, `sport`,
  and `sub_sport` to each lap metadata object when assignment is known.
- Parent view reads all `metadata_json.laps`.
- Child view filters `metadata_json.laps` by selected `segment_index`.
- Laps with unknown segment assignment remain visible only in the parent view.
- Do not add `activity_laps` or migrate all activity types to first-class laps in
  the first pass.

Deferred/future cleanup:

- Add `activity_laps` for first-class lap storage.
- Migrate all lap display to `activity_laps`.
- Add a general lap API for every activity type.
- Stop relying on `metadata_json.laps` for display after compatibility is proven.

### Child Row Naming and Editing

Child rows should have generated display names, not independent user-editable
activity names in the first pass.

Recommended generated names:

- Sport legs: use the same sport/sub-sport display logic as normal activities,
  but without location. For example, `Indoor Cycling`, `Running`, `Walking`,
  `Cycling`, or repeated labels such as `Indoor Cycling 2` when needed.
- Transition legs: `T1`, `T2`, etc.

Parent activity names remain user-editable through the existing rename path.

Do not add child rename support in the first pass because child rows are not
standalone activities and should not be updated by the existing
`renameActivity(activity_id, name)` endpoint. If editable child labels are later
needed, add a separate `activity_segments.display_name` or
`activity_segments.custom_name` field and a segment-specific rename endpoint.

### Parent Calculation Policy

The upstream app currently has generic telemetry visualizations and summary
stats, but no persisted sport-specific calculation framework and no heart-rate
drift feature.

First pass:

- Parent view shows normal activity summary, charts, map, laps, and existing
  insights using full parent records.
- Treat these as whole-activity telemetry views, not sport-specific performance
  calculations.
- Parent calculation behavior is TBD until after the first implementation slice
  exposes parent and child records cleanly.
- Segment views may run sport-specific calculations later because they are scoped
  to one leg with one sport/sub-sport and one expected output metric.

Known future interaction:

- Heart-rate drift, if added later, should be disabled on multisport parent
  activities and available only on eligible child segments.

Parent calculation options to review after the first slice:

- Leave existing upstream insight charts visible on parent as raw whole-activity
  telemetry.
- Show only clearly generic parent views: summary stats, map, laps, heart-rate
  chart, and elevation chart.
- Hide the insights grid on multisport parent and require child selection for
  leg-level analysis.

## Build Sequence

### 1. Add Domain Types

Add typed parser/domain structures for:

- FIT activity summary.
- FIT session summary.
- FIT lap summary.
- Parsed segment.
- Parsed lap metadata with optional segment assignment.
- Parsed activity with optional segments and segment-tagged lap metadata.

Keep existing `ParsedActivity` behavior for single-sport imports while expanding
it to carry child data.

### 2. Preserve FIT Activity, Sessions, and Laps

Update `fit_parser.rs` to preserve:

- The FIT `activity` message.
- Every FIT `session` message in message order.
- Every FIT `lap` message in message order.
- Session and lap sport/sub-sport.
- Session and lap `start_time`, `total_timer_time`, and
  `total_elapsed_time`.

Do not rely on `session.timestamp` or `lap.timestamp` as an end time for
multisport assignment.

### 3. Detect Multisport

Treat a file as multisport when:

- FIT activity type is `auto_multi_sport`; or
- multiple session messages form a multisport pattern with distinct session
  starts and sport/sub-sport changes, including transition sessions.

Keep detection conservative. If the file does not clearly match, preserve
current single-activity behavior.

### 4. Assign Records and Laps to Segments

Derive segment boundaries from session `start_time` and adjacent session starts.

Use half-open intervals `[start, end)` for assignment.

Record assignment:

- Assign each record to the segment interval containing its timestamp.
- If overlapping intervals exist, assign to the matching segment with the latest
  start time.
- Count unassigned and overlapping records in import diagnostics.

Lap assignment:

- Assign by lap `start_time` against segment intervals.
- If `start_time` is missing, use FIT message order and lap sport/sub-sport.
- If ambiguous, omit `segment_index` from the lap metadata so the lap remains
  visible in the parent view only.

### 5. Add Fresh Schema Support

Add schema for:

- `activities.activity_kind`.
- `records.segment_id`.
- `activity_segments`.
- `activity_laps` is deferred; keep laps in `metadata_json.laps` for MVP.

Fresh-schema implementation can add these directly in `init_schema` before
automatic migration work is added.

### 6. Update Insert, Delete, and Rollback

Update insert flow:

1. Insert parent activity.
2. Insert segments.
3. Store segment-tagged laps in parent `metadata_json.laps`.
4. Insert records with `segment_id`.

Use one transaction where possible.

Update delete and rollback flow:

1. Delete records.
2. Delete segments.
3. Delete parent activity.

Keep blacklist behavior unchanged: user deletion still adds the file hash to the
blacklist after DB rows are removed.

### 7. Add Segment and Lap APIs

Web:

- Add `GET /api/activities/{activity_id}/segments`.
- Do not add a lap endpoint in the first pass; keep laps in activity metadata.
- Extend `GET /api/records/{activity_id}` with optional segment filtering.

Desktop/Tauri:

- Add matching command for segment list.
- Extend `get_records` with optional segment filtering.

Adapters:

- Keep web and desktop API behavior aligned.
- Use `segment_index` in frontend state, resolving it to `segment_id`
  internally for API calls. Route/query-string support for selected child legs is
  deferred as a likely future enhancement; if added later, expose stable
  `segment_index` in the URL rather than database `segment_id`.

### 8. Update Frontend State

Extend `activityStore` to track:

- Selected parent activity.
- Optional selected segment index.
- Selected records scoped to parent or child.
- Segment list for the selected parent.
- Laps scoped to parent or child from segment-tagged activity metadata.

When no segment is selected, fetch parent records and use parent laps.

When a segment is selected, fetch segment-scoped records and show only laps for
that segment when lap scoping is available.

### 9. Update Activity List

Add expandable parent rows:

- Parent row opens the whole activity.
- Expanding the row shows child legs.
- Child row opens the same Individual tab scoped to that segment.
- Child rows are visually subordinate.
- Transition rows are visible and selectable, but visually de-emphasized.

Search/filter behavior:

- Parent rows participate in filters as before.
- Child rows also participate in search/filtering.
- Filtering for `running` may show the running child row without showing the
  cycling or transition sibling rows.
- If a matching child row is shown, show a compact parent context row with only
  the applicable matching children beneath it.
- Child rows must not increase overview totals or activity counts.

### 10. Reuse Individual Tab Layout

Do not add a detail-page segment selector in the first pass.

Parent selected:

- Existing Individual tab layout renders full parent activity data.

Child selected:

- Existing Individual tab layout renders selected segment data.

Transition selected:

- Existing Individual tab layout renders transition data as a generic GPS
  movement segment when streams exist.

### 11. Update Overview UI

Overview remains parent-activity based in the first pass. The current Overview
page does use the sidebar filters because `Dashboard.tsx` passes the filtered
activity array into the overview cards, heatmap, donut, map, weekly trend, and
table. A multisport event and its child legs count as one activity for overview
statistics. Child legs do not add separate overview counts, totals, averages,
heatmap cells, weekly trend entries, sport donut slices, or overview table rows.

Overview cards:

- Filtered activity count counts the parent once.
- Total distance uses the parent activity distance.
- Total duration uses the parent activity duration.
- Average distance and average duration divide by the number of parent
  activities, not by the number of child legs.
- Unique sports should include `Multisport` as the parent sport/category. It
  should not count every child sport as a separate overview activity type unless
  a later leg-level overview is added.

Activity Contributions heatmap:

- Current implementation counts activities per calendar day. It does not use
  distance, duration, or intensity.
- For each activity, `ActivityContributionHeatmap` buckets
  `activity.start_ts_utc` by local day and increments that day by one.
- Cell color is relative to the busiest day in the displayed range:
  - `0`: grey `rgba(148, 163, 184, 0.20)`
  - `count / maxCount < 0.25`: `#155e75`
  - `count / maxCount < 0.5`: `#0891b2`
  - `count / maxCount < 0.75`: `#06b6d4`
  - otherwise: `#22d3ee`
- A multisport parent contributes one count on its parent start date. Child legs
  do not add additional heatmap counts.

Weekly Training Trend:

- Current implementation sums distance and duration per parent activity week.
- A multisport parent contributes its parent distance and parent duration once.
- Child legs do not create separate weekly entries.

Sport Type Donut:

- Current implementation is the Activity Types donut. It counts parent
  activities by `activity.sport`; it does not measure distance, duration, or leg
  composition.
- Multisport parents should use a parent sport/category such as `Multisport`.
- Child legs should not be counted in the donut in the first pass. A leg-aware
  donut or separate leg composition chart, such as showing bike/run/transition
  share inside a multisport event or inside filtered/search results, is future
  enhancement.

Overview activity table:

- Show one row for the multisport parent.
- Do not show child legs as separate rows in the overview table for the first
  pass.
- The parent row may show a small multisport/leg-count indicator if it can be
  done without changing table behavior.

Filtering nuance:

- The activity list can expose child rows when search/filter criteria match a
  leg.
- Overview statistics should still aggregate parent activities only.
- If a filter matches a child leg, include the parent activity once in overview
  totals rather than counting the child as a separate activity. This preserves
  the rule that the event is one activity.
- Reporting matching child-leg distance, duration, count, heatmap entries,
  weekly trend entries, or donut slices is future enhancement. That would require
  a leg-aware Overview aggregation model instead of passing only parent
  activities into the current Overview components.

### 12. Exports and Compare

Keep export and compare behavior parent-only for the first pass. Child-row export
and child-row compare are second-pass items tracked in
`docs/features/multisport-deferred.md`.

### 13. Automatic Migration Deferred

Automatic migration is deferred but likely future work and tracked in
`docs/features/multisport-deferred.md`. The first implementation pass targets a
fresh schema.

## Test Plan

Backend parser tests:

- Single-sport FIT import remains unchanged.
- Multisport FIT preserves all sessions.
- Multisport FIT preserves all laps.
- Session fields are not overwritten by later sessions.
- Activity message data is preserved.
- Transition sessions are detected as child legs.

Segment assignment tests:

- Records assign to expected segment by timestamp.
- Laps assign to expected segment by start time.
- Missing or ambiguous laps remain parent-only.
- Overlap and unassigned diagnostics are recorded.

Database tests:

- Fresh DB creates new tables/columns.
- Multisport insert writes parent metadata with segment-tagged laps, segments,
  and records.
- Delete removes records, segments, and parent.
- Failed import rollback removes all child rows.
- Overview totals count parent only.

API/Tauri tests:

- Parent records endpoint returns all parent records.
- Segment-scoped records endpoint returns only child records.
- Parent view reads all metadata laps.
- Child view filters metadata laps by selected segment index.
- Web and Tauri commands return matching shapes.

Frontend tests:

- Parent row expands to child rows.
- Child row selection scopes records, map, charts, stats, and laps.
- Search/filter can show matching child rows.
- Overview totals do not double-count children.
- Parent rename still works.
- Child rows are not user-editable in the first pass.

Migration tests are deferred with automatic migration.

## Deferred

Deferred and second-pass items are tracked in
`docs/features/multisport-deferred.md`.
