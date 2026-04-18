# 3D UI Navigation Functionality

The 3D scene is the main way the player views the terminal operation.

## Camera Controls

The player can move the camera with keyboard controls:

- Left or A: pan left
- Right or D: pan right
- Up or W: pan forward
- Down or S: pan backward
- Plus: zoom in
- Minus: zoom out

The player can also orbit and zoom the view with the standard 3D camera controls.

## Guided Camera Pans

Tutorial and narrator moments can move the camera toward important operational areas.

Current guided targets include:

- Vessel approach
- Berth
- Crane
- Gatehouse
- Yard
- Import quay buffer
- Export quay buffer
- Yard truck stand
- Out-gate

These camera moves help the player understand where the next operational action is happening.

## Object Selection

The player can click visible objects in the scene.

Clickable objects include:

- Containers
- Reach stacker
- Mobile harbor crane
- In-gate gatehouse area
- Out-gate gatehouse area

Selecting one object clears other selections, so the details panel always focuses on one object type at a time.

Clicking empty space clears the current selection.

## 3D Fallback

If 3D rendering is unavailable, the game shows a simple fallback view and the simulation can still continue in text-oriented mode.

