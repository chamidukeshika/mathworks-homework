# mathworks-homework
Home work app

## Diagrams in questions

Each question can carry a `figure` (a coordinate plane with shapes, drawn as SVG) and/or an `image` (a base64 `data:image/png|jpeg|gif|webp` URL, max ~1.5 MB). Both work in the JSON import and in the question editor (which also has a file picker for pictures).

```json
{
  "question": "Find the gradient of line AB.",
  "marks": 2,
  "figure": {
    "xRange": [-5, 5], "yRange": [-5, 5], "grid": true,
    "elements": [
      {"type": "point", "x": 2, "y": 3, "label": "A", "color": "red"},
      {"type": "segment", "from": [0, 0], "to": [2, 3], "label": "AB"},
      {"type": "line", "slope": 1, "intercept": 1, "dashed": true},
      {"type": "line", "through": [[-3, 0], [0, 4]]},
      {"type": "polygon", "points": [[1, 1], [4, 1], [4, 3]], "vertices": ["P", "Q", "R"]},
      {"type": "circle", "center": [0, 0], "radius": 3},
      {"type": "text", "x": 1, "y": -2, "text": "note"}
    ]
  }
}
```

Colors: blue, red, green, orange, purple, black, or `#rrggbb`. Add `"dashed": true` to lines/segments/polygons/circles.
