# Active-Time Telemetry

## Status

Implemented design for issue #45.

This branch is intentionally stacked on the issue #23 duration fix and issue #38 chart Time/Distance axis work. The active-time implementation builds on both behaviours.

Related issues:

- #23: FIT activity duration uses record span instead of timer time
- #38: Add distance x-axis option to telemetry charts

## Problem

FIT Dashboard can store an activity duration derived from FIT timer time, while telemetry charts still use elapsed record time and raw telemetry records.

For activities with pauses, manual timer stops, or Auto Pause intervals, those values differ:

- activity duration follows active timer time, matching the user-facing Garmin Connect "Total Time" style value
- Strava presents the comparable user-facing concept as "Moving Time"
- telemetry chart Time mode currently follows elapsed record timestamps from the first record to the last record
- telemetry charts currently include any records captured during stopped or paused intervals

This means a ride can show an activity duration of `4:10:00`, while the chart Time axis runs to `4:36:33`. The difference is stopped or paused time.

Issue #23 fixed the stored duration source. Issue #38 added Time/Distance x-axis support and explicit chart bounds. This proposal covers the remaining semantic gap: supporting active-time telemetry that understands FIT timer start/stop intervals.

## Goals

- Parse FIT timer event messages that represent timer start, stop, stop-all, and resume behaviour.
- Preserve whether timer intervals were triggered manually or by Auto Pause / auto-resume when the FIT file provides that detail.
- Persist enough interval metadata to derive active elapsed time for telemetry records.
- Let telemetry charts use active timer time so the Time axis can end near the displayed activity duration.
- Exclude stopped-interval telemetry samples from active-time chart data so paused records do not collapse onto a single x-value or distort chart shape.
- Keep elapsed record time available for diagnostics, export, and possible future UI modes.
- Keep Distance mode distance semantics unchanged while applying the same active-record filtering to eligible telemetry charts.

## Non-Goals

- Do not change stored activity duration selection from issue #23.
- Do not infer moving time from GPS speed or displacement as the primary implementation when FIT timer events are available.
- Do not change distance-axis semantics.
- Do not change map route geometry.
- Do not delete stored raw records; stopped-interval filtering should be a chart/view transformation.
- Do not attempt to make GPX or TCX files fully equivalent to FIT timer events unless their source data explicitly provides comparable pause intervals.

## Source Data

FIT files can contain `event` messages with fields such as:

- `timestamp`
- `event`, for example `timer`
- `event_type`, for example `start`, `stop`, or `stop_all`
- `timer_trigger`, for example `manual` or `auto`
- `event_group`

Timer intervals should be derived from timer events, not from non-timer markers such as off-course alerts, rider position changes, or vendor-specific marker events.

Manual user timer actions and device Auto Pause / auto-resume events should both contribute to the interval model. The trigger should be retained when available so export and diagnostics can explain why a stopped interval exists.

## Proposed Metadata

Store timer interval metadata in `activities.metadata_json` for imported FIT activities. A first version can keep this in metadata rather than adding first-class relational tables.

Example shape:

```json
{
  "timer": {
    "schema_version": 1,
    "source": "fit_event_messages",
    "active_time_supported": true,
    "intervals_reliable": true,
    "elapsed_time_s": 16593.398,
    "timer_time_s": 15000.396,
    "stopped_time_s": 1593.002,
    "events": [
      {
        "timestamp": "2026-06-11T15:47:25Z",
        "event": "timer",
        "event_type": "stop_all",
        "timer_trigger": "auto"
      },
      {
        "timestamp": "2026-06-11T15:57:16Z",
        "event": "timer",
        "event_type": "start",
        "timer_trigger": "auto"
      }
    ],
    "stopped_intervals": [
      {
        "start_ts_utc": "2026-06-11T15:47:25Z",
        "end_ts_utc": "2026-06-11T15:57:16Z",
        "duration_s": 591,
        "trigger": "auto"
      }
    ]
  }
}
```

The parser should tolerate incomplete event pairs. If intervals cannot be derived confidently, `active_time_supported` should be `false` or omitted, and charts should continue using elapsed record time.

Derived intervals should be marked reliable only when their computed active duration is reasonably consistent with the FIT timer duration selected for the activity, allowing for normal timestamp rounding differences.

## Active-Time Telemetry Model

The feature should derive active telemetry from timer intervals:

1. Sort timer events by timestamp.
2. Build stopped intervals from timer stop/stop-all events followed by the next timer start event.
3. Clamp intervals to the activity record/session time range.
4. Ignore invalid intervals with missing timestamps, negative duration, or no matching resume event unless a safe end bound is available.
5. Classify each telemetry record as active or stopped.
6. For each active telemetry record timestamp, subtract all stopped interval durations that ended before the record.

Stopped intervals should be treated as half-open ranges: `[stop_timestamp, next_start_timestamp)`. A record exactly at the stop timestamp is stopped. A record exactly at the following start timestamp is active.

Stopped-interval records should not be plotted in active-time chart data. If they were kept, every record inside a stopped interval would map to the same active timestamp, creating vertical stacks, duplicate x-values, and chart shapes influenced by pause-time values such as zero speed or recovering heart rate.

This produces active telemetry points with:

- original timestamp
- active elapsed time
- elapsed record time
- distance
- telemetry values
- stopped/active classification

The original timestamp and elapsed record time should be preserved for tooltips, export, and diagnostics.

## Chart Behaviour

The existing Time mode should be updated only after the parser, metadata, and active-record filtering support are available.

Expected chart behaviour:

- Time mode uses active elapsed time and active records when reliable timer intervals exist.
- Time mode falls back to elapsed record time when active intervals are unavailable.
- Distance mode keeps cumulative distance as its x-axis.
- Distance mode should use the same active-record filtering as Time mode when reliable timer intervals exist, so stopped samples do not distort telemetry charts.
- Tooltip headers should show active elapsed time and retain the original timestamp context.
- Lap markers should use the same x-axis mapping as the chart data.
- Chart x-axis bounds should continue to use the maximum finite plotted x-value.

A future refinement could expose separate `Elapsed` and `Active` chart time modes. The first implementation can use active telemetry automatically only when reliable FIT timer intervals are present.

The activity map should continue to use the complete route unless a later feature explicitly adds active-only route display.

## Export Behaviour

JSON export should include the timer metadata needed to explain the difference between elapsed and active duration:

- timer event source
- active-time support flag
- elapsed time
- timer time
- stopped time
- stopped intervals with trigger information when available
- per-record active/stopped classification as a future export enhancement
- active elapsed seconds for records as a future export enhancement

The first implementation includes the parsed `metadata_json` object in JSON export so timer events and stopped intervals are available for diagnostics. CSV export does not include the full interval list initially, but exported records may later include active elapsed seconds and stopped/active classification.

## Migration and Reimport

Existing imported activities will not have parsed timer intervals unless they are reimported or explicitly backfilled from the original FIT files.

For a first implementation:

- new imports should populate timer metadata
- existing DB rows can keep working without migration beyond accepting new metadata keys
- no destructive data migration is required
- a future backfill tool can be considered separately

## Validation

Use a Garmin FIT file with known pauses:

- `session.total_timer_time` around `4:10:00`
- `session.total_elapsed_time` around `4:36:33`
- stopped time around `26:33`
- timer events include both manual and automatic triggers

Validation should confirm:

- activity duration still displays timer time
- metadata includes stopped intervals
- derived active duration approximately matches the selected FIT timer duration
- chart Time mode uses active records and ends near the active duration, not elapsed wall-clock duration
- stopped-interval telemetry samples are not plotted in active-time chart data
- distance charts keep distance on the x-axis but use the same active-record filtering decision
- tooltip and lap marker positions remain coherent
- activities without reliable timer intervals fall back to elapsed record time
