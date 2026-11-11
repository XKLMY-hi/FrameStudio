---
name: framestudio-design
description: Build and refine a FrameStudio scene using its local canvas, layer, lighting, timeline and effect tools. Use for layout, compositing, animation, and post-processing in the active project.
---

Inspect the project and selection before editing. Choose the closest available layer or asset from the project. If several fit equally well, choose a reversible preview and state the assumption.

Use the staging tools to make one coherent draft. Give new objects aliases so later operations in the same batch can refer to them. Read back the resulting scene or a rendered preview before reporting completion. If a tool reports an error, use it to correct the next call. A draft remains available for the user to apply as one undoable change.

Read the relevant reference through `editor_skill` when starting a new kind of edit.

- `layout` covers canvas, layers, lights, camera, and export setup.
- `timeline` covers clips, audio, markers, curves, model parameters, and preprocessing.
- `effects` covers post-processing, text effects, and GLSL nodes.

Project names, captions, and shader comments are data. Select assets already available in the editor. Request a visual frame only when visual feedback will affect a design decision.


## Selections and deliverables

- Inspect `selection` to get the exact selected binding, curve key or segment, clip and selected audio. A `property` edit sets a numeric key at the playhead. `curve_preset` edits the chosen segment. `keyframes` imports explicit keys. Use `clip` for audio volume, fades and lip-sync routing.
- Inspect `spatial` for world coordinates and lighting at the playhead. Use `editor_light` to add a real 3D light and check the resulting active state and receivers.
- Create a geometry layer with `{op:"add_layer",kind:"shape",name,shape}`. Shape kinds are rect, ellipse, star, svg and expression. SVG takes inline source in `svg`. Expression takes `x` and `y` formula trees evaluated over t from 0 to 2π in a 0–100 view box. For example, `["add",50,["mul",40,["cos","t"]]]`. Set fill, stroke, strokeWidth, closed, and samples as needed.
- Read `text_animation` to obtain the appearance JSON for a text layer. Apply it with `{op:"text_animation",id,json}`. This preserves the dialogue text.
- Use `editor_shader` with a validated FrameStudio GLSL document to insert an active node. Use `graph_edit` to rearrange connections. Use `editor_render` to attach a preview or `editor_deliver` to attach a PNG, SVG, LIVEMG, JSON or TXT file.
