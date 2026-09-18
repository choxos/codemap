// codemap: a zoomable map of a GitHub repository. loader.js fetches the files;
// this draws them as a nested treemap where each file is its own code texture
// that resolves into syntax colored text as you zoom in.
(async function () {
  'use strict';
  const $ = function (id) { return document.getElementById(id); };
  const CM = window.codemap;
  const TOKEN_KEY = 'codemap.token';

  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return c === '&' ? '&amp;' : c === '<' ? '&lt;' : c === '>' ? '&gt;' : c === '"' ? '&quot;' : '&#39;';
    });
  }
  function enc(v) { return encodeURIComponent(v).replace(/%2F/g, '/'); }
  // this page mapping one folder of t (or all of it) at the same ref
  function mapLink(t, path) {
    return '?repo=' + t.owner + '/' + t.repo + (t.ref ? '&ref=' + enc(t.ref) : '') + (path ? '&path=' + enc(path) : '');
  }
  function mb(b) { return b < 1e5 ? Math.max(1, Math.round(b / 1e3)) + ' KB' : (b / 1e6).toFixed(1) + ' MB'; }
  function getToken() { try { return localStorage.getItem(TOKEN_KEY) || ''; } catch (e) { return ''; } }

  // ---------- start panel: landing, progress, errors ----------
  const msg = $('msg'), bar = $('bar');
  $('token').placeholder = getToken() ? 'a token is saved; paste a new one or save empty to clear' : 'github_pat_…';
  $('tokform').addEventListener('submit', function (e) {
    e.preventDefault();
    const v = $('token').value.trim();
    try { if (v) localStorage.setItem(TOKEN_KEY, v); else localStorage.removeItem(TOKEN_KEY); } catch (err) { /* storage blocked */ }
    location.reload();
  });
  function fail(e, t) {
    $('intro').hidden = true; bar.hidden = true;
    msg.textContent = e.message; msg.className = 'err'; msg.removeAttribute('aria-busy');
    if (e.folders && e.folders.length) {
      $('more').innerHTML = e.folders.map(function (f) {
        return '<div><a href="' + esc(mapLink(t, f.path)) + '">' + esc(f.path) + '/</a> <span>' +
          f.files.toLocaleString() + ' files · ' + mb(f.bytes) + '</span></div>';
      }).join('');
    }
    if (e.token) $('tok').open = true;
  }

  const params = new URLSearchParams(location.search);
  if (!params.get('repo')) {
    if (matchMedia('(pointer: fine)').matches) $('repo').focus();
    return;
  }
  let T;
  try { T = CM.parseRepo(params); } catch (e) { $('repo').value = params.get('repo'); fail(e); return; }
  const NAME = T.owner + '/' + T.repo + (T.path ? '/' + T.path : '');
  $('repo').value = T.owner + '/' + T.repo;
  document.title = NAME + ' · codemap';
  history.replaceState(null, '', mapLink(T, T.path));
  $('intro').hidden = true; bar.hidden = false;
  msg.setAttribute('aria-busy', 'true'); // progress changes too fast to announce; errors are announced
  let DATA;
  try {
    DATA = await CM.loadRepo(T, {
      token: getToken(),
      onProgress: function (text, frac) {
        msg.textContent = text;
        if (frac === undefined) bar.removeAttribute('value'); else bar.value = frac;
      }
    });
  } catch (e) { fail(e, T); return; }
  $('panel').hidden = true;
  $('side').hidden = false; $('tools').hidden = false; $('hint').hidden = false;

  // ---------- palette ----------
  const TOKEN_COLOR = { d: '#c9d1d9', k: '#c792ea', s: '#ecc48d', c: '#7a9a6a', n: '#f78c6c', f: '#82aaff', p: '#89ddff', o: '#8fb3d9' };
  const CHIP_FONT = '11px ' + getComputedStyle(document.documentElement).getPropertyValue('--font');
  const MONO = getComputedStyle(document.documentElement).getPropertyValue('--mono');
  const LH = 1.3;

  // top level folders get hues a golden angle apart; deeper folders drift a little so siblings read apart
  function hueOf(node) {
    let n = node;
    while (n.parent && n.parent.parent) n = n.parent;
    return ((n.top || 0) + (node.depth - 1) * 9) % 360;
  }
  function hsl(h, s, l, a) { return 'hsla(' + h + ',' + s + '%,' + l + '%,' + (a === undefined ? 1 : a) + ')'; }

  // ---------- data preparation ----------
  const FILES = [], DIRS = [];
  function prep(node, parent, depth) {
    node.parent = parent; node.depth = depth;
    if (node.c) {
      node.kind = 'dir';
      node.path = parent ? (parent.path ? parent.path + '/' + node.n : node.n) : DATA.path;
      node.size = 0; node.desc = 0; node.nfiles = 0; node.nlines = 0;
      for (const ch of node.c) {
        prep(ch, node, depth + 1);
        node.size += ch.size; node.desc += 1 + (ch.desc || 0);
        node.nfiles += ch.kind === 'dir' ? ch.nfiles : 1;
        node.nlines += ch.kind === 'dir' ? ch.nlines : ch.lines.length;
      }
      node.c.sort((a, b) => b.size - a.size);
      DIRS.push(node);
    } else {
      node.kind = 'file'; node.path = node.p;
      node.lines = node.s.split('\n');
      node.bytes = node.b;
      let m = 0; for (const ln of node.lines) if (ln.length > m) m = ln.length;
      node.maxLen = m;
      node.size = node.lines.length + 6;
      FILES.push(node);
    }
  }
  const ROOT = DATA.tree;
  prep(ROOT, null, 0);
  let rank = 0;
  for (const ch of ROOT.c) if (ch.kind === 'dir') ch.top = (172 + 137.508 * rank++) % 360;
  ROOT.hue = 0;
  for (const d of DIRS) d.hue = d === ROOT ? 0 : hueOf(d);
  for (const f of FILES) f.hue = f.parent === ROOT ? 210 : f.parent.hue;
  let TOTAL_BYTES = 0;
  const BY_LANG = Object.create(null);
  for (const f of FILES) { TOTAL_BYTES += f.bytes; BY_LANG[f.l] = (BY_LANG[f.l] || 0) + f.lines.length; }
  $('meta').textContent = FILES.length.toLocaleString() + ' files · ' + ROOT.nlines.toLocaleString() + ' lines · ' +
    DATA.sha.slice(0, 7) + ' (' + DATA.date + ')';

  // ---------- languages ----------
  // cm: line comment starts, bk: block comment pair, q: string quotes (default " ' `),
  // ml: multi-line string delimiters,
  // br: bracket pair outlined as scopes, ind: outline indented blocks instead,
  // pre: extra pattern drawn in the preprocessor color, kw: keywords, ci: keywords ignore case,
  // id: identifier pattern (R allows dots)
  const C = { cm: ['//'], bk: ['/*', '*/'], br: '{}' };
  const CPRE = '^\\s*#\\s*\\w+';
  const MARKUP = { bk: ['<!--', '-->'], q: '"', pre: '<\\/?[\\w:.-]+|\\/?>', ind: 1 };
  const KW_C = 'auto break case char const continue default do double else enum extern float for goto if inline int long register restrict return short signed sizeof static struct switch typedef union unsigned void volatile while bool true false NULL';
  const KW_CPP = KW_C + ' alignas alignof catch class constexpr consteval constinit const_cast decltype delete dynamic_cast explicit export final friend mutable namespace new noexcept nullptr operator override private protected public reinterpret_cast static_assert static_cast template this thread_local throw try typeid typename using virtual co_await co_return co_yield concept requires';
  const KW_JS = 'async await break case catch class const continue debugger default delete do else export extends false finally for from function get if import in instanceof let new null of return set static super switch this throw true try typeof undefined var void while with yield';
  const KW_JAVA = 'abstract assert boolean break byte case catch char class const continue default do double else enum extends false final finally float for if implements import instanceof int interface long native new null package private protected public record return sealed short static super switch synchronized this throw throws transient true try var void volatile while yield';
  const KW_R = 'function if else for while repeat return TRUE FALSE NULL NA NA_integer_ NA_real_ NA_character_ Inf NaN in next break library require stop warning invisible';
  const KW_ML = 'and as assert begin class constraint do done downto else end exception external false for fun function functor if in include inherit initializer lazy let match method module mutable new nonrec object of open or private rec sig struct then to true try type val virtual when while with';
  const LANG = {
    javascript: { ...C, ml: ['`'], kw: KW_JS, pre: '@[\\w.]+' },
    typescript: { ...C, ml: ['`'], kw: KW_JS + ' abstract any as asserts bigint boolean declare enum implements infer interface is keyof namespace never number object private protected public readonly satisfies string symbol type unique unknown', pre: '@[\\w.]+' },
    python: { cm: ['#'], ml: ['"""', "'''"], ind: 1, pre: '@[\\w.]+', kw: 'False None True and as assert async await break case class continue def del elif else except finally for from global if import in is lambda match nonlocal not or pass raise return self try while with yield' },
    go: { ...C, ml: ['`'], kw: 'break case chan const continue default defer else fallthrough for func go goto if import interface map package range return select struct switch type var nil true false iota' },
    rust: { ...C, q: '"', pre: '#!?\\[[^\\]]*\\]?|\\b\\w+!', kw: 'as async await break const continue crate dyn else enum extern false fn for if impl in let loop match mod move mut pub ref return self Self static struct super trait true type unsafe use where while' },
    java: { ...C, kw: KW_JAVA, pre: '@\\w+' },
    kotlin: { ...C, ml: ['"""'], pre: '@\\w+', kw: 'abstract as break by catch class companion const constructor continue data do else enum false final finally for fun if import in init inner interface internal is lateinit null object open out override package private protected public return sealed super suspend this throw true try typealias val var vararg when where while' },
    scala: { ...C, ml: ['"""'], pre: '@\\w+', kw: 'abstract case catch class def do else enum extends false final finally for given if implicit import lazy match new null object override package private protected return sealed super then this throw trait true try type using val var while with yield' },
    groovy: { ...C, ml: ['"""', "'''"], kw: KW_JAVA + ' def as in trait', pre: '@\\w+' },
    c: { ...C, kw: KW_C, pre: CPRE },
    'c++': { ...C, kw: KW_CPP, pre: CPRE },
    'objective-c': { ...C, kw: KW_CPP + ' self super nil Nil YES NO id instancetype', pre: CPRE + '|@\\w+' },
    matlab: { cm: ['%'], q: '"', ind: 1, kw: 'break case catch classdef continue else elseif end for function global if methods otherwise parfor persistent properties return spmd switch try while' },
    'c#': { ...C, pre: CPRE, kw: 'abstract as async await base bool break byte case catch char checked class const continue decimal default delegate do double else enum event explicit extern false finally fixed float for foreach get goto if implicit in init int interface internal is lock long namespace new null object operator out override params private protected public readonly record ref return sbyte sealed set short sizeof stackalloc static string struct switch this throw true try typeof uint ulong unchecked unsafe ushort using var virtual void volatile while yield' },
    'f#': { cm: ['//'], bk: ['(*', '*)'], q: '"', ind: 1, kw: KW_ML + ' abstract default elif interface member namespace override use yield async' },
    swift: { ...C, ml: ['"""'], pre: '@\\w+|#\\w+', kw: 'actor any as associatedtype async await break case catch class continue default defer deinit do else enum extension fallthrough false fileprivate for func guard if import in init inout internal is let nil open operator private protocol public repeat rethrows return self Self some static struct subscript super switch throw throws true try typealias var where while' },
    dart: { ...C, ml: ['"""', "'''"], pre: '@\\w+', kw: 'abstract as assert async await break case catch class const continue covariant default deferred do dynamic else enum export extends extension external factory false final finally for get if implements import in interface is late library mixin new null on operator part required rethrow return sealed set static super switch this throw true try typedef var void while with yield' },
    php: { ...C, cm: ['//', '#'], pre: '\\$\\w+|<\\?php|\\?>', kw: 'abstract and array as break callable case catch class clone const continue declare default do echo else elseif empty enum extends false final finally fn for foreach function global if implements include include_once instanceof interface isset list match namespace new null or print private protected public readonly require require_once return static switch throw trait true try unset use var while xor yield' },
    ruby: { cm: ['#'], ind: 1, pre: ':\\w+|@{1,2}\\w+', kw: 'alias and begin break case class def do else elsif end ensure false for if in module next nil not or redo rescue retry return self super then true undef unless until when while yield require require_relative include extend attr_reader attr_writer attr_accessor private protected public raise lambda proc' },
    perl: { cm: ['#'], br: '{}', pre: '[$@%]\\w+', kw: 'my our local sub if elsif else unless while until for foreach do last next redo return use require package no and or not eq ne lt gt le ge cmp undef' },
    lua: { cm: ['--'], bk: ['--[[', ']]'], q: '"\'', ind: 1, kw: 'and break do else elseif end false for function goto if in local nil not or repeat return then true until while' },
    r: { cm: ['#'], br: '{}', id: '[A-Za-z_.][\\w.]*', kw: KW_R },
    'r markdown': { cm: ['#'], q: '"\'', id: '[A-Za-z_.][\\w.]*', kw: KW_R, pre: '^```.*$' },
    rd: { cm: ['%'], q: '"', pre: '\\\\[A-Za-z]+' },
    stan: { ...C, kw: 'data parameters model transformed generated quantities functions int real vector matrix array row_vector simplex ordered positive_ordered cov_matrix corr_matrix cholesky_factor_corr cholesky_factor_cov for if else while return target lower upper offset multiplier in print reject void tuple complex' },
    julia: { cm: ['#'], ml: ['"""'], ind: 1, pre: '@\\w+', kw: 'abstract baremodule begin break catch const continue do else elseif end export false finally for function global if import in let local macro module mutable nothing quote return struct true try using where while' },
    elixir: { cm: ['#'], ind: 1, pre: ':\\w+|@\\w+', kw: 'after alias and case catch cond def defdelegate defexception defguard defimpl defmacro defmodule defp defprotocol defstruct do else end false fn for if import in nil not or quote raise receive require rescue true try unless unquote use when with' },
    erlang: { cm: ['%'], q: '"', ind: 1, kw: 'after and andalso band begin bnot bor bsl bsr bxor case catch cond div end fun if let not of or orelse receive rem try when xor' },
    haskell: { cm: ['--'], bk: ['{-', '-}'], q: '"', ind: 1, kw: 'case class data default deriving do else forall foreign hiding if import in infix infixl infixr instance let module newtype of qualified then type where' },
    elm: { cm: ['--'], bk: ['{-', '-}'], q: '"', ind: 1, kw: 'alias as case else exposing if import in let module of port then type' },
    ocaml: { bk: ['(*', '*)'], q: '"', ind: 1, kw: KW_ML },
    lisp: { cm: [';'], q: '"', br: '()', kw: 'def defn defmacro defun defvar defparameter defonce defrecord defprotocol let lambda fn if cond when unless do loop recur ns require import setq setf progn quote nil true false and or not' },
    zig: { cm: ['//'], br: '{}', pre: '@\\w+', kw: 'align allowzero and anyframe anytype asm async await break callconv catch comptime const continue defer else enum errdefer error export extern false fn for if inline noalias noinline nosuspend null opaque or orelse packed pub resume return struct suspend switch test threadlocal true try undefined union unreachable usingnamespace var volatile while' },
    nim: { cm: ['#'], ind: 1, kw: 'addr and as asm bind block break case cast concept const continue converter defer discard distinct div do elif else end enum except export finally for from func if import in include interface is isnot iterator let macro method mixin mod nil not notin object of or out proc ptr raise ref return shl shr static template try tuple type using var when while xor yield true false' },
    shell: { cm: ['#'], br: '{}', pre: '\\$\\{?\\w+\\}?', kw: 'if then else elif fi for do done while until case esac in function return exit export local readonly declare select break continue echo source' },
    powershell: { cm: ['#'], bk: ['<#', '#>'], br: '{}', ci: 1, pre: '\\$\\w+', kw: 'begin break catch class continue data do dynamicparam else elseif end enum exit filter finally for foreach function if in param process return switch throw trap try until using while' },
    sql: { cm: ['--'], bk: ['/*', '*/'], ci: 1, ind: 1, kw: 'add all alter and any as asc begin between by case cast check column commit constraint create cross database default delete desc distinct drop else end exists false foreign from full function group having if in index inner insert into is join key left like limit not null offset on or order outer primary procedure references replace returning right rollback select set table then transaction trigger true union unique update using values view when where with' },
    graphql: { cm: ['#'], q: '"', br: '{}', kw: 'directive enum extend false fragment implements input interface mutation null on query scalar schema subscription true type union' },
    protobuf: { ...C, kw: 'enum extend extensions false import map message oneof option optional package public repeated required reserved returns rpc service stream syntax to true weak' },
    solidity: { ...C, kw: 'abstract address anonymous as assembly bool break bytes calldata catch constant constructor continue contract delete do else emit enum error event external fallback false for function if immutable import indexed interface internal is library mapping memory modifier new override payable pragma private public pure receive return returns revert storage string struct this true try type uint int unchecked using view virtual while' },
    glsl: { ...C, pre: CPRE, kw: KW_C + ' attribute uniform varying buffer shared layout in out inout centroid flat smooth precision highp mediump lowp discard vec2 vec3 vec4 ivec2 ivec3 ivec4 mat2 mat3 mat4 sampler2D samplerCube fn let var' },
    html: MARKUP,
    xml: MARKUP,
    css: { bk: ['/*', '*/'], q: '"\'', br: '{}', pre: '^[^{]*\\{|[\\w-]+\\s*:' },
    scss: { cm: ['//'], bk: ['/*', '*/'], q: '"\'', br: '{}', pre: '^[^{]*\\{|[\\w-]+\\s*:|\\$[\\w-]+|@\\w+' },
    sass: { cm: ['//'], bk: ['/*', '*/'], q: '"\'', ind: 1, pre: '[\\w-]+\\s*:|\\$[\\w-]+|@\\w+' },
    markdown: { q: '`', pre: '^#{1,6}\\s.*$|^\\s*(?:[-*+]|\\d+\\.)\\s|^\\s*```.*$|^\\s*>' },
    text: { q: '' },
    json: { cm: ['//'], bk: ['/*', '*/'], q: '"', br: '{}', kw: 'true false null', pre: '"(?:[^"\\\\]|\\\\.)*"\\s*:' },
    yaml: { cm: ['#'], q: '"\'', ind: 1, kw: 'true false null yes no on off', pre: '^\\s*-?\\s*[\\w.\\-]+\\s*:' },
    toml: { cm: ['#'], q: '"\'', kw: 'true false', pre: '^\\s*\\[.*\\]|^\\s*[\\w.\\-"]+\\s*=' },
    config: { cm: ['#', ';'], q: '"', pre: '^\\s*\\[.*\\]|^\\s*[\\w.\\-]+\\s*[=:]' },
    tex: { cm: ['%'], q: '', pre: '\\\\[A-Za-z@]+' },
    make: { cm: ['#'], q: '"\'', pre: '^[^\\s#:=]+\\s*:(?!=)|\\$[({][\\w.-]+[)}]', kw: 'define endef else endif export ifdef ifeq ifndef ifneq include override private undefine unexport vpath' },
    cmake: { cm: ['#'], q: '"', ci: 1, kw: 'add_custom_command add_custom_target add_executable add_library add_subdirectory else elseif endforeach endfunction endif endmacro endwhile find_package foreach function if include install macro message option project set target_compile_options target_include_directories target_link_libraries while' },
    dockerfile: { cm: ['#'], q: '"\'', pre: '^\\s*[A-Z]+\\b' },
    hcl: { cm: ['#', '//'], bk: ['/*', '*/'], q: '"', br: '{}', kw: 'data false for if in let locals module null output provider resource terraform then true variable with rec inherit import else' },
    assembly: { cm: [';', '#', '//'], q: '"\'', pre: '^\\s*[\\w.]+:|^\\s*\\.\\w+' },
    fortran: { cm: ['!'], q: '"\'', ci: 1, ind: 1, kw: 'allocatable allocate call case character complex contains cycle deallocate dimension do double else elseif end exit function if implicit in inout integer intent interface logical module none out parameter precision print program real recursive return save select stop subroutine then type use while' },
    vhdl: { cm: ['--'], q: '"', ci: 1, ind: 1, kw: 'all architecture array begin body case component constant downto else elsif end entity for function generate generic if in inout is library loop map not null of others out package port process record return select signal then to type use variable wait when while' },
    verilog: { cm: ['//'], bk: ['/*', '*/'], q: '"', ind: 1, pre: '`\\w+|\\$\\w+', kw: 'always always_comb always_ff always_latch assign automatic begin case casex casez default else end endcase endfunction endgenerate endmodule endtask for function generate if initial inout input integer localparam logic module negedge output parameter posedge reg task wire' },
    dcf: { cm: ['#'], pre: '^[A-Za-z][\\w/.\\-]*:' }
  };
  function spec(lang) { return Object.hasOwn(LANG, lang) ? LANG[lang] : LANG.text; }
  function reEsc(s) { return s.replace(/[.*+?^${}()|[\]\\\/]/g, '\\$&'); }

  // ---------- tokenizer ----------
  const RX = Object.create(null), KWSET = Object.create(null), CMX = Object.create(null);
  function rxFor(lang) {
    if (RX[lang]) return RX[lang];
    const L = spec(lang), com = [], str = [];
    for (const c of L.cm || []) com.push(reEsc(c) + '.*$');
    if (L.bk) { const a = reEsc(L.bk[0]); com.push(a + '.*?' + reEsc(L.bk[1]), a + '.*$'); }
    for (const ch of L.q === undefined ? '"\'`' : L.q) str.push(ch + '(?:[^' + ch + '\\\\]|\\\\.)*' + ch + '?');
    const parts = [];
    parts.push('(' + (com.join('|') || '(?!x)x') + ')');
    parts.push('(' + (L.pre || '(?!x)x') + ')');
    parts.push('(' + (str.join('|') || '(?!x)x') + ')');
    parts.push('(\\b0x[0-9a-fA-F]+\\b|\\b\\d+(?:\\.\\d+)?(?:[eE][+-]?\\d+)?[A-Za-z]*\\b)');
    parts.push('(' + (L.id || '[A-Za-z_$][\\w$]*') + ')(\\s*\\()?');
    parts.push('(<-|->|=>|::|[-+*/%=<>!&|^~$@:?.]+)');
    parts.push('(\\s+)');
    parts.push('(.)');
    RX[lang] = new RegExp(parts.join('|'), 'gm');
    KWSET[lang] = new Set((L.kw || '').split(' ').filter(Boolean).map(function (k) { return L.ci ? k.toLowerCase() : k; }));
    return RX[lang];
  }
  function tokenize(line, lang) {
    const rx = rxFor(lang); rx.lastIndex = 0;
    const out = []; let m;
    const kws = KWSET[lang], ci = spec(lang).ci;
    while ((m = rx.exec(line))) {
      if (m[0].length === 0) { rx.lastIndex++; continue; }
      const st = m.index;
      if (m[1]) out.push(st, m[1].length, 'c');
      else if (m[2]) out.push(st, m[2].length, 'p');
      else if (m[3]) out.push(st, m[3].length, 's');
      else if (m[4]) out.push(st, m[4].length, 'n');
      else if (m[5]) {
        const id = m[5];
        const t = kws.has(ci ? id.toLowerCase() : id) ? 'k' : (m[6] ? 'f' : 'd');
        out.push(st, id.length, t);
        if (m[6]) { const tr = m[6].trimStart(); out.push(st + m[0].length - tr.length, tr.length, 'o'); }
      }
      else if (m[7]) out.push(st, m[7].length, 'o');
      else if (m[8]) { /* whitespace */ }
      else out.push(st, 1, 'd');
    }
    return out;
  }
  function tokLine(f, i) {
    if (!f.tok) { f.tok = new Array(f.lines.length); scan(f); }
    let t = f.tok[i];
    if (t) return t;
    // only the part of a line that fits its column is ever drawn
    const ln = f.lines[i].length > f.maxCh ? f.lines[i].slice(0, f.maxCh) : f.lines[i];
    const state = f.st[i];
    if (!state) return (f.tok[i] = tokenize(ln, f.l));
    // the line opens inside a block comment or a multi-line string: color that part, then the rest
    const L = spec(f.l), close = state === 1 ? L.bk[1] : L.ml[state - 2], k = ln.indexOf(close);
    const kind = state === 1 ? 'c' : 's';
    if (k < 0) return (f.tok[i] = [0, ln.length, kind]);
    const end = k + close.length, rest = tokenize(ln.slice(end), f.l);
    for (let r = 0; r < rest.length; r += 3) rest[r] += end;
    return (f.tok[i] = [0, end, kind].concat(rest));
  }
  function commentStart(lang) {
    if (lang in CMX) return CMX[lang];
    const L = spec(lang), s = (L.cm || []).slice();
    if (L.bk) s.push(L.bk[0]);
    return (CMX[lang] = s.length ? new RegExp('^\\s*(?:' + s.map(reEsc).join('|') + ')') : null);
  }
  // 0 blank, 1 code, 2 comment, 3 inside a multi-line string
  function lineClass(f, i) {
    if (!f.cls) {
      scan(f);
      const c = new Uint8Array(f.lines.length), cm = commentStart(f.l);
      for (let j = 0; j < f.lines.length; j++) {
        const ln = f.lines[j];
        if (!ln.trim()) c[j] = 0;
        else if (f.st[j] > 1) c[j] = 3;
        else if (f.st[j] === 1 || (cm && cm.test(ln))) c[j] = 2;
        else c[j] = 1;
      }
      f.cls = c;
    }
    return f.cls[i];
  }
  function indentOf(s) { let i = 0; while (i < s.length && s.charCodeAt(i) === 32) i++; return i; }

  // One pass over a file: the state each line opens in (0 code, 1 block comment,
  // 2 + k inside the multi-line string closed by ml[k]) and, for bracket
  // languages, the bracket blocks outside strings and comments.
  function scan(f) {
    if (f.st) return;
    const L = spec(f.l), N = f.lines.length, st = new Uint8Array(N), blocks = [], stack = [];
    const cms = L.cm || [], bk = L.bk, ml = L.ml || [], qs = L.q === undefined ? '"\'`' : L.q;
    const open = L.br ? L.br[0] : '', close = L.br ? L.br[1] : '';
    // characters that can start something; everything else is skipped at once
    const hot = qs + open + close + (bk ? bk[0][0] : '') + cms.map(function (c) { return c[0]; }).join('') + ml.map(function (d) { return d[0]; }).join('');
    let state = 0;
    for (let i = 0; i < N; i++) {
      st[i] = state;
      const ln = f.lines[i];
      let q = null;
      for (let j = 0; j < ln.length; j++) {
        if (state) {
          // jump to where the block comment or multi-line string ends
          const d = state === 1 ? bk[1] : ml[state - 2], k = ln.indexOf(d, j);
          if (k < 0) break;
          state = 0; j = k + d.length - 1; continue;
        }
        const ch = ln[j];
        if (q) { if (ch === '\\') j++; else if (ch === q) q = null; continue; }
        if (hot.indexOf(ch) < 0) continue;
        const k = ml.findIndex(function (d) { return ln.startsWith(d, j); });
        if (k >= 0) { state = 2 + k; j += ml[k].length - 1; continue; }
        if (qs.indexOf(ch) >= 0) { q = ch; continue; }
        if (bk && ln.startsWith(bk[0], j)) { state = 1; j += bk[0].length - 1; continue; }
        if (cms.some(function (c) { return ln.startsWith(c, j); })) break;
        if (ch === open) stack.push(i);
        else if (ch === close && stack.length) { const s = stack.pop(); if (i > s) blocks.push({ s: s, e: i, d: stack.length }); }
      }
    }
    f.st = st;
    f.blocks = blocks;
  }

  // ---------- scopes (bracket or indented blocks) ----------
  function scopesOf(f) {
    if (f.scopes) return f.scopes;
    const L = spec(f.l);
    scan(f);
    const out = L.br ? f.blocks : (L.ind ? indentScopes(f) : []);
    out.sort((a, b) => a.s - b.s || b.e - a.e);
    let md = 0; for (const s of out) if (s.d + 1 > md) md = s.d + 1;
    f.maxDepth = md;
    f.scopes = out;
    return out;
  }
  // a line followed by deeper lines opens a block; a closing line (end, a bracket, a
  // closing tag) at the opener's indent belongs to it. Only code lines count.
  const CLOSER = /^\s*(end\b|[}\])]|<\/)/;
  function indentScopes(f) {
    const out = [], stack = [], N = f.lines.length;
    let prev = -1, prevInd = 0;
    for (let i = 0; i <= N; i++) {
      if (i < N && lineClass(f, i) !== 1) continue;
      const ln = i < N ? f.lines[i] : '', ind = i < N ? indentOf(ln) : -1;
      while (stack.length && ind <= stack[stack.length - 1].ind) {
        const b = stack.pop();
        const e = i < N && ind === b.ind && CLOSER.test(ln) ? i : prev;
        if (e > b.s) out.push({ s: b.s, e: e, d: stack.length });
      }
      if (i < N && prev >= 0 && ind > prevInd) stack.push({ s: prev, ind: prevInd });
      prev = i; prevInd = ind;
    }
    return out;
  }

  // ---------- canvas and metrics ----------
  const stage = $('stage');
  const canvas = $('c');
  const ctx = canvas.getContext('2d');
  let dpr = 1, VW = 0, VH = 0;
  ctx.font = '100px ' + MONO;
  const CW = ctx.measureText('MMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMM').width / 50 / 100;

  function resize() {
    dpr = window.devicePixelRatio || 1;
    VW = stage.clientWidth; VH = stage.clientHeight;
    canvas.width = Math.round(VW * dpr); canvas.height = Math.round(VH * dpr);
    canvas.style.width = VW + 'px'; canvas.style.height = VH + 'px';
    dirty();
  }

  // ---------- layout ----------
  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
  function squarify(items, x, y, w, h) {
    let total = 0; for (const it of items) total += it.size;
    if (total <= 0 || w <= 0 || h <= 0) { for (const it of items) { it.x = x; it.y = y; it.w = 0; it.h = 0; } return; }
    const k = w * h / total;
    let i = 0, cx = x, cy = y, cw = w, ch = h;
    while (i < items.length) {
      const vert = cw >= ch;           // row runs along the shorter side
      const side = vert ? ch : cw;
      let rowSum = 0, mn = Infinity, mx = 0, best = Infinity, j = i;
      while (j < items.length) {
        const a = Math.max(items[j].size * k, 1e-9);
        const s2 = rowSum + a, nmn = Math.min(mn, a), nmx = Math.max(mx, a);
        const worst = Math.max(side * side * nmx / (s2 * s2), s2 * s2 / (side * side * nmn));
        if (j > i && worst > best) break;
        rowSum = s2; mn = nmn; mx = nmx; best = worst; j++;
      }
      const thick = side > 0 ? rowSum / side : 0;
      let off = 0;
      for (let q = i; q < j; q++) {
        const it = items[q];
        const len = thick > 0 ? Math.max(it.size * k, 1e-9) / thick : 0;
        if (vert) { it.x = cx; it.y = cy + off; it.w = thick; it.h = len; }
        else { it.x = cx + off; it.y = cy; it.w = len; it.h = thick; }
        off += len;
      }
      if (vert) { cx += thick; cw -= thick; } else { cy += thick; ch -= thick; }
      i = j;
    }
  }
  function layoutFile(f) {
    const pad = clamp(Math.min(f.w, f.h) * 0.05, 0.05, 3);
    const W = Math.max(f.w - 2 * pad, 0.01), H = Math.max(f.h - 2 * pad, 0.01);
    const N = f.lines.length, L = clamp(f.maxLen, 24, 100);
    let bs = 0, bc = 1;
    const maxC = Math.min(N, 48);
    for (let c = 1; c <= maxC; c++) {
      const rows = Math.ceil(N / c);
      const s = Math.min(W / c / (L * CW), H / (rows * LH));
      if (s > bs) { bs = s; bc = c; }
    }
    f.fs = bs; f.cols = bc; f.rows = Math.ceil(N / bc); f.colW = W / bc;
    f.ix = f.x + pad; f.iy = f.y + pad; f.iw = W; f.ih = H; f.lh = bs * LH;
    // characters that fit a column; longer lines are cut there instead of running into the next column
    f.maxCh = Math.max(1, Math.floor(f.colW / (CW * bs)));
  }
  function layout(node, x, y, w, h) {
    node.x = x; node.y = y; node.w = w; node.h = h;
    if (node.kind === 'file') { layoutFile(node); return; }
    const pad = node === ROOT ? 2 : clamp(Math.min(w, h) * 0.03, 0.1, 6);
    const iw = w - 2 * pad, ih = h - 2 * pad;
    squarify(node.c, x + pad, y + pad, Math.max(iw, 0), Math.max(ih, 0));
    for (const ch of node.c) layout(ch, ch.x, ch.y, ch.w, ch.h);
  }

  // ---------- camera ----------
  const cam = { s: 1, tx: 0, ty: 0 };
  let W0 = 0, H0 = 0, fitScale = 1, maxScale = 1e9;
  let needDraw = false;
  function dirty() { if (!needDraw) { needDraw = true; requestAnimationFrame(draw); } }
  function fitRect(x, y, w, h, margin) {
    margin = margin === undefined ? 0.94 : margin;
    const s = Math.min(VW / w, VH / h) * margin;
    return { s: s, tx: (VW - w * s) / 2 - x * s, ty: (VH - h * s) / 2 - y * s };
  }
  function setCam(c) { cam.s = c.s; cam.tx = c.tx; cam.ty = c.ty; dirty(); }
  function clampCam() {
    cam.s = clamp(cam.s, fitScale * 0.35, maxScale);
    const w = W0 * cam.s, h = H0 * cam.s;
    // keep at least a slice of the map on screen
    cam.tx = clamp(cam.tx, VW * 0.2 - w, VW * 0.8);
    cam.ty = clamp(cam.ty, VH * 0.2 - h, VH * 0.8);
  }
  function zoomAt(mx, my, k) {
    const ns = clamp(cam.s * k, fitScale * 0.35, maxScale), kk = ns / cam.s;
    cam.tx = mx - (mx - cam.tx) * kk; cam.ty = my - (my - cam.ty) * kk; cam.s = ns;
  }
  let anim = null;
  function flyTo(target, ms) {
    ms = ms || 450;
    const from = { s: cam.s, tx: cam.tx, ty: cam.ty };
    // interpolate the world point at the screen center and log scale
    const c0 = { x: (VW / 2 - from.tx) / from.s, y: (VH / 2 - from.ty) / from.s };
    const c1 = { x: (VW / 2 - target.tx) / target.s, y: (VH / 2 - target.ty) / target.s };
    const t0 = performance.now();
    anim = function (now) {
      let t = clamp((now - t0) / ms, 0, 1); t = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
      const s = Math.exp(Math.log(from.s) + (Math.log(target.s) - Math.log(from.s)) * t);
      const cx = c0.x + (c1.x - c0.x) * t, cy = c0.y + (c1.y - c0.y) * t;
      cam.s = s; cam.tx = VW / 2 - cx * s; cam.ty = VH / 2 - cy * s;
      if (t >= 1) anim = null;
      dirty();
    };
    dirty();
  }
  function fitAll() { setCam(fitRect(0, 0, W0, H0, 0.985)); }
  function fitNode(n) { flyTo(fitRect(n.x, n.y, n.w, n.h, 0.92)); }
  function lineRect(f, i) {
    const k = Math.floor(i / f.rows), r = i - k * f.rows;
    return { x: f.ix + k * f.colW, y: f.iy + r * f.lh, w: f.colW, h: f.lh };
  }
  function flyToLine(f, i, px) {
    const r = lineRect(f, i);
    const s = clamp((px || 13) / f.fs, fitScale * 0.35, maxScale);
    const cx = r.x + Math.min(r.w, 60 * CW * f.fs) / 2, cy = r.y + r.h / 2;
    flyTo({ s: s, tx: VW / 2 - cx * s, ty: VH / 2 - cy * s });
  }

  // ---------- state ----------
  let showLabels = true, showScopes = true, tilted = false;
  let hover = null, hoverLine = -1, selected = null, hit = null;
  const chips = [];

  // ---------- drawing ----------
  function draw() {
    needDraw = false;
    if (anim) anim(performance.now());
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, VW, VH);
    const view = { x0: -cam.tx / cam.s, y0: -cam.ty / cam.s, x1: (VW - cam.tx) / cam.s, y1: (VH - cam.ty) / cam.s };
    chips.length = 0;
    drawNode(ROOT, view);
    if (hover && hover !== ROOT) outline(hover, 'rgba(255,255,255,0.55)', 1.5);
    if (selected && selected !== ROOT) outline(selected, 'rgba(245,215,110,0.9)', 1.5);
    if (showLabels) drawChips();
  }
  function outline(n, color, lw) {
    ctx.strokeStyle = color; ctx.lineWidth = lw;
    ctx.strokeRect(n.x * cam.s + cam.tx + 0.5, n.y * cam.s + cam.ty + 0.5, n.w * cam.s - 1, n.h * cam.s - 1);
  }
  function drawNode(n, view) {
    if (n.x + n.w < view.x0 || n.x > view.x1 || n.y + n.h < view.y0 || n.y > view.y1) return;
    const sx = n.x * cam.s + cam.tx, sy = n.y * cam.s + cam.ty, sw = n.w * cam.s, sh = n.h * cam.s;
    if (n.kind === 'file') { drawFile(n, sx, sy, sw, sh, view); return; }
    if (sw < 1.5 || sh < 1.5) { ctx.fillStyle = hsl(n.hue, 55, 55, 0.35); ctx.fillRect(sx, sy, Math.max(sw, 0.6), Math.max(sh, 0.6)); return; }
    if (n !== ROOT) {
      ctx.fillStyle = hsl(n.hue, 40, 40, 0.10); ctx.fillRect(sx, sy, sw, sh);
      ctx.strokeStyle = hsl(n.hue, 70, 62, sw > 6 ? 0.9 : 0.5); ctx.lineWidth = 1;
      ctx.strokeRect(sx + 0.5, sy + 0.5, sw - 1, sh - 1);
    }
    // the folder chip goes first so it keeps the corner and file chips slide under it
    if (n !== ROOT && sw >= 28 && sh >= 14) chips.push({ t: n.n, x: sx, y: sy, w: sw, h: sh, dir: true, hue: n.hue });
    for (const ch of n.c) drawNode(ch, view);
  }
  function drawFile(f, sx, sy, sw, sh, view) {
    if (sw < 1.2 || sh < 1.2) { ctx.fillStyle = hsl(f.hue, 45, 45, 0.5); ctx.fillRect(sx, sy, Math.max(sw, 0.5), Math.max(sh, 0.5)); return; }
    ctx.fillStyle = '#0d1016'; ctx.fillRect(sx, sy, sw, sh);
    ctx.strokeStyle = hsl(f.hue, 60, 55, sw > 5 ? 0.6 : 0.35); ctx.lineWidth = 1;
    ctx.strokeRect(sx + 0.5, sy + 0.5, sw - 1, sh - 1);
    const sPx = f.fs * cam.s, lhPx = f.lh * cam.s;
    if (lhPx < 0.16) {
      // too small for lines: a density tint and a hint of column stripes
      ctx.fillStyle = hsl(f.hue, 35, 55, 0.22);
      const cwPx = f.colW * cam.s;
      for (let k = 0; k < f.cols; k++) {
        const w = Math.min(cwPx * 0.8, Math.max(sw - 2, 0));
        ctx.fillRect(f.ix * cam.s + cam.tx + k * cwPx, f.iy * cam.s + cam.ty, w, f.ih * cam.s);
      }
      if (sw >= 44 && sh >= 12) chips.push({ t: f.n, x: sx, y: sy, w: sw, h: sh, dir: false, hue: f.hue });
      return;
    }
    const lod = sPx < 1.25 ? 1 : (sPx < 3.4 ? 2 : 3);
    const cwPx = CW * sPx, maxCh = f.maxCh;
    ctx.save(); ctx.beginPath(); ctx.rect(sx, sy, sw, sh); ctx.clip();
    if (lod === 3) { ctx.font = sPx + 'px ' + MONO; ctx.textBaseline = 'top'; }
    const N = f.lines.length;
    const k0 = clamp(Math.floor((view.x0 - f.ix) / f.colW), 0, f.cols - 1);
    const k1 = clamp(Math.floor((view.x1 - f.ix) / f.colW), 0, f.cols - 1);
    const r0 = clamp(Math.floor((view.y0 - f.iy) / f.lh), 0, f.rows - 1);
    const r1 = clamp(Math.ceil((view.y1 - f.iy) / f.lh), 0, f.rows - 1);
    const barH = Math.max(lhPx * 0.62, 0.5);
    const textPad = (lhPx - sPx) / 2;
    // below half a pixel per line, draw every n-th line so the cost stays bounded
    const step = lhPx < 0.5 ? Math.ceil(0.5 / lhPx) : 1;
    for (let k = k0; k <= k1; k++) {
      const X = (f.ix + k * f.colW) * cam.s + cam.tx;
      for (let r = r0 - (r0 % step); r <= r1; r += step) {
        if (r < 0) continue;
        const i = k * f.rows + r; if (i >= N) break;
        const ln = f.lines[i]; if (!ln) continue;
        const Y = (f.iy + r * f.lh) * cam.s + cam.ty;
        if (lod === 1) {
          const cls = lineClass(f, i); if (!cls) continue;
          const ind = indentOf(ln), len = Math.min(ln.trimEnd().length, maxCh) - ind; if (len <= 0) continue;
          ctx.fillStyle = cls === 2 ? 'rgba(122,154,106,0.75)' : (cls === 3 ? 'rgba(236,196,141,0.6)' : 'rgba(201,209,217,0.72)');
          ctx.fillRect(X + ind * cwPx, Y + (lhPx - barH) / 2, len * cwPx, barH);
        } else {
          const tk = tokLine(f, i);
          for (let t = 0; t < tk.length; t += 3) {
            const st = tk[t], n = Math.min(tk[t + 1], maxCh - st);
            if (n <= 0) break;
            ctx.fillStyle = TOKEN_COLOR[tk[t + 2]];
            if (lod === 2) ctx.fillRect(X + st * cwPx, Y + (lhPx - barH) / 2, n * cwPx, barH);
            else ctx.fillText(ln.substr(st, n), X + st * cwPx, Y + textPad);
          }
        }
      }
    }
    if (showScopes && lhPx >= 0.9) drawScopes(f, view, cwPx, lhPx);
    if (hit && hit.f === f) {
      const r = lineRect(f, hit.i);
      ctx.fillStyle = 'rgba(245,215,110,0.22)'; ctx.fillRect(r.x * cam.s + cam.tx, r.y * cam.s + cam.ty, r.w * cam.s, Math.max(r.h * cam.s, 2));
      ctx.strokeStyle = 'rgba(245,215,110,0.95)'; ctx.lineWidth = 1;
      ctx.strokeRect(r.x * cam.s + cam.tx + 0.5, r.y * cam.s + cam.ty + 0.5, r.w * cam.s - 1, Math.max(r.h * cam.s - 1, 1));
    }
    if (hover === f && hoverLine >= 0 && lod === 3) {
      const r = lineRect(f, hoverLine);
      ctx.fillStyle = 'rgba(255,255,255,0.07)'; ctx.fillRect(r.x * cam.s + cam.tx, r.y * cam.s + cam.ty, r.w * cam.s, r.h * cam.s);
    }
    ctx.restore();
    if (sw >= 44 && sh >= 12) chips.push({ t: f.n, x: sx, y: sy, w: sw, h: sh, dir: false, hue: f.hue });
  }
  function drawScopes(f, view, cwPx, lhPx) {
    const sc = scopesOf(f); if (!sc.length) return;
    ctx.lineWidth = 1;
    const colWPx = f.colW * cam.s;
    for (const b of sc) {
      const ks = Math.floor(b.s / f.rows), ke = Math.floor(b.e / f.rows);
      for (let k = ks; k <= ke; k++) {
        const ra = k === ks ? b.s - k * f.rows : 0;
        const rb = k === ke ? b.e - k * f.rows : f.rows - 1;
        const wx = f.ix + k * f.colW, wy0 = f.iy + ra * f.lh, wy1 = f.iy + (rb + 1) * f.lh;
        if (wx > view.x1 || wx + f.colW < view.x0 || wy1 < view.y0 || wy0 > view.y1) continue;
        const hPx = (wy1 - wy0) * cam.s; if (hPx < 3) continue;
        // a block opened at the end of a long signature starts where its closing line does
        const ind = Math.min(indentOf(f.lines[b.s]), indentOf(f.lines[b.e]));
        const X = wx * cam.s + cam.tx + Math.max(ind * cwPx - 2, 0);
        const Wd = Math.max(colWPx - Math.max(ind * cwPx - 2, 0) - 2, 2);
        ctx.strokeStyle = hsl(f.hue, 70, 65, clamp(0.55 - b.d * 0.08, 0.18, 0.55));
        ctx.beginPath();
        roundRect(X + 0.5, wy0 * cam.s + cam.ty + 0.5, Wd, hPx - 1, Math.min(3, hPx / 3));
        ctx.stroke();
      }
    }
  }
  function roundRect(x, y, w, h, r) {
    ctx.moveTo(x + r, y); ctx.lineTo(x + w - r, y); ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r); ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h); ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r); ctx.quadraticCurveTo(x, y, x + r, y);
  }
  function drawChips() {
    ctx.font = CHIP_FONT; ctx.textBaseline = 'middle';
    const placed = [];
    for (const c of chips) {
      // keep a label of a box that overflows the viewport pinned in its visible corner
      const x = Math.max(c.x, 0) + 3;
      let y = Math.max(c.y, 0) + 3;
      const maxW = Math.min(c.x + c.w, VW) - x - 4;
      if (maxW < 18) continue;
      let t = c.t, tw = ctx.measureText(t).width;
      if (tw > maxW - 8) {
        while (t.length > 2 && ctx.measureText(t + '…').width > maxW - 8) t = t.slice(0, -1);
        t += '…'; tw = ctx.measureText(t).width;
      }
      const w = tw + 8, h = 15;
      // a chip that lands on an earlier chip (a file in its folder's corner) slides down
      for (let tries = 0; tries < 3; tries++) {
        let clash = false;
        for (const p of placed) if (x < p.x + p.w && x + w > p.x && y < p.y + p.h && y + h > p.y) { clash = true; break; }
        if (!clash) break;
        y += h + 1;
      }
      if (y + h > Math.min(c.y + c.h, VH)) continue;
      placed.push({ x: x, y: y, w: w, h: h });
      ctx.fillStyle = c.dir ? 'rgba(12,14,18,0.88)' : 'rgba(12,14,18,0.78)';
      ctx.fillRect(x, y, w, h);
      ctx.fillStyle = c.dir ? '#f2f4f7' : hsl(c.hue, 50, 82);
      ctx.fillText(t, x + 4, y + 8);
    }
  }

  // ---------- picking ----------
  function pick(wx, wy) {
    let n = ROOT;
    for (;;) {
      if (n.kind === 'file') return n;
      let next = null;
      for (const ch of n.c) if (wx >= ch.x && wx < ch.x + ch.w && wy >= ch.y && wy < ch.y + ch.h) { next = ch; break; }
      if (!next) return n;
      n = next;
    }
  }
  function lineAt(f, wx, wy) {
    const k = Math.floor((wx - f.ix) / f.colW), r = Math.floor((wy - f.iy) / f.lh);
    if (k < 0 || k >= f.cols || r < 0 || r >= f.rows) return -1;
    const i = k * f.rows + r;
    return i < f.lines.length ? i : -1;
  }

  // ---------- inspector ----------
  const insp = $('inspector');
  const statusEl = $('status');
  // permalinks into GitHub at the mapped commit
  function gh(kind, path, line) {
    return 'https://github.com/' + DATA.owner + '/' + DATA.repo + '/' + kind + '/' + DATA.sha +
      (path ? '/' + path.split('/').map(encodeURIComponent).join('/') : '') + (line ? '#L' + line : '');
  }
  function link(href, text, external) {
    return '<a href="' + esc(href) + '"' + (external ? ' target="_blank" rel="noopener"' : '') + '>' + esc(text) + '</a>';
  }
  const LANG_ROW = Object.keys(BY_LANG).sort(function (a, b) { return BY_LANG[b] - BY_LANG[a]; }).slice(0, 8).map(function (k) {
    const p = 100 * BY_LANG[k] / Math.max(ROOT.nlines, 1);
    return esc(k) + ' ' + (p < 0.1 ? '<0.1' : p < 10 ? p.toFixed(1) : Math.round(p)) + '%';
  }).join(' · ');
  const SKIP_ROW = (function (s) {
    const out = [];
    if (s.vendored) out.push(s.vendored + ' vendored, lock or minified');
    if (s.other) out.push(s.other + ' images, data and other non source');
    if (s.large) out.push(s.large + ' over 512 KB');
    if (s.generated) out.push(s.generated + ' generated');
    if (s.binary) out.push(s.binary + ' binary');
    if (s.failed) out.push(s.failed + ' that failed to download');
    return out.join(' · ');
  })(DATA.skipped);
  function renderInspector() {
    const n = hover || selected || ROOT;
    let h = '';
    if (n === ROOT) {
      const up = DATA.path.indexOf('/') > 0 ? DATA.path.slice(0, DATA.path.lastIndexOf('/')) : '';
      h += '<div class="name">' + esc(NAME) + ' <span>· ' + (DATA.path ? 'folder' : 'repository') + '</span></div>';
      h += '<div class="path">' + (DATA.ref ? esc(DATA.ref) + ' · ' : '') + 'commit ' + DATA.sha.slice(0, 7) + ' · ' + esc(DATA.date) + '</div>';
      h += '<div class="row">' + FILES.length.toLocaleString() + ' files · ' + ROOT.nlines.toLocaleString() + ' source lines · ' + TOTAL_BYTES.toLocaleString() + ' bytes</div>';
      h += '<div class="row">' + LANG_ROW + '</div>';
      if (SKIP_ROW) h += '<div class="row muted">Left out: ' + esc(SKIP_ROW) + '</div>';
      h += '<div class="row">' + link(gh('tree', DATA.path), 'Open on GitHub', true) +
        (DATA.path ? ' · ' + link(mapLink(DATA, up), up ? 'Map ' + up + '/' : 'Map the whole repository') : '') + '</div>';
      h += '<div class="row muted">Hover a box for details. Click a box to keep it here.</div>';
      h += childList(n);
    } else if (n.kind === 'dir') {
      h += '<div class="name">' + esc(n.n) + ' <span>· folder</span></div>';
      h += '<div class="path">' + esc(n.path) + '/</div>';
      h += '<div class="row">' + n.nfiles.toLocaleString() + ' files · ' + n.nlines.toLocaleString() + ' source lines</div>';
      h += '<div class="row">' + n.c.length + ' children · ' + n.desc + ' descendants</div>';
      h += '<div class="row">' + link(gh('tree', n.path), 'Open on GitHub', true) + ' · ' + link(mapLink(DATA, n.path), 'Map only this folder') + '</div>';
      h += childList(n);
    } else {
      const sc = scopesOf(n);
      h += '<div class="name">' + esc(n.n) + ' <span>· file</span></div>';
      h += '<div class="path">' + esc(n.path) + '</div>';
      const li = (hover === n && hoverLine >= 0) ? hoverLine : (hit && hit.f === n ? hit.i : -1);
      h += '<div class="row">line ' + (li >= 0 ? li + 1 : 1) + '</div>';
      h += '<div class="row">' + n.lines.length.toLocaleString() + ' source lines · ' + n.bytes.toLocaleString() + ' bytes · ' + esc(n.l) + '</div>';
      h += '<div class="row">' + (sc.length ? sc.length + ' blocks · nesting depth ' + n.maxDepth : 'No blocks outlined in this file.') + '</div>';
      h += '<div class="row">' + link(gh('blob', n.path, li >= 0 ? li + 1 : 0), li >= 0 ? 'Open line ' + (li + 1) + ' on GitHub' : 'Open on GitHub', true) + '</div>';
      if (li >= 0) h += '<pre>' + esc(n.lines[li] || '') + '</pre>';
    }
    insp.innerHTML = h;
    insp.querySelectorAll('li[data-i]').forEach(function (el) {
      el.addEventListener('click', function () { const ch = n.c[+el.dataset.i]; selected = ch; fitNode(ch); renderInspector(); });
    });
    statusEl.textContent = selected ? 'selected ' + selected.path : (hover ? (hover.path || NAME) : '');
  }
  function childList(n) {
    let h = '<ul>';
    n.c.slice(0, 14).forEach(function (ch, i) {
      h += '<li data-i="' + i + '"><em>' + esc(ch.n) + (ch.kind === 'dir' ? '/' : '') + '</em><span>' +
        (ch.kind === 'dir' ? ch.nlines : ch.lines.length).toLocaleString() + ' lines</span></li>';
    });
    if (n.c.length > 14) h += '<li><span>and ' + (n.c.length - 14) + ' more</span></li>';
    return h + '</ul>';
  }

  // ---------- search ----------
  const q = $('q'), qcount = $('qcount'), results = $('results');
  let searchTimer = null;
  q.addEventListener('input', function () { clearTimeout(searchTimer); searchTimer = setTimeout(runSearch, 120); });
  q.addEventListener('keydown', function (e) { if (e.key === 'Escape') { q.value = ''; runSearch(); q.blur(); } });
  function runSearch() {
    const term = q.value.trim().toLowerCase();
    results.innerHTML = '';
    if (term.length < 2) { qcount.textContent = term.length ? 'type at least two characters' : ''; hit = null; dirty(); return; }
    const t0 = performance.now();
    const groups = []; let total = 0;
    for (const f of FILES) {
      if (!f.low) f.low = f.lines.map(function (l) { return l.toLowerCase(); });
      let rows = null;
      for (let i = 0; i < f.low.length; i++) {
        const p = f.low[i].indexOf(term);
        if (p >= 0) { (rows || (rows = [])).push([i, p]); total++; }
      }
      if (rows) groups.push({ f: f, rows: rows });
    }
    groups.sort(function (a, b) { return b.rows.length - a.rows.length; });
    const ms = (performance.now() - t0).toFixed(1);
    qcount.textContent = total ? total + ' matches in ' + groups.length + ' files · ' + ms + ' ms' : 'no matches';
    const frag = document.createDocumentFragment();
    let shown = 0; const CAP = 400;
    for (const g of groups) {
      if (shown >= CAP) break;
      const fh = document.createElement('div'); fh.className = 'file';
      fh.innerHTML = '<span>' + esc(g.f.path) + '</span><b>' + g.rows.length + '</b>';
      fh.addEventListener('click', function () { selected = g.f; hit = { f: g.f, i: g.rows[0][0] }; fitNode(g.f); renderInspector(); });
      frag.appendChild(fh);
      for (const row of g.rows) {
        if (shown >= CAP) break;
        const i = row[0], p = row[1], ln = g.f.lines[i];
        const a = Math.max(0, p - 30), s = ln.slice(a, p), m = ln.slice(p, p + term.length), e = ln.slice(p + term.length, p + term.length + 70);
        const el = document.createElement('div'); el.className = 'hit';
        el.innerHTML = '<span class="ln">' + (i + 1) + '</span><span class="tx">' + (a > 0 ? '…' : '') + esc(s) + '<mark>' + esc(m) + '</mark>' + esc(e) + '</span>';
        el.addEventListener('click', function () {
          results.querySelectorAll('.hit.on').forEach(function (x) { x.classList.remove('on'); });
          el.classList.add('on');
          selected = g.f; hit = { f: g.f, i: i }; flyToLine(g.f, i, 13); renderInspector();
        });
        frag.appendChild(el); shown++;
      }
    }
    if (total > shown) { const m = document.createElement('div'); m.className = 'more'; m.textContent = (total - shown) + ' more matches not listed; narrow the search'; frag.appendChild(m); }
    results.appendChild(frag);
  }

  // ---------- interaction ----------
  let drag = null, pinch = null;
  const pointers = new Map();
  canvas.addEventListener('pointerdown', function (e) {
    if (e.button !== 0) return;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    canvas.setPointerCapture(e.pointerId);
    // a second finger turns the gesture into a pinch
    if (pointers.size === 2) { drag = null; pinch = null; anim = null; return; }
    drag = { x: e.clientX, y: e.clientY, tx: cam.tx, ty: cam.ty, moved: false };
  });
  canvas.addEventListener('pointermove', function (e) {
    if (pointers.has(e.pointerId)) pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const r = canvas.getBoundingClientRect();
    if (pointers.size === 2) {
      const p = Array.from(pointers.values());
      const d = Math.hypot(p[0].x - p[1].x, p[0].y - p[1].y);
      const mx = (p[0].x + p[1].x) / 2 - r.left, my = (p[0].y + p[1].y) / 2 - r.top;
      if (pinch && pinch.d > 0) { zoomAt(mx, my, d / pinch.d); cam.tx += mx - pinch.mx; cam.ty += my - pinch.my; clampCam(); dirty(); }
      pinch = { d: d, mx: mx, my: my };
      return;
    }
    if (drag) {
      const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
      if (Math.abs(dx) + Math.abs(dy) > 3) drag.moved = true;
      if (drag.moved) { anim = null; cam.tx = drag.tx + dx; cam.ty = drag.ty + dy; clampCam(); dirty(); }
      return;
    }
    if (tilted) return;
    const wx = (e.clientX - r.left - cam.tx) / cam.s, wy = (e.clientY - r.top - cam.ty) / cam.s;
    const n = pick(wx, wy);
    const li = n.kind === 'file' ? lineAt(n, wx, wy) : -1;
    if (n !== hover || li !== hoverLine) { hover = n; hoverLine = li; renderInspector(); dirty(); }
  });
  function release(e) { pointers.delete(e.pointerId); if (pointers.size < 2) pinch = null; }
  canvas.addEventListener('pointercancel', function (e) { release(e); drag = null; });
  canvas.addEventListener('pointerup', function (e) {
    release(e);
    if (!drag) return;
    const moved = drag.moved; drag = null;
    if (moved || tilted) return;
    const r = canvas.getBoundingClientRect();
    const wx = (e.clientX - r.left - cam.tx) / cam.s, wy = (e.clientY - r.top - cam.ty) / cam.s;
    const n = pick(wx, wy);
    selected = n === ROOT ? null : n;
    // once the code is readable, the clicked line is pinned too
    if (n.kind === 'file') {
      const li = n.fs * cam.s >= 3.4 ? lineAt(n, wx, wy) : -1;
      if (li >= 0) hit = { f: n, i: li }; else if (hit && hit.f !== n) hit = null;
    }
    renderInspector(); dirty();
  });
  canvas.addEventListener('pointerleave', function () { if (hover) { hover = null; hoverLine = -1; renderInspector(); dirty(); } });
  canvas.addEventListener('dblclick', function (e) {
    const r = canvas.getBoundingClientRect();
    const n = tilted ? null : pick((e.clientX - r.left - cam.tx) / cam.s, (e.clientY - r.top - cam.ty) / cam.s);
    if (n && n !== ROOT) { selected = n; fitNode(n); renderInspector(); }
  });
  canvas.addEventListener('wheel', function (e) {
    e.preventDefault(); anim = null;
    const r = canvas.getBoundingClientRect();
    const mx = tilted ? VW / 2 : e.clientX - r.left, my = tilted ? VH / 2 : e.clientY - r.top;
    zoomAt(mx, my, Math.exp(-e.deltaY * (e.deltaMode === 1 ? 0.05 : 0.0016)));
    clampCam(); dirty();
  }, { passive: false });
  window.addEventListener('keydown', function (e) {
    if (e.target instanceof HTMLInputElement || e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.key === 'Home' || e.key === '0') { anim = null; flyTo(fitRect(0, 0, W0, H0, 0.985)); }
    else if (e.key === 'Escape') { selected = null; hit = null; renderInspector(); dirty(); }
    else if (e.key === '/') { e.preventDefault(); showTab('search'); q.focus(); q.select(); }
  });
  $('btn-fit').addEventListener('click', function () { anim = null; flyTo(fitRect(0, 0, W0, H0, 0.985)); });
  $('btn-labels').addEventListener('click', function () { showLabels = !showLabels; this.classList.toggle('on', showLabels); dirty(); });
  $('btn-scopes').addEventListener('click', function () { showScopes = !showScopes; this.classList.toggle('on', showScopes); dirty(); });
  $('btn-tilt').addEventListener('click', function () {
    tilted = !tilted; this.classList.toggle('on', tilted); stage.classList.toggle('tilt', tilted);
    hover = null; hoverLine = -1; renderInspector(); dirty();
    $('hint').textContent = tilted ? '3D view: scroll zooms about the center, drag pans, hover picking is off' :
      'scroll to zoom · drag to pan · double click to zoom into a box · / search · Home fit';
  });
  function showTab(name) {
    document.querySelectorAll('.tabs button').forEach(function (b) { b.classList.toggle('on', b.dataset.tab === name); });
    document.querySelectorAll('.tab').forEach(function (t) { t.hidden = t.id !== name; });
  }
  document.querySelectorAll('.tabs button').forEach(function (b) { b.addEventListener('click', function () { showTab(b.dataset.tab); if (b.dataset.tab === 'search') q.focus(); }); });

  // ---------- boot ----------
  resize();
  W0 = VW; H0 = VH;
  layout(ROOT, 0, 0, W0, H0);
  fitScale = Math.min(VW / W0, VH / H0);
  let minFs = Infinity; for (const f of FILES) if (f.fs > 0 && f.fs < minFs) minFs = f.fs;
  maxScale = 42 / minFs;
  fitAll();
  renderInspector();
  window.addEventListener('resize', function () { resize(); clampCam(); });

  // exposed for scripted checks
  window.scope = {
    data: DATA, files: FILES, dirs: DIRS, cam: cam, flyToLine: flyToLine, fitNode: fitNode, fitAll: fitAll, draw: draw, scopesOf: scopesOf, tokenize: tokenize,
    find: function (p) { return FILES.find(function (f) { return f.path === p; }) || DIRS.find(function (d) { return d.path === p; }); },
    jump: function (n, i, px) { if (i === undefined) fitNode(n); else flyToLine(n, i, px); if (anim) anim(performance.now() + 1e6); }
  };
})();
