# Garmin Planned Workouts Investigation

## Summary

Garmin planned workout activities import as regular activities today, but their
FIT files contain extra planned-workout metadata. This applies to Daily
Suggested Workouts, Garmin Coaching Plan workouts, and third-party workouts
synced into Garmin and recorded on a Garmin device. The preserved metadata can
support a workout-aware interval table instead of showing only generic laps.

This document records current findings from sample files. It keeps the original
Daily Suggested Workout examples, adds a Garmin Coaching Plan cycling sample,
and adds a TrainerRoad workout that was synced into Garmin and recorded as a
Garmin planned workout using the same FIT structures.

The investigation focused on:

- `20122336922_ACTIVITY.fit` - Daily Suggested cycling sprint workout
- `22730347417_ACTIVITY.fit` - Daily Suggested running base workout
- `23122091367_ACTIVITY.fit` - Daily Suggested running sprint workout
- `23259835588_ACTIVITY.fit` - Garmin Coaching Plan cycling sprint workout
- `23411360356_ACTIVITY.fit` - TrainerRoad `Stickney` workout synced into
  Garmin and recorded as a Garmin planned workout
- `23460091826_ACTIVITY.fit` and `23432217406_ACTIVITY.fit` - TrainerRoad-created
  activity FIT counterexamples; these have `FileId.manufacturer=trainer_road`
  but no `Workout` or `WorkoutStep` messages and no workout-title strings
- matching Garmin Connect GPX and TCX exports for the Daily Suggested examples

## Current App Behaviour

On the `feature-33-daily-workouts` branch, the current parser imports these
FIT files as normal activities. Regular telemetry, session summaries, and lap
summaries are available.

The current parser does not preserve the Garmin planned-workout structure:

- `Workout.wkt_name`
- `Workout.wkt_description`
- `Workout.num_valid_steps`
- `Workout.capabilities`
- `WorkoutStep` definitions
- `WorkoutStep.notes`, when present
- `TrainingFile` metadata
- `Lap.wkt_step_index`
- lap `intensity`, when present

As a result, FIT Dashboard cannot currently show Garmin-style `Intervals`
tables for these activities.

## File Format Findings

### FIT

FIT is the useful source for workout structure.

The samples contain a `Workout` message:

```text
Workout.wkt_name
Workout.wkt_description
Workout.num_valid_steps
Workout.sport
Workout.capabilities
```

Daily Suggested running example:

```json
{
  "wkt_name": "Sprint",
  "num_valid_steps": 5,
  "sport": "running"
}
```

Garmin Coaching Plan cycling example:

```json
{
  "wkt_name": "Sprint",
  "wkt_description": "2x16x0:10@355W",
  "num_valid_steps": 7,
  "sport": "cycling"
}
```

TrainerRoad workout synced into Garmin and recorded on a Garmin device:

```json
{
  "wkt_name": "Stickney",
  "capabilities": "tcx",
  "sport": "cycling",
  "sub_sport": "generic"
}
```

That activity also contains `TrainingFile` provenance:

```json
{
  "type": "workout",
  "manufacturer": "garmin",
  "garmin_product": "connect"
}
```

This sample is useful because it is not a Daily Suggested Workout and not a
Garmin Coaching Plan workout. It shows that third-party planned workouts can use
the same Garmin planned-workout FIT structures after they are synced into Garmin
and recorded on a Garmin device. The activity `FileId.manufacturer` is still
`garmin` (FIT manufacturer id `1`), so the FIT does not obviously preserve
TrainerRoad as the original workout source.

The samples also contain `WorkoutStep` messages. Fields observed include:

```text
WorkoutStep.message_index
WorkoutStep.wkt_step_name
WorkoutStep.duration_type
WorkoutStep.duration_value
WorkoutStep.target_type
WorkoutStep.target_value
WorkoutStep.custom_target_value_low
WorkoutStep.custom_target_value_high
WorkoutStep.intensity
WorkoutStep.notes
```

Examples of planned-workout descriptions or step strings found in raw FIT
strings:

```text
2x15x0:10@360W
2x16x0:10@355W
5x0:10@3:25/km
15 minutes warmup.
Hit lap to start main set.
55 minutes Endurance.
Spin easy for 20 minutes.
Hit lap when finished.
```

The first two describe cycling sprint workouts. The first means two sets of
fifteen 10-second sprint efforts at 360 W; the Coaching Plan sample uses two
sets of sixteen 10-second sprint efforts at 355 W.

The two TrainerRoad-created activity FIT counterexamples differ from the Garmin
recorded sample. They contain `FileId.manufacturer=trainer_road` (FIT
manufacturer id `281`), session/lap summary data, and lap interval rows, but no
decoded `Workout`, `WorkoutStep`, `Sport.name`, `TrainingFile`, or workout-title
strings. FIT Dashboard cannot
recover names such as `Three Sisters 2`, `Tallac - 4`, or `Ramp Test` from those
files if they are not present in the FIT bytes.

FIT lap messages link recorded laps back to planned workout steps with:

```text
Lap.wkt_step_index
```

Lap messages also include ordinary lap fields such as:

```text
lap_trigger
total_timer_time
total_elapsed_time
total_distance
avg_heart_rate
avg_power
normalized_power
```

`lap_trigger` is not unique to Garmin planned workouts. It is also present on
regular activities. It tells why a lap ended, such as `distance`, `time`, or
`session_end`.

### GPX

GPX preserves the activity-level workout name in the track name:

```xml
<name>Calgary - Sprint</name>
<type>running</type>
```

or:

```xml
<name>Calgary - Base</name>
<type>running</type>
```

GPX does not preserve the interval/workout-step structure.

### TCX

The TCX exports appear to preserve normal lap and trackpoint data, but not the
planned-workout structure. A quick text scan did not find workout names, step
names, or interval labels comparable to the FIT workout metadata.

## Unique Garmin Planned Workout Fields

Compared with a regular cycling FIT sample, `23060547104_ACTIVITY.fit`, the
planned-workout-specific fields are:

```text
workout
workout.num_valid_steps
workout.sport
workout.wkt_name
workout.wkt_description
workout.capabilities

training_file
training_file.type
training_file.manufacturer
training_file.garmin_product

workout_step
workout_step.message_index
workout_step.wkt_step_name
workout_step.duration_type
workout_step.duration_value
workout_step.target_type
workout_step.target_value
workout_step.custom_target_value_low
workout_step.custom_target_value_high
workout_step.intensity
workout_step.notes

laps[].wkt_step_index
```

Fields such as `lap_trigger`, lap time, lap distance, lap power, lap heart
rate, lap calories, and lap `normalized_power` are useful for display but are
not unique to Garmin planned workouts.

## Reconstructing Garmin-Style Interval Tables

Garmin Connect labels the table as `Intervals`, not `Laps`, for these
planned workouts. The displayed rows are partly recorded laps and partly derived
workout-step summary rows.

The table can be reconstructed from:

- `Workout.wkt_name`
- `Workout.wkt_description`
- `WorkoutStep.message_index`
- `WorkoutStep.wkt_step_name`
- `WorkoutStep.duration_type`
- `WorkoutStep.duration_value`
- `WorkoutStep.target_type`
- `WorkoutStep.custom_target_value_low/high`
- `WorkoutStep.intensity`
- `WorkoutStep.notes`
- `WorkoutStep.repeat_steps`
- `WorkoutStep.duration_step`
- `Lap.wkt_step_index`
- lap `intensity`, when present
- lap `lap_trigger`
- lap order
- lap `total_timer_time`
- lap `total_distance`

For first implementation, showing recorded lap rows with workout-derived labels
is likely enough. Garmin-style group rows, such as `Warm Up 1 - 3`, can be added
after the raw step/lap mapping is preserved.

## Interval Table Reconstruction Process

The reconstructed table below was produced from decoded FIT lap fields plus the
workout metadata found in the same file.

Process used:

1. Read the `Workout` message to identify the workout name, description,
   sport, and planned step count.
2. Read all `WorkoutStep` messages. Each step is keyed by
   `WorkoutStep.message_index`.
3. Read all `Lap` messages in chronological order.
4. For each lap, read:
   - `wkt_step_index`
   - `intensity`, when present
   - `lap_trigger`
   - `total_timer_time`
   - `total_distance`
5. Match each lap to its planned step using:

   ```text
   Lap.wkt_step_index == WorkoutStep.message_index
   ```

6. Derive the displayed row type from the matched `WorkoutStep.intensity`.
   Use lap `intensity` only as a fallback when it is present:
   - `warmup` -> `Warm Up`
   - `interval` -> sport-specific work label such as `Run` or `Bike`
   - `rest` or `recovery` -> `Recovery`
   - `cooldown` -> `Cool Down`
7. Number repeated work/recovery pairs by chronological occurrence. For the
   running sprint sample, each `interval` lap followed by a `rest` lap becomes
   interval `1`, `2`, `3`, etc.
8. Calculate cumulative time by summing lap `total_timer_time` values in order.
9. Convert distance from metres to kilometres for display.
10. Add derived group rows by grouping contiguous laps that share the same
    high-level section, such as warmup or cooldown. The group row has no lap
    number and uses the summed time, final cumulative time, and summed distance.

Notes:

- A final `session_end` lap may have an `intensity` but no `wkt_step_index`.
  For the running sample below, it is grouped with cooldown because it has
  `intensity=cooldown` and immediately follows the planned cooldown step.
- Lap `intensity` is optional. In the Garmin Coaching Plan cycling sample,
  all 67 lap messages include the field but its value is null. In that case,
  row labels must come from the matched `WorkoutStep.intensity`.
- Repeat/control workout steps, such as `repeat_until_steps_cmplt`, describe
  planned repetition structure and may not map directly to recorded laps.
- Garmin Connect may use additional internal logic for exact grouping. The goal
  here is to preserve enough fields that FIT Dashboard can reproduce a close,
  deterministic interval table.

## Reconstructed Running Sprint Table

Source file:

```text
23122091367_ACTIVITY.fit
```

Workout:

```json
{
  "wkt_name": "Sprint",
  "num_valid_steps": 5,
  "sport": "running"
}
```

Workout step string found in FIT:

```text
5x0:10@3:25/km
```

Lap data used:

| Lap | wkt_step_index | Intensity | Trigger | Time | Distance km |
|---:|---:|---|---|---:|---:|
| 1 | 0 | warmup | distance | 5:53.7 | 1.00 |
| 2 | 0 | warmup | distance | 6:10.0 | 1.00 |
| 3 | 0 | warmup | time | 2:56.3 | 0.46 |
| 4 | 1 | interval | time | 0:10 | 0.05 |
| 5 | 2 | rest | time | 3:00 | 0.26 |
| 6 | 1 | interval | time | 0:10 | 0.06 |
| 7 | 2 | rest | time | 3:00 | 0.27 |
| 8 | 1 | interval | time | 0:10 | 0.06 |
| 9 | 2 | rest | time | 3:00 | 0.27 |
| 10 | 1 | interval | time | 0:10 | 0.06 |
| 11 | 2 | rest | time | 3:00 | 0.25 |
| 12 | 1 | interval | time | 0:10 | 0.05 |
| 13 | 4 | cooldown | distance | 6:27.9 | 1.00 |
| 14 | 4 | cooldown | time | 3:32.1 | 0.54 |
| 15 | none | cooldown | session_end | 0:02.2 | 0.01 |

Reconstructed table:

| Interval | Step Type | Lap | Time | Cumulative Time | Distance km |
|---|---:|---:|---:|---:|---:|
| Warm Up | 1 - 3 |  | 15:00 | 15:00 | 2.46 |
| Warm Up | 1 | 1 | 5:53.7 | 5:53.7 | 1.00 |
| Warm Up | 2 | 2 | 6:10.0 | 12:03.7 | 1.00 |
| Warm Up | 3 | 3 | 2:56.3 | 15:00 | 0.46 |
| 1 | Run | 4 | 0:10 | 15:10 | 0.05 |
| 1 | Recovery | 5 | 3:00 | 18:10 | 0.26 |
| 2 | Run | 6 | 0:10 | 18:20 | 0.06 |
| 2 | Recovery | 7 | 3:00 | 21:20 | 0.27 |
| 3 | Run | 8 | 0:10 | 21:30 | 0.06 |
| 3 | Recovery | 9 | 3:00 | 24:30 | 0.27 |
| 4 | Run | 10 | 0:10 | 24:40 | 0.06 |
| 4 | Recovery | 11 | 3:00 | 27:40 | 0.25 |
| 5 | Run | 12 | 0:10 | 27:50 | 0.05 |
| Cool Down | 13 - 15 |  | 10:02.2 | 37:52.2 | 1.55 |
| Cool Down | 13 | 13 | 6:27.9 | 34:17.9 | 1.00 |
| Cool Down | 14 | 14 | 3:32.1 | 37:50 | 0.54 |
| Cool Down | 15 | 15 | 0:02.2 | 37:52.2 | 0.01 |

The final 2.2-second `session_end` lap has `intensity=cooldown` but no
`wkt_step_index`. The planned cooldown step itself is 10:00 across laps 13 and
14. Garmin adds lap 15 as Cool Down as well.

## Garmin Coaching Plan Cycling Sprint Sample

Source file:

```text
23259835588_ACTIVITY.fit
```

Workout:

```json
{
  "wkt_name": "Sprint",
  "wkt_description": "2x16x0:10@355W",
  "num_valid_steps": 7,
  "sport": "cycling",
  "sub_sport": "generic"
}
```

Workout steps:

| Step | Intensity | Duration Type | Duration | Repeat | Target |
|---:|---|---|---:|---:|---|
| 0 | warmup | time | 20:00 |  | 3s power 111-152 W |
| 1 | interval | time | 0:10 |  | 3s power 304-405 W |
| 2 | recovery | time | 0:20 |  | 3s power 1-132 W |
| 3 | active | repeat_until_steps_cmplt |  | 16 | repeat control from step 1 |
| 4 | recovery | time | 5:00 |  | 3s power 91-132 W |
| 5 | active | repeat_until_steps_cmplt |  | 2 | repeat control from step 1 |
| 6 | cooldown | time | 15:00 |  | 3s power 91-132 W |

Recorded lap mapping:

| wkt_step_index | Matched Step | Lap Count | Notes |
|---:|---|---:|---|
| 0 | warmup | 2 | first lap ends by distance, second by time |
| 1 | interval | 32 | 10-second cycling sprint efforts |
| 2 | recovery | 30 | 20-second short recoveries |
| 4 | recovery | 1 | 5-minute recovery between sprint sets |
| 6 | cooldown | 1 | planned cooldown |
| none | none | 1 | final `session_end` lap |

The Garmin Coaching Plan sample confirms that the same FIT structures are not
limited to Daily Suggested Workouts. It also shows why `WorkoutStep.intensity`
should be the primary label source: lap `intensity` is null for every lap in
this file.

## Strength Training Planned Workout Boundary

Source file:

```text
23264397268_ACTIVITY.fit
```

This file is also a Garmin planned workout, but it is a strength-training
activity rather than an endurance interval activity:

```json
{
  "wkt_name": "Total Body Circuit 3",
  "num_valid_steps": 15,
  "sport": "training",
  "sub_sport": "strength_training"
}
```

Observed message counts include:

```text
workout: 1
workout_step: 15
set: 43
exercise_title: 7
split: 42
lap: 0
```

This is an important boundary case for the design. The planned-workout metadata
still exists, but the recorded execution does not map through lap messages.
There are no `Lap` messages. Instead, the file includes `Set` messages with
`wkt_step_index`, plus `ExerciseTitle` messages with names such as `Squat`.

That means strength/training planned workouts need a different UI model from the
initial endurance interval table:

- endurance planned workouts can use `Lap.wkt_step_index` to build an
  `Intervals` table
- strength planned workouts likely need `Set.wkt_step_index` and
  `ExerciseTitle` support to build a `Sets` or `Exercises` table

Strength/training planned workouts are not in the initial implementation scope.
The first implementation should preserve the generic planned-workout metadata
where practical, but the first UI should target endurance planned workouts with
lap-based interval reconstruction. Strength/training support needs further
investigation before implementation.

## Initial Implementation Scope

Initial scope:

- Preserve `Workout` metadata in activity metadata JSON, including
  `wkt_name`, `wkt_description`, `sport`, `sub_sport`, `num_valid_steps`, and
  `capabilities` when present.
- Preserve `TrainingFile` metadata, including type, manufacturer, and Garmin
  product when present.
- Preserve `WorkoutStep` metadata, including message index, duration, target,
  intensity, repeat/control fields, notes, and available names or descriptions.
- Preserve lap `wkt_step_index`, `lap_trigger`, and lap `intensity` when
  present.
- Show an endurance-focused `Intervals` table for planned workouts that have
  lap-to-step mappings.

Out of initial scope:

- Strength/training `Set` and `ExerciseTitle` UI.
- Garmin-style derived group rows.
- Execution score calculation or extraction.
- Activity-name changes based on workout name.
- Recovering workout names from TrainerRoad-created activity FIT files that do
  not contain `Workout` metadata or workout-title strings.

## Activity Naming Considerations

Garmin Connect appears to separate activity title, sport icon, and sport/subsport
subtext.

Observed regular road-cycling activity display:

```text
Title: Calgary Road Cycling
Icon: cycling
Subtext: Road Cycling
```

Observed Garmin planned-workout road-cycling display:

```text
Title: Calgary - Sprint
Icon: cycling
Subtext: Road Cycling
```

The Garmin-recorded TrainerRoad `Stickney` sample also stores its workout name
in `Workout.wkt_name`, which supports the same naming model for third-party
workouts synced through Garmin.

This suggests Garmin uses `Workout.wkt_name` as a display-title suffix when a
planned workout exists, while preserving canonical sport/subsport separately.
The underlying activity is still road cycling; the workout name changes the
activity title, not the sport classification.

A Connect-like title rule would be:

```text
if location and Workout.wkt_name exist:
    title = "{location} - {Workout.wkt_name}"
else:
    title = existing normal activity-name logic
```

FIT Dashboard consideration: the current app does not have a separate sport icon
or sport/subsport sublabel in the activity list equivalent to Garmin Connect's
layout. It primarily has one `activity_name` field. If the name becomes
`Calgary - Sprint`, the sport context may be less visible unless the UI also
shows sport/subsport elsewhere. That should be considered before changing import
naming behaviour.

## Execution Score

Garmin Connect shows an execution score for at least some planned workouts. I
did not find an explicit decoded field named execution score, adherence score,
compliance score, or similar in the known fields exposed by the JavaScript FIT
parser used for investigation.

Related fields observed:

```text
session.workout_feel
session.workout_rpe
session.total_training_effect
session.total_anaerobic_training_effect
session.training_load_peak
session.primary_benefit
activity_metrics[].aerobic_training_effect
activity_metrics[].anaerobic_training_effect
activity_metrics[].primary_benefit
```

These are not the same as workout execution score.

Possible explanations:

- Garmin Connect calculates execution score server-side from planned target
  ranges and recorded telemetry.
- The score is stored in a FIT field that the current parser does not decode by
  name.
- The score is available through Garmin Connect APIs but not included in
  activity FIT exports.

For implementation, treat execution score as unresolved. Preserve enough planned
step target data and recorded lap/record data that a future implementation could
calculate a local approximation if Garmin's exact value is not available.

Known sample values:

- `23122091367_ACTIVITY.fit` shows `98%` execution score in Garmin Connect.
- `22730347417_ACTIVITY.fit` shows `84%` execution score in Garmin Connect.
- These values have not yet been found as named decoded FIT fields.

## Open Questions

- Can Rust `fitparser` expose all `Workout` and `WorkoutStep` messages,
  including repeat/control fields, descriptions, intensities, and target ranges?
  The JavaScript parser used in investigation collapsed repeated `WorkoutStep`
  messages into a single `workout_step` object.
- What is the minimal useful display model for strength/training planned
  workouts that use `Set.wkt_step_index` and `ExerciseTitle` instead of
  lap messages?
- Are Garmin Connect execution scores present in standard FIT fields that
  require additional enum decoding, or are they only available through Garmin
  Connect outside the exported FIT?
- Should first implementation show only recorded intervals, or also derived
  Garmin-style group rows?
- Should workout names influence `activity_name` on import, or should FIT
  Dashboard first add a separate sport/subsport indicator so sport context is
  not lost when titles become location-plus-workout-name?
