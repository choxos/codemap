# codemap

A zoomable map of any public GitHub repository:
**https://choxos.github.io/codemap/**

Folders are drawn as nested boxes sized by lines of code, and every file is a
texture of its own code that resolves into syntax colored text as you zoom in.
Brace and indentation blocks are outlined inside files, an inspector shows
details with permalinks back to GitHub, and search covers every line. In the
style of Makepad Scope.

## Use

Type `owner/repo` or paste a GitHub URL into the box at the top. Every map has
a link you can share:

    https://choxos.github.io/codemap/?repo=pallets/flask
    https://choxos.github.io/codemap/?repo=microsoft/vscode&path=src/vs/base
    https://choxos.github.io/codemap/?repo=choxos/mlumr&ref=release/v0.2.0

`ref` takes a branch, tag or commit and defaults to the default branch. `path`
maps a single folder. A pasted `github.com/<owner>/<repo>/tree/<ref>/<folder>`
URL sets both; for a branch name that contains a slash, use `ref=` instead.

## Controls

- scroll or pinch: zoom about the cursor
- drag: pan
- double click: zoom to a box
- click: pin a box in the inspector (and, once code is readable, the line under the cursor)
- `/`: search, `Home`: fit the whole map, `Esc`: clear the selection
- Labels, Scopes and 3D toggles in the top bar (3D is view only)

## How it works

Everything runs in your browser; there is no server. codemap asks the GitHub
API for the commit and its file tree (two requests), then downloads each source
file from raw.githubusercontent.com, pinned to that commit. Binary, vendored,
minified, lock and generated files are left out, as are files over 512 KB. A
repository with more than 6,000 source files or 40 MB of source is too big to
load at once; codemap then lists its largest folders so you can map one at a
time.

Without a token GitHub allows 60 API requests an hour per network. A
fine-grained token with no extra permissions raises that to 5,000: paste it
under "GitHub token" on the start panel. It is saved in the browser's local
storage for choxos.github.io, which other pages on that domain can read, and
is sent only to api.github.com. Private repositories are not supported.

## Develop

No build step and no dependencies. Serve the folder and open it:

    python3 -m http.server 8000

`index.html` holds the page, `loader.js` fetches and filters a repository, and
`app.js` draws the map. `node check.mjs` checks input parsing and the file rules,
then loads real repositories through the loader (set `GITHUB_TOKEN` if the API
rate limit runs out).
