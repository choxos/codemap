// codemap loader: reads a public GitHub repository into the tree the map
// draws. Two GitHub API requests (the commit, then its file tree), then every
// source file from raw.githubusercontent.com, pinned to that commit.
// A plain script, so index.html can load it and check.mjs can import it.
(function () {
  'use strict';

  // ponytail: fixed caps keep one browser tab responsive; bigger repos are mapped a folder at a time
  const MAX_FILES = 6000, MAX_BYTES = 40e6, MAX_FILE = 512e3, POOL = 24;

  // Source languages by file extension (lowercase). Anything else is left out.
  const EXTS = {
    javascript: 'js mjs cjs jsx', typescript: 'ts mts cts tsx', python: 'py pyi pyw pyx pxd bzl bazel star',
    go: 'go', rust: 'rs', java: 'java', kotlin: 'kt kts', scala: 'scala sc sbt', groovy: 'groovy gradle',
    c: 'c h', 'c++': 'cc cpp cxx hh hpp hxx inl ipp tpp ino cu cuh', 'objective-c': 'mm', matlab: 'm',
    'c#': 'cs csx', 'f#': 'fs fsi fsx', swift: 'swift', dart: 'dart', php: 'php', ruby: 'rb rake gemspec podspec',
    perl: 'pl pm', lua: 'lua', r: 'r', 'r markdown': 'rmd qmd', rd: 'rd', stan: 'stan', julia: 'jl',
    elixir: 'ex exs', erlang: 'erl hrl', haskell: 'hs lhs purs', elm: 'elm', ocaml: 'ml mli',
    lisp: 'clj cljs cljc edn lisp el scm rkt', zig: 'zig', nim: 'nim nims', shell: 'sh bash zsh fish ksh',
    powershell: 'ps1 psm1 psd1', sql: 'sql', graphql: 'graphql gql', protobuf: 'proto', solidity: 'sol',
    glsl: 'glsl vert frag geom comp hlsl wgsl metal',
    html: 'html htm xhtml vue svelte astro hbs mustache ejs erb jinja j2 njk liquid twig cshtml razor jsp',
    xml: 'xml xsd xsl xslt csproj fsproj vbproj props targets', css: 'css', scss: 'scss less', sass: 'sass styl',
    markdown: 'md markdown mdx rst adoc org', text: 'txt bat cmd',
    json: 'json jsonc json5 ipynb webmanifest eslintrc prettierrc babelrc', yaml: 'yml yaml cff', toml: 'toml',
    config: 'ini cfg conf properties gitignore gitattributes gitmodules dockerignore npmignore editorconfig npmrc nvmrc env rbuildignore lintr',
    tex: 'tex sty cls bib', make: 'mk mak', cmake: 'cmake', dockerfile: 'dockerfile', hcl: 'tf tfvars hcl nix',
    assembly: 'asm s', fortran: 'f f90 f95 f03 for', vhdl: 'vhd vhdl', verilog: 'v sv svh', dcf: 'dcf rproj'
  };
  const EXT = new Map();
  for (const id in EXTS) for (const e of EXTS[id].split(' ')) EXT.set(e, id);
  const NAMES = new Map(Object.entries({
    Makefile: 'make', makefile: 'make', GNUmakefile: 'make', 'CMakeLists.txt': 'cmake',
    Dockerfile: 'dockerfile', Containerfile: 'dockerfile', Jenkinsfile: 'groovy',
    Gemfile: 'ruby', Rakefile: 'ruby', Podfile: 'ruby', Brewfile: 'ruby', Vagrantfile: 'ruby', Fastfile: 'ruby',
    BUILD: 'python', WORKSPACE: 'python', DESCRIPTION: 'dcf', NAMESPACE: 'r', Procfile: 'config',
    LICENSE: 'text', LICENCE: 'text', COPYING: 'text', NOTICE: 'text', AUTHORS: 'text',
    CONTRIBUTORS: 'text', CODEOWNERS: 'text', README: 'text', CHANGELOG: 'text'
  }));

  // Vendored code, lock files and minified bundles, matched on the path inside the mapped folder.
  const SKIP_DIR = /(^|\/)(node_modules|bower_components|jspm_packages|vendor|vendors|third[-_]?party|dist|Pods|Carthage|\.yarn|\.venv|venv|site-packages|\.idea|__pycache__)\//;
  const SKIP_FILE = /(^|[.-])lock(file)?(\.json|\.ya?ml)?$|\.lockb$|^go\.(work\.)?sum$|^npm-shrinkwrap\.json$|^Package\.resolved$|[.-]min\.(js|mjs|css)$|\.(bundle|chunk)\.js$/i;
  const GENERATED = /do not edit|@generated|auto-?generated|automatically generated/i;
  const GENERATOR = /<meta\s+name=["']?generator\b/i; // rendered HTML (pandoc, knitr, Sphinx, Jekyll output)
  const OBJC = /^\s*(#import|#include|@interface|@implementation|@protocol)\b/m;

  function classify(rel, size) {
    const name = rel.slice(rel.lastIndexOf('/') + 1);
    if (SKIP_DIR.test(rel) || SKIP_FILE.test(name)) return { skip: 'vendored' };
    const dot = name.lastIndexOf('.');
    const lang = NAMES.get(name) || (/^(Docker|Container)file\./.test(name) ? 'dockerfile' : '') ||
      (dot >= 0 ? EXT.get(name.slice(dot + 1).toLowerCase()) : '');
    if (!lang) return { skip: 'other' };
    if (size > MAX_FILE) return { skip: 'large' };
    return { lang: lang };
  }

  // One line ending, tabs expanded to 4 column stops (the renderer counts one
  // cell per character), no BOM and no final newline.
  function normalize(text) {
    if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
    text = text.replace(/\r\n?/g, '\n');
    if (text.endsWith('\n')) text = text.slice(0, -1);
    return text.indexOf('\t') < 0 ? text : text.split('\n').map(expandTabs).join('\n');
  }
  function expandTabs(line) {
    if (line.indexOf('\t') < 0) return line;
    let out = '';
    for (let i = 0; i < line.length; i++) out += line[i] === '\t' ? ' '.repeat(4 - out.length % 4) : line[i];
    return out;
  }

  function dec(s) { try { return decodeURIComponent(s); } catch (e) { return s; } }

  // owner/name, a GitHub URL (.../tree/<ref>/<folder>, .../blob/..., .../commit/<sha>)
  // or an SSH remote, plus optional ref= and path= parameters that win over the URL.
  function parseRepo(params) {
    const raw = (params.get('repo') || '').trim();
    let ref = (params.get('ref') || '').trim(), path = params.get('path') || '';
    const parts = raw.replace(/^(?:https?:\/\/)?(?:www\.)?github\.com[/:]|^git@github\.com:/i, '')
      .replace(/[?#].*$/, '').split('/').filter(Boolean);
    const owner = parts[0] || '', repo = (parts[1] || '').replace(/\.git$/i, '');
    if (!/^[A-Za-z0-9][A-Za-z0-9-]{0,38}$/.test(owner) || !/^[\w.-]{1,100}$/.test(repo) || /^\.\.?$/.test(repo)) {
      throw new Error('"' + raw + '" is not a GitHub repository. Enter it as owner/name or paste its URL.');
    }
    if (/^(tree|blob|commit)$/.test(parts[2]) && parts[3]) {
      if (!ref) ref = dec(parts[3]);
      if (!path && parts[2] !== 'commit') path = parts.slice(4, parts[2] === 'blob' ? -1 : undefined).map(dec).join('/');
    }
    path = path.split('/').filter(Boolean).join('/');
    if (/(^|\/)\.\.?(\/|$)/.test(path) || /[\x00-\x1f]/.test(path) || /\.\.|[\x00-\x20~^:?*[\\]/.test(ref)) {
      throw new Error('That branch or folder name is not valid.');
    }
    return { owner: owner, repo: repo, ref: ref, path: path };
  }

  async function api(path, token, why) {
    let res;
    try {
      res = await fetch('https://api.github.com/repos/' + path, { headers: token ? { Authorization: 'Bearer ' + token } : {} });
    } catch (e) {
      throw new Error('Could not reach api.github.com. Check the connection and try again.');
    }
    if (res.ok) return res.json();
    let text = '';
    try { text = (await res.json()).message || ''; } catch (e) { /* not JSON */ }
    if (res.headers.get('x-ratelimit-remaining') === '0') {
      const at = new Date(1000 * Number(res.headers.get('x-ratelimit-reset')));
      throw Object.assign(new Error('The GitHub API rate limit is used up; it resets at ' +
        at.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) + '.' +
        (token ? '' : ' A token raises it from 60 to 5,000 requests an hour.')), { token: true });
    }
    if (res.status === 401) {
      throw Object.assign(new Error('GitHub rejected the saved token' + (text ? ' (' + text + ')' : '') +
        '. Replace it or save an empty one to clear it.'), { token: true });
    }
    if (why[res.status]) throw new Error(why[res.status]);
    throw new Error('GitHub answered ' + res.status + (text ? ': ' + text : '') + '.');
  }

  // Raw files are pinned to a commit, so any cached copy is still right;
  // a retry skips the cache in case it holds the failure.
  async function getRaw(url) {
    for (let i = 0; i < 3; i++) {
      if (i) await new Promise(function (r) { setTimeout(r, 500 * i); });
      try {
        const res = await fetch(url, { cache: i ? 'reload' : 'force-cache' });
        if (res.ok) return await res.arrayBuffer();
        if (res.status !== 429 && res.status < 500) return null;
      } catch (e) { /* network hiccup: try again */ }
    }
    return null;
  }

  async function pool(items, n, fn) {
    let next = 0;
    async function worker() { while (next < items.length) { const i = next++; await fn(items[i], i); } }
    await Promise.all(Array.from({ length: Math.min(n, items.length) }, worker));
  }

  function mb(b) { return b < 1e5 ? Math.max(1, Math.round(b / 1e3)) + ' KB' : (b / 1e6).toFixed(1) + ' MB'; }

  function tooBig(where, t, want, total, truncated) {
    const by = new Map();
    for (const f of want) {
      const i = f.rel.indexOf('/');
      if (i < 0) continue;
      const d = f.rel.slice(0, i), s = by.get(d) || { files: 0, bytes: 0 };
      s.files++; s.bytes += f.size; by.set(d, s);
    }
    const folders = Array.from(by).sort(function (a, b) { return b[1].bytes - a[1].bytes; }).slice(0, 12)
      .map(function (e) { return { path: (t.path ? t.path + '/' : '') + e[0], files: e[1].files, bytes: e[1].bytes }; });
    const err = new Error(where + ' is too big to map in one go (' +
      (truncated ? 'GitHub cut its file list short' : want.length.toLocaleString() + ' source files, ' + mb(total)) +
      '). The map holds up to ' + MAX_FILES.toLocaleString() + ' files and ' + mb(MAX_BYTES) + '.' +
      (folders.length ? ' Pick a folder:' : ''));
    err.folders = folders;
    return err;
  }

  // t: { owner, repo, ref, path } from parseRepo. opt: { token, onProgress(text, fraction) }.
  async function loadRepo(t, opt) {
    opt = opt || {};
    const say = opt.onProgress || function () {};
    const slug = t.owner + '/' + t.repo, where = slug + (t.path ? '/' + t.path : '');
    const at = t.ref ? ' at ' + t.ref : '', base = t.path ? t.path + '/' : '';

    say('Asking GitHub for ' + where + at + '…');
    const commit = await api(slug + '/commits/' + encodeURIComponent(t.ref || 'HEAD'), opt.token, {
      404: slug + ' was not found. Check the spelling; private repositories cannot be mapped.',
      409: slug + ' is empty.',
      422: slug + ' has no branch, tag or commit named ' + t.ref + '.'
    });
    const sha = commit.sha;
    if (!/^[0-9a-f]{40}$/.test(sha || '')) throw new Error('GitHub sent an unexpected answer for ' + slug + '.');

    say('Listing the files of ' + where + '…');
    const tree = await api(slug + '/git/trees/' +
      encodeURIComponent(t.path ? sha + ':' + t.path : commit.commit.tree.sha) + '?recursive=1', opt.token, {
      404: 'There is no folder ' + t.path + ' in ' + slug + at + '.',
      422: t.path + ' in ' + slug + ' is a file, not a folder.'
    });

    const skipped = { vendored: 0, other: 0, large: 0, generated: 0, binary: 0, failed: 0 };
    const want = [];
    let total = 0;
    for (const e of tree.tree) {
      if (e.type !== 'blob' || e.mode === '120000') continue; // skip submodules and symlinks
      const c = classify(e.path, e.size);
      if (c.skip) { skipped[c.skip]++; continue; }
      want.push({ rel: e.path, lang: c.lang, size: e.size });
      total += e.size;
    }
    if (tree.truncated || want.length > MAX_FILES || total > MAX_BYTES) throw tooBig(where, t, want, total, tree.truncated);

    const raw = 'https://raw.githubusercontent.com/' + slug + '/' + sha + '/';
    const out = new Array(want.length), utf8 = new TextDecoder();
    let done = 0, got = 0, shown = 0;
    await pool(want, POOL, async function (f, i) {
      const buf = await getRaw(raw + (base + f.rel).split('/').map(encodeURIComponent).join('/'));
      done++;
      if (buf) got += buf.byteLength;
      const now = Date.now();
      if (now - shown > 80 || done === want.length) {
        shown = now;
        say('Fetching ' + where + ': ' + done.toLocaleString() + ' of ' + want.length.toLocaleString() + ' files, ' + mb(got), done / want.length);
      }
      if (!buf) { skipped.failed++; return; }
      const bytes = new Uint8Array(buf);
      if (bytes.subarray(0, 8000).indexOf(0) >= 0) { skipped.binary++; return; }
      const s = normalize(utf8.decode(bytes));
      if (GENERATED.test(s.slice(0, 400)) || (f.lang === 'html' && GENERATOR.test(s.slice(0, 4000)))) { skipped.generated++; return; }
      out[i] = { rel: f.rel, l: f.lang === 'matlab' && OBJC.test(s) ? 'objective-c' : f.lang, s: s, b: bytes.length };
    });

    const root = { n: t.path ? t.path.slice(t.path.lastIndexOf('/') + 1) : t.repo, c: [] };
    const dirs = new Map([['', root]]);
    function dirOf(p) {
      let d = dirs.get(p);
      if (d) return d;
      const k = p.lastIndexOf('/');
      d = { n: p.slice(k + 1), c: [] };
      dirOf(k < 0 ? '' : p.slice(0, k)).c.push(d);
      dirs.set(p, d);
      return d;
    }
    let files = 0;
    for (const f of out) {
      if (!f) continue;
      const k = f.rel.lastIndexOf('/');
      dirOf(k < 0 ? '' : f.rel.slice(0, k)).c.push({ n: f.rel.slice(k + 1), p: base + f.rel, l: f.l, s: f.s, b: f.b });
      files++;
    }
    if (!files) {
      throw new Error(skipped.failed ? 'None of the files of ' + where + ' could be downloaded from raw.githubusercontent.com. Check the connection and try again.' :
        'There are no source files to map in ' + where + at + '.');
    }
    return {
      owner: t.owner, repo: t.repo, ref: t.ref, path: t.path, sha: sha,
      date: commit.commit.committer.date.slice(0, 10), tree: root, files: files, skipped: skipped
    };
  }

  globalThis.codemap = { parseRepo: parseRepo, loadRepo: loadRepo, classify: classify, normalize: normalize };
})();
