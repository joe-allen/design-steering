# FAQ

### Why can a comment fetch fail on a layer that looks like a solid color?

Figma can return the comment and list the frame it belongs to, then return a server error when the app tries to read the layers inside another frame. That does not mean your comment is too deeply nested.

In one design, a screenshot layer had been kept as a colored shape after its image was removed. Removing those former image layers let the fetch finish. Figma did not report why they failed; this is not a general problem with image fills, and a screenshot-style layer name alone does not identify a bad layer.

Use the reported layer path to find the affected branch. If a former image layer is only providing a background, try replacing it with a new solid rectangle or putting the fill on the enclosing frame. Test the edit in a copy or keep it undoable. There is no need to flatten the design or move a working comment pin.

If the app offers **Save partial export**, it has confirmed some threads but could not check the whole page. Save to keep those matches with a warning, or choose **Discard** to save nothing. After repairing the layer, fetch again (or **Sync comments** from the saved run) for a fresh scan.
