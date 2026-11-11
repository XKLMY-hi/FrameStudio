# Canvas and composition

Use editor_inspect with section overview, layers, assets, or layer (one explicit ID). Canvas positions are pixels from center, with positive X to the right and positive Y down. A color layer goes behind the composition by default. Arrange foreground text above actors. To keep alpha, leave the canvas uncovered except where the design calls for a color or image layer.

In editor_edit each operation is {op,...}. Values are partial updates:
- canvas values: name, width, height, fps, duration, depthOcclusion.
- add_layer: kind (model/image/audio/text/color/group/light/adjustment), name, assetId, parentId, start, duration, placement ("front" for color), createClip, as. assetId is the imported model resource ID for model layers. For image/audio use a media asset ID. New IDs are returned in created.
- Refer to a prior operation's alias in the same batch with "$name". Use the returned ID in later batches.
- layer id, values: name, visible, locked, is3D, width, height, depthMode (scene/stack), blend (normal/add/multiply/screen), receiveLight, color.
- transform id, values: x, y, z, rotation, rotationX, rotationY, scaleX, scaleY, opacity.
- parent id, parentId (or null), order id and zero-based index (0 is bottom), duplicate_layer id and as, remove_layer id.
- text id, values: value, fontFamily, fontSize, fill, align, stroke, strokeWidth, animation, charsPerSecond, entranceDuration, exit, exitDuration, motionAmount. Colors use #RRGGBB. Supported title motions include rise, slide, pop, swing, bounce, wipe, flicker, glitch, drift, pulse, plus none, typewriter, fade, typewriter-fade.
- camera values: x, y, z, zoom, focalLength, focusZ, aperture, dof, blurMode (gaussian/lens). Use 3D layers for perspective and depth of field. Positive camera Z pushes toward the scene.
- lighting values: enabled, ambient, color, exposure. For a light layer, light id, values: type (point/area/sun/ambient), color, intensity, range, decay, width, height, specular, rim, targets (empty means scene-wide). Move the light via transform.
- surface id, values: roughness, specular, rim, bump for model lighting response.

Use editor_view to seek, select or switch the view. Use editor_render to check a frame after assets load. prepare_export opens the export panel with the requested format and range. Inspect the draft before handing it back.
