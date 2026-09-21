# Third-party notices

Margin's original code is licensed under the [MIT License](LICENSE).
Third-party code and assets retain their own licenses.

## PDF.js text-layer CSS

The PDF text-layer rules in `src/styles.css` are adapted from
[`pdfjs-dist/web/pdf_viewer.css`](https://github.com/mozilla/pdfjs-dist/blob/master/web/pdf_viewer.css).

Copyright 2014 Mozilla Foundation

Licensed under the Apache License, Version 2.0. A complete copy is included in
[`licenses/Apache-2.0.txt`](licenses/Apache-2.0.txt).

Modifications: the text-layer rules were extracted, scoped to `.pdf-paper`,
compacted, and adapted to Margin's reader and selectable text layer. Other
viewer styles were omitted. The original copyright and license notice is
preserved alongside the adapted rules.

## npm dependencies and generated assets

Dependencies are installed separately through `pnpm install --frozen-lockfile`; their source code and
the generated `dist/` directory are excluded from this source repository.
Their license files remain in their installed packages. This notice does not
replace those licenses.

If you redistribute a built application, include the applicable copyright
notices and license texts for its bundled dependencies and assets, including
PDF.js, its fonts/CMaps/WebAssembly components, KaTeX, and Lucide icons.
The application-level MIT License does not relicense those components.
