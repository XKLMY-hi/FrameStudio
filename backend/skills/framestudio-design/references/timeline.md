# Timeline and animation

Inspect timeline, assets, model_params or property as needed. Time fields in seconds. Keyframe times are local to the visual or audio clip for layer properties, local to the source animation for motion curves, and scene time for camera.

- work_area values: start, end, loop. marker id (omit to create), values: t, name. Use remove:true to delete a marker.
- add_track with values name, muted, solo, locked. track id updates those fields. remove_track deletes its unlocked clips.
- add_clip: layerId, kind visual/motion/audio, assetId (required for motion), trackId (optional), as, values. Expressions are motion clips with override blending.
- clip id, optional trackId, values: name, start, duration, trimIn, speed, weight, fadeIn, fadeOut, blend (mix/add/override), enabled, loop, disabledGroups, disabledIds, lipEnabled, lipTarget, lipWeight, fadeCurve (linear/equalPower). remove_clip uses the clip ID.
- split_clip id, time, as. duplicate_clip id, start, optional trackId and as. remove_clip supports ripple:true within its track.
- keyframes: layerId (or "@camera"), channel, optional clipId, mode ("merge" or "replace", default replace), keys [{t,v,mode}]. Modes linear, step, inverse, bezier. Bezier handles use in/out [time,value] pairs. [] clears a curve. Typical channels x, y, z, scaleX, scaleY, opacity, rotation, reveal, effects.brightness, light.intensity, param:<ID>, motion:<ID>, gain. Inspect first for exact channels and bounds.
- model id, values: physics, lipOpen, lipForm, parameterMap, groupOverrides. model_param id, param and value uses actual runtime parameter limits. preprocess resourceId, enabled, effects, look. Look fields exposure, detail, rolloff, edgeCleanup, diffusion.
- Use editor_analyze_audio with the audio asset ID to generate offline lip-sync cues, then bind a clip to a model layer with lipEnabled and lipTarget. Leave music or ambient clips unbound unless requested.

Use short, coherent batches. New objects and their references can be authored in one batch using aliases. Locked tracks and parent layers can prevent edits.

## Master timeline

Use montage_inspect to read canvas IDs and placed clips. A canvas keeps its own duration, tracks, and scene-local time. A montage clip gives it a start time on the master, a source trimIn, duration, lane (higher is in front), opacity, volume, and optional enter/exit transitions. Use montage_edit for cuts and layering. Use editor_inspect, editor_edit, or editor_render with canvasId for the content inside one canvas. Use montage_render to check the combined result at a master time.
