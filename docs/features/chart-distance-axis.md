# Individual Chart Distance Axis Design

## Summary

Add a control on the Individual page that lets users switch eligible telemetry charts between a Time x-axis and a Distance x-axis.

This feature applies only to time-based telemetry line charts. The effort heatmap is excluded because it is intentionally binned by elapsed minutes rather than plotted as point-by-point telemetry.

## Goals

- Let users inspect activity telemetry by either elapsed time or cumulative distance.
- Keep one shared x-axis mode across all eligible Individual page telemetry charts.
- Preserve existing zoom, smoothing, lap marker, tooltip, and unit behaviour as much as possible.
- Avoid backend or parser changes unless frontend data proves insufficient.

## Non-Goals

- Do not change overview charts, comparison charts, maps, lap tables, or exports.
- Do not convert distribution charts to distance mode.
- Do not include the effort heatmap in this feature.
- Do not change the stored activity or record schema.

## Eligible Charts

The following Individual page charts should support the Time/Distance x-axis toggle:

- Heart Rate
- Pace
- Speed Trend
- Cadence
- Cadence and Power
- Elevation

The following Individual page charts are not time-based telemetry line charts and should not change:

- Heart Rate Zone Time pie chart
- Heart Rate histogram
- Power vs Heart Rate scatter chart
- Effort heatmap

## Existing Data

`RecordPoint` already includes `distance_m`, so the frontend has the core data needed for distance-axis charting.

Downsampled records currently return `distance_m` using `MAX(distance_m)` for each time bucket. That is acceptable for a cumulative distance x-axis because it keeps each bucket at the furthest known distance in that interval.

The parser also derives cumulative distance from GPS points when an activity file has no native distance field. Activities without usable distance data can still exist, so the frontend needs a fallback state.

## User Experience

Add a compact segmented control in the Individual page detail header near the existing Smooth graphs and Reset Zoom controls:

- Time
- Distance

Default mode is Time.

The selected x-axis mode is local UI state. It should not persist across sessions in the initial implementation. This matches the existing Individual page chart controls, such as zoom and graph smoothing, which are held in `Dashboard` state rather than stored in global settings.

When Distance is selected:

- Eligible chart x-axes display cumulative distance in the user-selected distance unit.
- Tooltips still show elapsed time and absolute clock time for context.
- Tooltips should also show distance where useful.
- Lap markers move to their corresponding cumulative distance positions.

When an activity has no usable distance data:

- Reset the mode to Time when switching to that activity.
- Disable Distance for that activity.
- Prefer disabling Distance with a concise tooltip over silently accepting a mode that cannot be rendered.

## Axis Model

Introduce a frontend type such as:

```ts
type TelemetryXAxisMode = "time" | "distance";
```

For each record, build a common chart point context:

```ts
type TelemetryPoint = {
  x: number;
  relMs: number;
  timestampMs: number;
  distanceMeters: number | null;
};
```

For Time mode:

- `x = relMs`
- each axis tick uses elapsed time formatting

For Distance mode:

- `x = convertDistanceMeters(distanceMeters, distanceUnit)`
- each axis tick uses distance formatting with the active distance unit, such as `1.25 km` or `0.75 mi`

Series should keep additional values in the row so tooltip formatters can show both time and distance regardless of current x-axis mode.

## Lap Markers

Current lap markers are timestamp based. Distance mode needs lap marker x-values derived from record distance.

Recommended approach:

1. Parse each lap timestamp.
2. Find the nearest surrounding records by timestamp.
3. Interpolate distance between the surrounding records when both have finite `distance_m`.
4. Fall back to the nearest record distance if interpolation is not possible.
5. Omit the marker if no finite distance is available.

Time mode can keep the current elapsed-time marker calculation.

## Zoom Behaviour

Current chart zoom state is stored as ECharts percentage ranges (`start` and `end`), not raw x-axis values. That can remain shared across Time and Distance modes.

Changing x-axis mode should not require resetting zoom. The same visible percentage range can be applied to the newly selected axis.

The existing Reset Zoom button should continue to clear the shared zoom state.

## Smoothing

Smoothing currently uses a dynamic window based on record count, elapsed duration, and visible zoom percentage.

For the initial implementation, keep the existing smoothing calculation. Distance mode changes the x-coordinate but not the sample order, so rolling averages remain valid.

A future refinement could calculate the smoothing window from visible distance instead of visible duration, but that is not required for this feature.

## Implementation Plan

1. Add `TelemetryXAxisMode` state to `Dashboard`.
2. Add Time/Distance segmented control to the Individual page detail header.
3. Pass `xAxisMode` into `ActivityChart` and `ActivityInsights`.
4. Add shared x-axis formatting helpers for time and distance labels.
5. Refactor `ActivityChart` series data so Heart Rate and Pace use the selected x-axis value.
6. Refactor `ActivityInsights` time-based line chart data for Speed Trend, Cadence, Power, and Elevation.
7. Update tooltip headers to include both time and distance context.
8. Update lap marker creation to support both time and distance modes.
9. Reset the x-axis mode to Time when the selected activity has no finite distance samples.
10. Leave the effort heatmap unchanged and document that it is excluded because it is minute-binned.
11. Add translation keys for the new control labels and tooltip text.

## Validation

Manual validation should cover:

- Time mode remains visually unchanged from current behaviour.
- Distance mode works on an activity with complete distance samples.
- Distance mode is disabled or unavailable for an activity with no finite distance samples.
- Switching to an activity with no finite distance samples resets the mode to Time.
- Lap markers appear in correct positions in both modes.
- Shared zoom still affects all eligible time-based charts.
- Reset Zoom works in both modes.
- Smooth graphs still applies in both modes.
- The effort heatmap remains time-binned and is unaffected by the toggle.
