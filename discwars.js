// ENCOM OS-12: the disc duel, on a canvas.
//
// A port of the lock screen's scene (lock/DiscWars.qml) to the web. Two
// original fighters, a program and a sentinel, each stand on a platform
// ringed by four concentric rings floating high above the arena floor, and
// fight over it with identity discs.
//
// They trade discs fast. A throw at the body is blocked on the defender's
// own disc, held up as a shield (only when that disc is home), or dodged
// with a sidestep or a flip (a side flip, a butterfly twist or a backflip)
// that carries it to another ring, never off the edge, and across a gap if
// a ring is gone; or in place with a duck, a sweep kick or a split jump; the
// disc ricochets off the glass. Now and then a throw connects: the fighter
// is knocked back a ring and stunned, or, with no ring behind, slides off
// and grabs the edge; or, three times in ten, derezzes, its outline breaking
// into a hundred pieces that tumble down to the arena floor. Now and then a
// throw is banked off the ceiling onto one of the opponent's rings, often
// the one it stands on; the defender may catch it on a shield held overhead,
// or lose the ring. Losing its footing, a fighter drops and clings to the
// edge of the nearest ring still up; the next banked throw takes that out
// and it falls and derezzes. The rings rise again, the fighter rezzes back
// in, and the duel goes on.
//
// The movement is motion capture (poses.js, baked from the CMU Graphics Lab
// database: a frisbee throw, a stance, a sidestep); the block, the flip and
// the hang are built on top of it. The scene is 3D through a slowly drifting
// perspective camera, projected by hand each frame.
//
// The QML original placed one QtQuick rectangle per edge and let the scene
// graph sort them by a `z` property. Here every edge is a stroke instead,
// and the draw list is sorted by depth once a frame -- a painter's
// algorithm, which is what that `z` amounted to. Limbs are round-capped
// lines rather than rounded rectangles nudged to overlap at the joints,
// which is the same shape for less arithmetic.
(function () {
  "use strict";

  var Poses = window.POSES;

  // ── Palettes ──────────────────────────────────────────────────────────
  // The six ENCOM OS-12 themes, as the desktop wears them.
  var THEMES = {
    "tron-legacy": { name: "TRON Legacy", sideA: "#6fc3df", sideAHi: "#d8f6ff", sideB: "#ff8c21", sideBHi: "#ffd9a8", accent: "#6fc3df", accentHi: "#a8ecff", ink: "#010306" },
    "clu":         { name: "CLU",         sideA: "#ff9d2e", sideAHi: "#ffd7a9", sideB: "#38c6f4", sideBHi: "#bdecfb", accent: "#ff9d2e", accentHi: "#ffc37e", ink: "#050402" },
    "tron-1982":   { name: "TRON 1982",   sideA: "#3b7bff", sideAHi: "#d7e6ff", sideB: "#ffbe00", sideBHi: "#fff3cf", accent: "#3b7bff", accentHi: "#8fb3ff", ink: "#020305" },
    "tron-uprising": { name: "Uprising",  sideA: "#dff3ee", sideAHi: "#ffffff", sideB: "#c4562f", sideBHi: "#ffb48c", accent: "#11a389", accentHi: "#e6f1ef", ink: "#04100e" },
    "tron-2-0":    { name: "TRON 2.0",    sideA: "#6fd8ff", sideAHi: "#d8f6ff", sideB: "#8fd63f", sideBHi: "#d6f79a", accent: "#79c72f", accentHi: "#cdf08a", ink: "#061513" },
    "dillinger-systems": { name: "Dillinger", sideA: "#ff3b30", sideAHi: "#ffd1ac", sideB: "#7fd0ff", sideBHi: "#ffffff", accent: "#ff3b30", accentHi: "#ffa781", ink: "#050202" }
  };
  var pal = THEMES["tron-legacy"];
  var program, programHi, sentinel, sentinelHi, ink, line, lineHi;
  function applyPalette(p) {
    pal = p;
    program = p.sideA; programHi = p.sideAHi;
    sentinel = p.sideB; sentinelHi = p.sideBHi;
    ink = p.ink; line = p.accent; lineHi = p.accentHi;
    rebuildLines();
  }

  // ── Arena constants ───────────────────────────────────────────────────
  var floorY = -3.5;                 // the arena floor, far below
  var ceilY = 4.2;
  var centreX = 8.0;                 // the two ranks stand this far either side
  var rankGap = 5.4;                 // between teammates, across the arena's depth
  // 1v1, 2v2 or 3v3. The arena, the camera and the number of duels running at
  // once all follow from this.
  var teamSize = 1;
  // How many stand on each side. Equal in an ordinary match; a match set up
  // from the Hall of Champions can be lopsided -- one against three, say.
  var sideSize = [1, 1];
  // A match from the Hall: the champions picked for it keep their seats for
  // every round of it, and nobody new is crowned.
  var hall = false;
  var lastWinner = -1;
  var arenaZ = 5.5;                  // the glass wall, far enough back to clear the rings
  // Rings per fighter: the platform, then four rings; [inner, outer] radii.
  var ringRadii = [[0, 0.5], [0.56, 0.96], [1.02, 1.42], [1.48, 1.88], [1.94, 2.34]];
  var ringCount = ringRadii.length;
  var ringSegs = 24;

  // Two clocks: `now` runs the fight at `pace` times real speed; `wall` is
  // real time, for what should stay watchable (camera, sparks, falls).
  var pace = 2.55;
  var now = 0, wall = 0;

  var fov = 48 * Math.PI / 180;
  var cam = { p: [0, 3, 10], f: [0, 0, -1], r: [1, 0, 0], u: [0, 1, 0], F: 1000 };
  var W = 0, H = 0;                  // canvas size in CSS pixels

  // ── Vector helpers ────────────────────────────────────────────────────
  function sub(a, b) { return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]; }
  function dot(a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }
  function cross(a, b) { return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]; }
  function norm(a) { var l = Math.sqrt(dot(a, a)) || 1; return [a[0] / l, a[1] / l, a[2] / l]; }
  function lerp3(a, b, t) { return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]; }
  function rand(a, b) { return a + Math.random() * (b - a); }
  function ease(u) { return u * u * (3 - 2 * u); }

  // Where the camera is drawn to: the middle of the arena, pulled toward
  // whatever exchange is in the air. With one duel this barely moves; with
  // three it keeps the busy corner of the arena in frame.
  var look = [0, 0.7, 0];
  function aimPoint() {
    var sx = 0, sz = 0, n = 0;
    for (var i = 0; i < ds.length; i++) {
      if (ds[i].state !== "flight") continue;
      sx += ds[i].pos[0]; sz += ds[i].pos[2]; n++;
    }
    // The duel's framing was composed around a fixed camera, so it keeps one;
    // only a team match, which is too wide to hold in one shot, is followed.
    var pull = (teamSize - 1) / 2;
    if (!n || pull === 0) return [0, 0.7, 0];
    return [sx / n * 0.35 * pull, 0.7, sz / n * 0.6 * pull];
  }

  function aimCamera(dt) {
    // A slow drift around the front of the arena, rising and falling.
    var want = aimPoint(), ease_ = Math.min(1, (dt || 0.016) * 0.7);
    look = [look[0] + (want[0] - look[0]) * ease_, 0.7,
            look[2] + (want[2] - look[2]) * ease_];
    var yaw = 0.22 * Math.sin(wall * 0.06);
    var dist = 14.6 + (teamSize - 1) * 2.9;
    var h = 2.2 + 0.5 * Math.sin(wall * 0.045 + 1) + (teamSize - 1) * 0.35;
    var target = look;
    var p = [target[0] + Math.sin(yaw) * dist, h, target[2] + Math.cos(yaw) * dist];
    var f = norm(sub(target, p)), r = norm(cross(f, [0, 1, 0])), u = cross(r, f);
    cam = { p: p, f: f, r: r, u: u, F: (H / 2) / Math.tan(fov / 2) };
  }

  // World point -> [screenX, screenY, depth]
  function project(w) {
    var d = sub(w, cam.p), z = Math.max(0.05, dot(d, cam.f));
    return [W / 2 + cam.F * dot(d, cam.r) / z, H / 2 - cam.F * dot(d, cam.u) / z, z];
  }

  // ── The draw list ─────────────────────────────────────────────────────
  // Everything the frame wants drawn goes in here with a depth, and the
  // list is sorted once before any of it is painted. The records are kept
  // in a pool and refilled each frame so a steady scene stops allocating.
  var pool = [], dn = 0;
  function put(kind, z) {
    var r = pool[dn];
    if (!r) { r = {}; pool[dn] = r; }
    dn++;
    r.k = kind; r.z = z; r.o = 1;
    return r;
  }
  // A round-capped stroke between two screen points: the QML original's
  // rounded rectangle, which is the same shape.
  function seg(z, a, b, w, col, alpha, cap) {
    var r = put("seg", z);
    r.ax = a[0]; r.ay = a[1]; r.bx = b[0]; r.by = b[1];
    r.w = w; r.c = col; r.o = alpha; r.cap = cap || "butt";
    return r;
  }
  // A limb: dark inside, edged in the fighter's light.
  function limb(z, a, b, w, col, alpha) {
    var r = put("limb", z);
    r.ax = a[0]; r.ay = a[1]; r.bx = b[0]; r.by = b[1];
    r.w = w; r.c = col; r.o = alpha;
    return r;
  }

  var ctx = null;

  function strokeLine(r, width, style) {
    ctx.lineWidth = Math.max(0.35, width);
    ctx.strokeStyle = style;
    ctx.beginPath();
    ctx.moveTo(r.ax, r.ay);
    ctx.lineTo(r.bx, r.by);
    ctx.stroke();
  }

  function ellipse(cx, cy, rx, ry) {
    ctx.beginPath();
    ctx.ellipse(cx, cy, Math.max(0.5, rx), Math.max(0.5, ry), 0, 0, Math.PI * 2);
  }

  var BODY = "#03080b";              // the dark inside of a figure

  // ── Names ─────────────────────────────────────────────────────────────
  // Drawn from the stroke font in vector.js, in screen space at the point
  // over the head, so a name is always square to the viewer however the
  // camera has come round -- and sized off the same perspective divide as
  // the head beneath it, so it shrinks with distance like everything else.
  // ── Rank ──────────────────────────────────────────────────────────────
  // A champion wears what it has held, and it climbs the way enlisted
  // insignia climbs: chevrons first, then rockers under them, then a device
  // in the middle once there is nowhere left to go. One round is a single
  // chevron; nine or more is three chevrons, three rockers and a star.
  var RANKS = [
    null,
    { c: 1, r: 0, name: "PRIVATE" },
    { c: 1, r: 1, name: "PRIVATE FIRST CLASS" },
    { c: 2, r: 0, name: "CORPORAL" },
    { c: 3, r: 0, name: "SERGEANT" },
    { c: 3, r: 1, name: "STAFF SERGEANT" },
    { c: 3, r: 2, name: "SERGEANT FIRST CLASS" },
    { c: 3, r: 3, name: "MASTER SERGEANT" },
    { c: 3, r: 3, d: "lozenge", name: "FIRST SERGEANT" },
    { c: 3, r: 3, d: "star", name: "SERGEANT MAJOR" }
  ];
  function rankOf(n) { return RANKS[Math.max(0, Math.min(RANKS.length - 1, n))]; }

  // Drawn over the name, in screen space like the name itself. `low` is the
  // bottom of the badge; it is built upward from there, rockers nearest the
  // name and chevrons on top, as they sit on a sleeve.
  function rankAt(n, cx, low, unit, col, alpha, z) {
    var R = rankOf(n);
    if (!R || unit < 0.9) return;                  // too small to make out
    // The rows have to clear each other or three chevrons read as one blot:
    // a chevron rises about one unit, so the step between rows is more than
    // that, and the stroke is thin enough to leave the gap visible.
    var w = unit * 2.4, y = low, gap = unit * 1.55, th = Math.max(1, unit * 0.3);

    for (var r = 0; r < R.r; r++) {                // rockers: shallow arcs
      var pts = [[-w, y - unit * 0.34], [-w * 0.55, y], [0, y + unit * 0.2],
                 [w * 0.55, y], [w, y - unit * 0.34]];
      for (var i = 0; i + 1 < pts.length; i++)
        seg(z, [cx + pts[i][0], pts[i][1]], [cx + pts[i + 1][0], pts[i + 1][1]], th, col, alpha, "round");
      y -= gap;
    }
    if (R.d) {                                     // the device sits between
      var m = unit * 0.85;
      if (R.d === "lozenge") {
        var dia = [[0, -m], [m * 0.7, 0], [0, m], [-m * 0.7, 0], [0, -m]];
        for (var k = 0; k + 1 < dia.length; k++)
          seg(z, [cx + dia[k][0], y - unit * 0.1 + dia[k][1]],
                 [cx + dia[k + 1][0], y - unit * 0.1 + dia[k + 1][1]], th, col, alpha, "round");
      } else {                                     // a five-pointed star
        var star = [];
        for (var a = 0; a < 11; a++) {
          var ang = -Math.PI / 2 + a * Math.PI / 5;
          var rad = a % 2 === 0 ? m : m * 0.42;
          star.push([Math.cos(ang) * rad, Math.sin(ang) * rad]);
        }
        for (var t = 0; t + 1 < star.length; t++)
          seg(z, [cx + star[t][0], y - unit * 0.1 + star[t][1]],
                 [cx + star[t + 1][0], y - unit * 0.1 + star[t + 1][1]], th, col, alpha, "round");
      }
      y -= gap * 1.5;
    }
    for (var c = 0; c < R.c; c++) {                // chevrons, pointing up
      seg(z, [cx - w, y], [cx, y - unit * 0.95], th, col, alpha, "round");
      seg(z, [cx, y - unit * 0.95], [cx + w, y], th, col, alpha, "round");
      y -= gap;
    }
  }

  var Font = null;
  function nameAt(text, cx, cy, cap, col, alpha, z) {
    if (!Font) Font = window.DiscWarsFont || null;
    if (!Font || !text || cap < 2.2) return;       // too far off to read anyway
    var u = cap / Font.height;                     // glyph units to pixels
    var x = cx - Font.width(text) * u / 2;
    var w = Math.max(1, cap * 0.13);
    for (var i = 0; i < text.length; i++) {
      var g = Font.glyph(text.charAt(i));
      if (g) {
        for (var k = 0; k < g.length; k++) {
          var st = g[k];
          for (var j = 0; j + 1 < st.length; j++) {
            seg(z, [x + st[j][0] * u, cy + st[j][1] * u],
                   [x + st[j + 1][0] * u, cy + st[j + 1][1] * u],
                w, col, alpha, "round");
          }
        }
      }
      x += Font.advance * u;
    }
  }

  function paint() {
    var items = pool.slice(0, dn);
    items.sort(function (a, b) { return a.z - b.z; });
    for (var i = 0; i < items.length; i++) {
      var r = items[i];
      ctx.globalAlpha = Math.max(0, Math.min(1, r.o));
      if (r.k === "seg") {
        ctx.lineCap = r.cap;
        strokeLine(r, r.w, r.c);
      } else if (r.k === "limb") {
        ctx.lineCap = "round";
        strokeLine(r, r.w, r.c);                    // the lit edge
        if (r.w > 3.6) strokeLine(r, r.w - 3, BODY);  // hollowed out
      } else if (r.k === "head") {
        ctx.lineCap = "butt";
        ctx.beginPath();
        ctx.roundRect(r.x, r.y, r.w, r.h, Math.min(r.w, r.h) / 2);
        ctx.fillStyle = BODY; ctx.fill();
        ctx.lineWidth = 1.5; ctx.strokeStyle = r.c; ctx.stroke();
        var vh = Math.max(2, r.h * 0.14), vw = r.w * 0.5;
        ctx.beginPath();
        ctx.roundRect(r.x + r.vx, r.y + r.h * 0.42, vw, vh, vh / 2);
        ctx.fillStyle = r.c; ctx.fill();
      } else if (r.k === "disc") {
        ellipse(r.x, r.y, r.w * 0.95, r.h * 0.95);   // glow
        ctx.fillStyle = r.c; ctx.globalAlpha = 0.18 * r.o; ctx.fill();
        ctx.globalAlpha = Math.max(0, Math.min(1, r.o));
        ellipse(r.x, r.y, r.w / 2, r.h / 2);
        ctx.fillStyle = BODY; ctx.fill();
        ctx.lineWidth = Math.max(2, Math.min(r.w, r.h) * 0.12);
        ctx.strokeStyle = r.hot; ctx.stroke();
        ellipse(r.x, r.y, r.w * 0.2, r.h * 0.2);
        ctx.lineWidth = 1.5; ctx.strokeStyle = r.c; ctx.stroke();
      } else if (r.k === "spark") {
        var ring = r.size * (1 + r.age * 8);
        ctx.globalAlpha = Math.max(0, 1 - r.age / 0.5);
        ellipse(r.x, r.y, ring / 2, ring / 2);
        ctx.lineWidth = 2; ctx.strokeStyle = r.c; ctx.stroke();
        ctx.globalAlpha = Math.max(0, 0.85 - r.age * 4);
        ellipse(r.x, r.y, r.size * 0.9, r.size * 0.9);
        ctx.fillStyle = "#ffffff"; ctx.fill();
      }
    }
    ctx.globalAlpha = 1;
  }

  // ── Arena: floor far below, the glass back wall, the ceiling edge ─────
  // [from, to, opacity, colour, width]
  var lines = [];
  function rebuildLines() {
    var L = [], X = 16, Z = arenaZ, lo = floorY, hi = ceilY;
    for (var x = -X; x <= X; x += 1.5) L.push([[x, lo, -Z], [x, lo, Z], 0.1, line, 1]);
    for (var z = -Z; z <= Z + 0.01; z += 1) L.push([[-X, lo, z], [X, lo, z], 0.1, line, 1]);
    for (var wx = -X; wx <= X; wx += 4) L.push([[wx, lo, -Z], [wx, hi, -Z], 0.1, line, 1]);
    L.push([[-X, 0, -Z], [X, 0, -Z], 0.08, line, 1]);
    for (var cx = -X; cx <= X; cx += 4) L.push([[cx, hi, -Z], [cx, hi, 2], 0.12, line, 1]);
    L.push([[-X, hi, -Z], [X, hi, -Z], 0.45, lineHi, 1]);
    L.push([[-X, lo, -Z], [-X, hi, -Z], 0.45, lineHi, 1]);
    L.push([[X, lo, -Z], [X, hi, -Z], 0.45, lineHi, 1]);
    lines = L;
  }

  // ── Rings ─────────────────────────────────────────────────────────────
  // Rings are per fighter, per ring: state "up", "falling" (t = when it went)
  // or "rising" (t = when it started back). buildMatch fills them in.

  function ringLook(p, k) {                      // [y offset, opacity]
    var r = pads[p].rings[k];
    if (r.s === "falling") { var a = wall - r.t; return [-4.5 * a * a, Math.max(0, 1 - a / 1.1)]; }
    if (r.s === "rising") { var b = Math.min(1, (wall - r.t) / 0.9); return [-1.5 * (1 - ease(b)), b]; }
    return [0, 1];
  }
  function breakRing(p, k) { pads[p].rings[k] = { s: "falling", t: wall }; }
  function restoreRings(p) {
    for (var k = 0; k < ringCount; k++)
      if (pads[p].rings[k].s !== "up") pads[p].rings[k] = { s: "rising", t: wall };
  }
  // How long a ring stays gone before it rises again by itself. With more
  // fighters there is more shooting, so without this an arena played long
  // enough would end up with nothing left to stand on.
  var ringBack = 26;
  function ringUp(p, k) { return pads[p].rings[k].s !== "falling"; }

  // ── Fighters ──────────────────────────────────────────────────────────
  // Joints (Poses.joints): 0 pelvis, 1/5 hips, 2/6 knees, 3/7 ankles, 4/8 toes,
  // 9 chest, 10 neck, 11 head top, 12/16 shoulders, 13/17 elbows,
  // 14/18 wrists, 15/19 hands (left/right).
  var limbs = [
    [1, 2, 0.13], [2, 3, 0.10], [3, 4, 0.07], [5, 6, 0.13], [6, 7, 0.10], [7, 8, 0.07],
    [1, 5, 0.13], [0, 9, 0.25], [9, 10, 0.08], [12, 16, 0.11],
    [12, 13, 0.08], [13, 14, 0.07], [14, 15, 0.06], [16, 17, 0.08], [17, 18, 0.07], [18, 19, 0.06]
  ];

  // ── Who they are ──────────────────────────────────────────────────────
  // Three pools, drawn from without repeating inside a match. Short enough
  // to read over a head at the back of the arena.
  var NAMES = [
    // Unix commands
    "GREP", "AWK", "SED", "CHMOD", "KILL", "PING", "CURL", "TAR", "CRON",
    "SUDO", "MOUNT", "FSCK", "NICE", "TEE", "SORT", "UNIQ", "FIND", "MAKE",
    "DIFF", "PATCH", "TRAP", "YES", "DMESG", "STTY", "NOHUP", "XARGS",
    // Greek given names
    "ALEXIOS", "NIKOS", "STAVROS", "KOSTAS", "THEO", "ARIS", "PETROS",
    "SPIROS", "ELENI", "SOFIA", "DESPINA", "THALIA", "IOANNA", "ANDREAS",
    "VASILIS", "MANOS", "PHAEDRA", "DAPHNE", "ZOE", "IRIS", "LYDIA",
    "PHOEBE", "CALLISTA", "ORESTES", "AGATHA", "LEANDROS",
    // Languages that are also words
    "BASIC", "FORTRAN", "PASCAL", "LOGO", "FORTH", "SCHEME", "RUST", "SWIFT",
    "JULIA", "ADA", "GO", "LISP", "PROLOG", "EIFFEL", "OBERON", "MODULA",
    "ICON", "SNOBOL", "ELM", "NIM", "CRYSTAL", "RED", "FACTOR", "SELF",
    "CLIPPER", "SIMULA"
  ];
  // And two that are not from any pool, spelled the way their owners spell
  // them. Rare on purpose: a name you see every round is furniture.
  var EGGS = ["Tal", "ZuGzUg"];
  var EGG_CHANCE = 1 / 40;

  function freshName(taken) {
    for (var tries = 0; tries < 200; tries++) {
      var pool = Math.random() < EGG_CHANCE ? EGGS : NAMES;
      var n = pool[Math.floor(Math.random() * pool.length)];
      if (taken.indexOf(n) < 0) { taken.push(n); return n; }
    }
    return "PROC" + Math.floor(Math.random() * 90 + 10);
  }

  // What a fighter is worth at the end of a round. Taking somebody out is
  // worth most; getting a disc past a guard is worth more than answering
  // one, since the arena makes that harder.
  var POINTS = { hits: 3, kills: 5, rings: 2, blocks: 1, dodges: 1 };
  function tally(f) {
    var t = f.stats;
    return t.hits * POINTS.hits + t.kills * POINTS.kills + t.rings * POINTS.rings +
           t.blocks * POINTS.blocks + t.dodges * POINTS.dodges;
  }
  function blankStats() {
    return { throws: 0, hits: 0, blocks: 0, dodges: 0, kills: 0, rings: 0, rounds: 0 };
  }

  // Who speaks for a side. One voice each, because three at once is a pile
  // and not a part: a champion holds it for as long as it is standing, and
  // when there is none it belongs to whoever on that side has most to show
  // for the round so far. It changes hands the moment somebody outscores the
  // holder or the holder goes down, which is the point -- you hear the side's
  // best fighter, whoever that has become.
  //
  // Worked out when it is asked for and never stored. A thing kept in step
  // with the world by hand comes apart from it, and this one would have to
  // be corrected on every hit, block, dodge, ring and death.
  function voiceOf(team) {
    var best = -1, bestScore = -1;
    for (var i = 0; i < fs.length; i++) {
      if (fs[i].team !== team || !alive(i)) continue;
      if (fs[i].champion) return i;              // still standing: still speaking
      var sc = tally(fs[i]);
      if (sc > bestScore) { bestScore = sc; best = i; }
    }
    return best;
  }
  function speaks(p) { return voiceOf(fs[p].team) === p; }

  function newFighter(team, home, fv) {
    var pd = pads[home];
    return { team: team, home: home, pad: home, foe: -1,
             ring: 0, ang: 0, pos: [pd.cx, pd.cz], fv: fv, move: null, clingRing: -1,
             clingAt: null, willClimb: false, dropFrom: null, clip: "idle", t: rand(0, 1),
             speed: 1, from: null, blend: 1, block: 0, blockTarget: 0, pose: null,
             mode: "stand", mt: 0, yOff: 0, alpha: 1, flip: "side", flipSide: 1,
             high: false, grip: "right", evade: "duck",
             lastAim: -1, lastGuard: -1, lastThrowAim: 1,
             name: "", champion: false, stats: blankStats(),
             // What has worked: pairs of throws that ended with a kill, and
             // the second half of one part-way through being played again.
             combos: [], plan: null, prevAim: -1, practised: null, spared: false,
             // What it has won: powers, chosen one per round it wins.
             powers: [], spare: null, bitHold: null, bitShow: null, bitAt: null,
             shield: null,
             // A fruit fly's mushroom body, never yet given dopamine.
             brain: freshBrain() };
  }

  // flybrain.js gives every fighter a fly of its own; without it the fight
  // falls back on the two side-wide policies in learn.js, or plays blind.
  function freshBrain() { return window.FlyBrain ? new window.FlyBrain.Brain() : null; }
  function flies() { return !!window.FlyBrain; }

  // A platform and its four rings. A fighter starts on its own and can end
  // up on a teammate's, so the two are kept apart.
  var pads = [];
  var fs = [], ds = [], ringCircles = [];


  // Lay out a match: two ranks of `n` facing each other across the arena,
  // each fighter on its own platform with its own four rings.
  // `roster`, when given, is [programs, sentinels]: saved champions to seat
  // on each side. A side left empty is filled with new programs, as many as
  // the other side has champions.
  function buildMatch(n, roster) {
    var clamp = function (k) { return Math.max(1, Math.min(3, k | 0)); };
    hall = !!roster;
    lastWinner = -1;
    if (roster) {
      var a = roster[0].length, b = roster[1].length;
      sideSize = [clamp(a || b), clamp(b || a)];
    } else {
      sideSize = [clamp(n), clamp(n)];
    }
    teamSize = Math.max(sideSize[0], sideSize[1]);
    arenaZ = Math.max(5.5, rankGap * (teamSize - 1) / 2 + 3.2);
    pads = []; fs = []; ds = []; ringCircles = [];
    for (var team = 0; team < 2; team++) {
      for (var i = 0; i < sideSize[team]; i++) {
        pads.push({ team: team, rank: i,
                    cx: team === 0 ? -centreX : centreX,
                    cz: (i - (sideSize[team] - 1) / 2) * rankGap,
                    rings: ringRadii.map(function () { return { s: "up" }; }) });
      }
    }
    // One fighter per platform to begin with, in the same order. Seated
    // champions' names are spoken for first.
    var taken = [];
    if (roster) roster.forEach(function (side) { side.forEach(function (r) { taken.push(r.name); }); });
    pads.forEach(function (pd, i) {
      var f = newFighter(pd.team, i, [pd.team === 0 ? 1 : -1, 0]);
      var rec = roster && roster[pd.team][pd.rank];
      if (rec) seat(f, rec);
      else f.name = freshName(taken);
      fs.push(f);
      ds.push({ state: "back", pos: [0, 0, 0], trail: [], flight: null });
    });
    // Every edge circle of every ring, as [platform, ring, radius].
    for (var g = 0; g < pads.length; g++)
      for (var k = 0; k < ringCount; k++)
        ringRadii[k].forEach(function (r) { if (r > 0) ringCircles.push([g, k, r]); });
    queue = []; wallQueue = []; pieces = []; bugs = []; motes = [];
    score = [0, 0]; banner = "";
    if (choosing) { choosing = null; emit("choose", null); }   // the fighter it was for is gone
    startBrains();                       // a different match is a different game
    sparkData = [null, null, null, null];
    rebuildLines();
  }

  // A champion out of the Hall, back on a platform: its name, its record,
  // its named moves and its fly, exactly as they were kept.
  function seat(f, rec) {
    f.cid = rec.id;
    f.crowned = rec.crowned || Date.now();
    f.seated = true;
    f.champion = true;
    f.name = rec.name;
    var st = blankStats();
    Object.keys(st).forEach(function (k) { if (rec.stats && rec.stats[k] != null) st[k] = rec.stats[k] | 0; });
    f.stats = st;
    f.combos = (rec.combos || []).map(function (c) {
      return { trig: c.trig, from: c.from, b: c.b, used: c.used | 0 || 1, name: c.name };
    });
    if (flies()) f.brain = window.FlyBrain.load(rec.brain);
    f.powers = (rec.powers || []).filter(function (id) { return POWERS.hasOwnProperty(id); });
    // The shield comes back with as many squares as it had left.
    f.shield = f.powers.indexOf("shield") < 0 ? null
             : rec.shield && rec.shield.length === SHIELD_SQUARES ? rec.shield.map(Boolean) : fullShield();
  }

  // What the Hall keeps of a champion. Sent out after every round it is
  // part of, and when it falls, so the Hall always has its latest.
  function record(i) {
    var f = fs[i];
    if (!f || !f.champion) return null;
    if (!f.cid) { f.cid = "c" + Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }
    if (!f.crowned) f.crowned = Date.now();
    return { id: f.cid, name: f.name, team: f.team, crowned: f.crowned, updated: Date.now(),
             rounds: f.stats.rounds, rank: (rankOf(f.stats.rounds) || {}).name || null,
             points: tally(f), stats: JSON.parse(JSON.stringify(f.stats)),
             combos: f.combos.map(function (c) {
               return { trig: c.trig, from: c.from, b: c.b, used: c.used, name: c.name };
             }),
             brain: f.brain ? f.brain.save() : null,
             powers: (f.powers || []).slice(),
             shield: f.shield ? f.shield.slice() : null };
  }
  function keep(i) { var r = record(i); if (r) emit("record", r); }

  function alive(p) {
    var m = fs[p].mode;
    return m !== "gone" && m !== "fall" && m !== "derez";
  }
  // Opponents still standing; falls back to any opponent so facing never breaks.
  function foesOf(p) {
    var mine = fs[p].team, live = [], any = [];
    for (var i = 0; i < fs.length; i++) {
      if (fs[i].team === mine) continue;
      any.push(i);
      if (alive(i)) live.push(i);
    }
    return live.length ? live : any;
  }
  function nearestFoe(p) {
    var f = fs[p], best = -1, bd = Infinity;
    foesOf(p).forEach(function (i) {
      var dx = fs[i].pos[0] - f.pos[0], dz = fs[i].pos[1] - f.pos[1], d = dx * dx + dz * dz;
      if (d < bd) { bd = d; best = i; }
    });
    return best;
  }

  var throwSpeed = 1.4;
  function releaseTime() { return Poses.clips.throw.release / Poses.fps / throwSpeed; }

  function sample(name, t) {
    var c = Poses.clips[name], n = c.frames.length, fp = t * Poses.fps;
    if (name === "idle") {                // ping-pong so the stance loops smoothly
      var period = 2 * (n - 1);
      fp = fp % period;
      if (fp > n - 1) fp = period - fp;
    } else {
      fp = Math.min(fp, n - 1);
    }
    var i = Math.floor(fp), k = fp - i, a = c.frames[i], b = c.frames[Math.min(n - 1, i + 1)];
    var out = new Array(a.length);
    for (var j = 0; j < a.length; j++) out[j] = a[j] + (b[j] - a[j]) * k;
    return out;
  }
  function clipLength(name) { return (Poses.clips[name].frames.length - 1) / Poses.fps; }

  function play(p, name, speed) {
    var f = fs[p];
    f.from = f.pose ? f.pose.slice() : null;
    f.blend = 0; f.clip = name; f.t = 0; f.speed = speed || 1;
  }
  // Every change of mode goes through here, so it is also where hanging from
  // a ring edge is announced: the sequencer holds a note for as long as a
  // fighter is on the edge, and needs to know the moment it stops being.
  function setMode(p, m) {
    var was = fs[p].mode;
    fs[p].mode = m; fs[p].mt = 0;
    if (was === m) return;
    if (was === "cling") emit("unhang", { name: fs[p].name, team: fs[p].team });
    if (m === "cling") emit("hang", { name: fs[p].name, team: fs[p].team, lead: speaks(p) });
  }

  var flipTime = 1.1;                            // fight seconds
  // Dodges in place, and being hit (fight seconds).
  var evadeTime = { duck: 0.9, sweep: 1.0, split: 0.9, hit: 1.2 };
  // Mostly side flips and twists, sometimes a backflip.
  function startFlip(p) {
    var r = Math.random();
    fs[p].flip = r < 0.45 ? "side" : r < 0.8 ? "twist" : "back";
    fs[p].flipSide = Math.random() < 0.5 ? 1 : -1;
    setMode(p, "flip");
  }

  // Move joint j of a pose towards target point q by amount w.
  function pull(pose, j, q, w) {
    for (var c = 0; c < 3; c++) pose[j * 3 + c] += (q[c] - pose[j * 3 + c]) * w;
  }
  function jp(pose, j) { return [pose[j * 3], pose[j * 3 + 1], pose[j * 3 + 2]]; }

  // Local pose (figure facing +x, standing over the origin) for a fighter.
  function localPose(p, dt, realDt) {
    var f = fs[p];
    f.t += dt * f.speed;
    // Flips run on fight time (they dodge discs); drops, falls and the
    // rez stay at real speed so they can be seen.
    f.mt += (f.mode === "flip" || f.mode === "evade" || f.mode === "hit") ? dt : realDt;
    if (f.clip !== "idle" && f.t >= clipLength(f.clip)) play(p, "idle");
    var pose = sample(f.clip, f.t);
    if (f.from && f.blend < 1) {
      f.blend = Math.min(1, f.blend + dt / 0.18);
      for (var j = 0; j < pose.length; j++) pose[j] = f.from[j] + (pose[j] - f.from[j]) * f.blend;
    }

    // The block: the disc held up as a shield, across the chest or
    // overhead against a shot banked off the ceiling; in both hands, or in
    // the left or right alone (f.grip).
    f.block += Math.max(-dt / 0.2, Math.min(dt / 0.1, f.blockTarget - f.block));
    if (f.block > 0) {
      var chest = jp(pose, 9);
      // [shoulder, elbow, wrist, hand] joints of each arm.
      var arms = f.grip === "both" ? [[16, 17, 18, 19], [12, 13, 14, 15]]
               : f.grip === "left" ? [[12, 13, 14, 15]] : [[16, 17, 18, 19]];
      arms.forEach(function (arm) {
        var sh = jp(pose, arm[0]), side = sh[2] - chest[2];
        var two = f.grip === "both";
        if (f.high) {
          // One hand reaches across above the head; two meet over it.
          pull(pose, arm[1], [sh[0] + 0.1, sh[1] + 0.26, sh[2] - side * (two ? 0.1 : 0.2)], f.block);
          pull(pose, arm[2], [sh[0] + 0.16, sh[1] + 0.52, sh[2] - side * (two ? 0.45 : 0.6)], f.block);
          pull(pose, arm[3], [sh[0] + 0.18, sh[1] + 0.62, sh[2] - side * (two ? 0.72 : 0.9)], f.block);
        } else if (two) {
          // Both forearms up, the disc between the hands in front.
          pull(pose, arm[1], [sh[0] + 0.2, sh[1] - 0.16, sh[2] + side * 0.05], f.block);
          pull(pose, arm[2], [chest[0] + 0.4, chest[1] - 0.02, chest[2] + side * 0.5], f.block);
          pull(pose, arm[3], [chest[0] + 0.48, chest[1] + 0.02, chest[2] + side * 0.4], f.block);
        } else {
          pull(pose, arm[1], [sh[0] + 0.24, sh[1] - 0.14, sh[2] - side * 0.2], f.block);
          pull(pose, arm[2], [chest[0] + 0.42, chest[1] - 0.02, chest[2] + side * 0.1], f.block);
          pull(pose, arm[3], [chest[0] + 0.5, chest[1] + 0.02, chest[2] - side * 0.2], f.block);
        }
      });
    }

    if (f.mode === "flip") {
      // Up, tucked, round and down. "side": an aerial, turning about the
      // forward axis and moving sideways out of the disc's line; "twist": a
      // butterfly twist, body tipped nearly flat and spinning about the
      // vertical; "back": a backflip.
      var u = Math.min(1, f.mt / flipTime), s = Math.sin(Math.PI * u), e = ease(u);
      var pv = jp(pose, 0), ch = jp(pose, 9);
      [2, 3, 4, 6, 7, 8].forEach(function (k) { pull(pose, k, pv, (f.flip === "twist" ? 0.25 : 0.5) * s); });
      [13, 14, 15, 17, 18, 19].forEach(function (k) { pull(pose, k, ch, 0.35 * s); });
      var py = pv[1] + 0.1, lift = (f.flip === "twist" ? 1.1 : 1.35) * s;
      for (var q = 0; q < 20; q++) {
        var x = pose[q * 3] - pv[0], y = pose[q * 3 + 1] - py, z = pose[q * 3 + 2] - pv[2], t;
        if (f.flip === "back") {
          var a1 = 2 * Math.PI * e;
          t = x * Math.cos(a1) - y * Math.sin(a1); y = x * Math.sin(a1) + y * Math.cos(a1); x = t;
        } else if (f.flip === "side") {
          var a2 = 2 * Math.PI * e * f.flipSide;
          t = y * Math.cos(a2) - z * Math.sin(a2); z = y * Math.sin(a2) + z * Math.cos(a2); y = t;
        } else {
          var tilt = 1.35 * s, a3 = 2 * Math.PI * e;
          t = y * Math.cos(tilt) - z * Math.sin(tilt); z = y * Math.sin(tilt) + z * Math.cos(tilt); y = t;
          t = x * Math.cos(a3) + z * Math.sin(a3); z = -x * Math.sin(a3) + z * Math.cos(a3); x = t;
        }
        pose[q * 3] = pv[0] + x;
        pose[q * 3 + 1] = py + y + lift;
        pose[q * 3 + 2] = pv[2] + z;
      }
      if (u >= 1) setMode(p, "stand");
    }

    if (f.mode === "evade" || f.mode === "hit") {
      // Blend towards the dodge (or the knock-back) and out again.
      var kind = f.mode === "hit" ? "hit" : f.evade;
      var span = evadeTime[kind] * (kind === "hit" && f.champion ? CHAMP.stun : 1);
      var eu = Math.min(1, f.mt / span);
      var ew = eu < 0.2 ? ease(eu / 0.2) : eu > 0.75 ? ease((1 - eu) / 0.25) : 1;
      var tg = evadePose(kind, pose, eu);
      for (var e2 = 0; e2 < pose.length; e2++) pose[e2] += (tg[e2] - pose[e2]) * ew;
      if (kind === "split") {
        var jump = 0.9 * Math.sin(Math.PI * eu);
        for (var jy = 0; jy < 20; jy++) pose[jy * 3 + 1] += jump;
      }
      if (eu >= 1) setMode(p, "stand");
    }

    if (f.mode === "drop" || f.mode === "cling" || f.mode === "fall" || f.mode === "climb") {
      // Hanging by both hands from the ring edge, legs loose; a climb lets
      // go of the pose as it comes up over the edge.
      var hw = f.mode === "climb" ? 1 - ease(Math.min(1, f.mt / 0.6)) : 1;
      [[12, 13, 14, 15], [16, 17, 18, 19]].forEach(function (arm) {
        var s0 = jp(pose, arm[0]);
        pull(pose, arm[1], [s0[0] + 0.04, s0[1] + 0.27, s0[2]], hw);
        pull(pose, arm[2], [s0[0] + 0.06, s0[1] + 0.52, s0[2]], hw);
        pull(pose, arm[3], [s0[0] + 0.07, s0[1] + 0.62, s0[2]], hw);
      });
    }

    if (f.mode === "bugged") {
      // Grid bugs all over it: swatting at them with both hands, twisting
      // from the hips to shake them off, knees going.
      var wt = wall * 11, pv0 = jp(pose, 0);
      [[12, 13, 14, 15, 0], [16, 17, 18, 19, Math.PI]].forEach(function (arm) {
        var sh = jp(pose, arm[0]), k = Math.sin(wt * 0.7 + arm[4]);
        pull(pose, arm[1], [sh[0] + 0.12, sh[1] - 0.05 + 0.1 * k, sh[2]], 0.7);
        pull(pose, arm[2], [sh[0] + 0.18, sh[1] + 0.08 + 0.22 * k, sh[2] * 0.4], 0.8);
        pull(pose, arm[3], [sh[0] + 0.2, sh[1] + 0.16 + 0.26 * k, sh[2] * 0.15], 0.8);
      });
      var tw = 0.4 * Math.sin(wt), ct = Math.cos(tw), st = Math.sin(tw);
      for (var bj = 9; bj < 20; bj++) {
        var bx = pose[bj * 3] - pv0[0], bz = pose[bj * 3 + 2] - pv0[2];
        pose[bj * 3] = pv0[0] + bx * ct - bz * st;
        pose[bj * 3 + 2] = pv0[2] + bx * st + bz * ct;
      }
      var sag = 0.05 * Math.abs(Math.sin(wt * 0.5));
      for (var bk = 0; bk < 20; bk++) if (bk !== 3 && bk !== 4 && bk !== 7 && bk !== 8) pose[bk * 3 + 1] -= sag;
    }

    f.pose = pose;
    return pose;
  }

  // Full-extent poses for the dodges in place and for being hit, around
  // where the fighter stands (local frame: facing +x, +z its right).
  function evadePose(kind, pose, u) {
    var px = pose[0], pz = pose[2];
    var rs = (pose[16 * 3 + 2] - pose[12 * 3 + 2]) >= 0 ? 1 : -1;
    function P(x, y, z) { return [px + x, y, pz + z * rs]; }
    var J;
    if (kind === "duck") {                            // a deep crouch, head down
      J = [P(0, 0.55, 0), P(0, 0.55, -0.1), P(0.4, 0.6, -0.18), P(0.05, 0.08, -0.2), P(0.2, 0, -0.22),
           P(0, 0.55, 0.1), P(0.35, 0.55, 0.18), P(0, 0.08, 0.2), P(0.15, 0, 0.22),
           P(0.3, 0.95, 0), P(0.4, 1.05, 0), P(0.55, 1.2, 0),
           P(0.3, 0.98, -0.18), P(0.45, 0.75, -0.25), P(0.55, 0.55, -0.2), P(0.6, 0.5, -0.18),
           P(0.3, 0.98, 0.18), P(0.45, 0.75, 0.25), P(0.55, 0.55, 0.2), P(0.6, 0.5, 0.18)];
    } else if (kind === "sweep") {                    // low on the hands, one leg sweeping round
      var th = 2 * Math.PI * ease(u), dx = Math.cos(th), dz = Math.sin(th);
      J = [P(0, 0.45, 0), P(0, 0.45, -0.1), P(0.3, 0.35, -0.25), P(0, 0.05, -0.35), P(0.12, 0, -0.38),
           P(0, 0.45, 0.1), P(dx * 0.45, 0.2, 0.1 + dz * 0.45), P(dx * 0.9, 0.08, 0.1 + dz * 0.9),
           P(dx * 1.05, 0.08, 0.1 + dz * 1.05),
           P(0.1, 0.85, 0.05), P(0.15, 0.95, 0.05), P(0.22, 1.1, 0.05),
           P(0.1, 0.88, -0.18), P(0.2, 0.55, -0.3), P(0.3, 0.15, -0.35), P(0.35, 0.02, -0.35),
           P(0.1, 0.88, 0.18), P(0.25, 0.55, 0.3), P(0.35, 0.2, 0.35), P(0.4, 0.05, 0.35)];
    } else if (kind === "split") {                    // legs out wide, hands to the toes
      J = [P(0, 1.0, 0), P(0, 1.0, -0.1), P(0.15, 1.0, -0.5), P(0.3, 1.0, -0.9), P(0.38, 1.02, -0.95),
           P(0, 1.0, 0.1), P(0.15, 1.0, 0.5), P(0.3, 1.0, 0.9), P(0.38, 1.02, 0.95),
           P(0.12, 1.45, 0), P(0.15, 1.58, 0), P(0.18, 1.78, 0),
           P(0.12, 1.48, -0.18), P(0.2, 1.3, -0.45), P(0.28, 1.12, -0.7), P(0.32, 1.06, -0.8),
           P(0.12, 1.48, 0.18), P(0.2, 1.3, 0.45), P(0.28, 1.12, 0.7), P(0.32, 1.06, 0.8)];
    } else {                                          // hit: thrown back, arms flung wide
      J = [P(-0.12, 0.92, 0), P(-0.12, 0.92, -0.1), P(0.05, 0.5, -0.14), P(0.1, 0.08, -0.16), P(0.25, 0, -0.17),
           P(-0.12, 0.92, 0.1), P(-0.05, 0.5, 0.14), P(-0.1, 0.08, 0.16), P(0.05, 0, 0.17),
           P(-0.35, 1.35, 0), P(-0.42, 1.45, 0), P(-0.5, 1.62, 0),
           P(-0.35, 1.38, -0.2), P(-0.3, 1.55, -0.45), P(-0.15, 1.6, -0.65), P(-0.1, 1.6, -0.72),
           P(-0.35, 1.38, 0.2), P(-0.3, 1.55, 0.45), P(-0.15, 1.6, 0.65), P(-0.1, 1.6, 0.72)];
    }
    var out = [];
    J.forEach(function (j) { out.push(j[0], j[1], j[2]); });
    return out;
  }

  // ── Positions on the rings ────────────────────────────────────────────
  function ringMid(k) { return k === 0 ? 0 : (ringRadii[k][0] + ringRadii[k][1]) / 2; }
  function groundAt(p, r, a) {
    var pd = pads[fs[p].pad];
    return [pd.cx + Math.cos(a) * r, pd.cz + Math.sin(a) * r];
  }
  function intactRingsOn(padIdx) {
    var out = [];
    for (var k = 0; k < ringCount; k++) if (ringUp(padIdx, k)) out.push(k);
    return out;
  }
  function intactRings(p) { return intactRingsOn(fs[p].pad); }

  // A platform with nobody standing on it. A fighter commits to a platform
  // the moment it starts moving, so two cannot claim the same one.
  function occupied(padIdx) {
    for (var i = 0; i < fs.length; i++)
      if (alive(i) && fs[i].pad === padIdx) return true;
    return false;
  }
  // Its own side's platforms next to this one in the rank, standing empty.
  // One is empty because the teammate who had it is out of the round.
  function freeNeighbours(p) {
    var here = pads[fs[p].pad], out = [];
    for (var i = 0; i < pads.length; i++) {
      if (pads[i].team !== here.team) continue;
      if (Math.abs(pads[i].rank - here.rank) !== 1) continue;
      if (occupied(i) || !intactRingsOn(i).length) continue;
      out.push(i);
    }
    return out;
  }

  // Move to ring k of platform `padIdx` at angle a over dur fight-seconds,
  // hopping `hop` metres. Crossing to another platform is further than
  // stepping between rings, so it takes longer and goes higher.
  function relocate(p, padIdx, k, a, dur, hop) {
    var f = fs[p], across = padIdx !== f.pad;
    f.pad = padIdx;                       // claimed from here on
    f.ring = k; f.ang = a;
    f.move = { from: f.pos.slice(), to: groundAt(p, ringMid(k), a), t0: now,
               dur: across ? dur * 1.3 : dur, hop: across ? Math.max(hop, 0.6) : hop };
  }

  // Where a dodge can go: the nearest ring still up that is not this one
  // (across a gap if need be; never off the edge), and round a little.
  // Where a dodge can go, as [platform, ring, angle]: the nearest ring still
  // up that is not this one (across a gap if need be, never off the edge) --
  // or, once a teammate is out and its platform stands empty, across to that
  // instead, landing on the side it came from.
  function dodgeSpot(p) {
    var f = fs[p], best = [];
    intactRings(p).forEach(function (k) {
      if (k === f.ring) return;
      var d = Math.abs(k - f.ring);
      if (!best.length || d < best[0][1]) best = [[k, d]];
      else if (d === best[0][1]) best.push([k, d]);
    });
    var across = freeNeighbours(p);
    // The longer jump is the rarer one: it is only taken about a third of the
    // time it is on offer, and always when there is nowhere else to go.
    if (across.length && (!best.length || Math.random() < 0.35)) {
      var n = across[Math.floor(Math.random() * across.length)];
      var up = intactRingsOn(n);
      var here = pads[f.pad], there = pads[n];
      var facing = Math.atan2(here.cz - there.cz, here.cx - there.cx);
      return [n, up[Math.floor(Math.random() * up.length)], facing + rand(-0.5, 0.5)];
    }
    if (!best.length) return null;
    var k = best[Math.floor(Math.random() * best.length)][0];
    return [f.pad, k, f.ang + (Math.random() < 0.5 ? -1 : 1) * rand(0.6, 1.3)];
  }

  function hangOffset(p) { return 0.03 - Math.max(fs[p].pose[15 * 3 + 1], fs[p].pose[19 * 3 + 1]); }

  // Knocked back off the ring edge with nothing behind: grab ring k's edge
  // at radius r, angle a.
  function slideOff(p, k, r, a) {
    var f = fs[p];
    f.move = null;
    f.clingRing = k;
    f.willClimb = Math.random() < climbChance(p);
    f.dropFrom = f.pos.slice();
    f.clingAt = groundAt(p, r, a);
    setMode(p, "drop");
  }

  // Hit: slide back a ring, away from the opponent; with no ring there (or
  // it is gone), slide off this one and hang from its edge.
  function knockBack(p) {
    var f = fs[p], pd = pads[f.pad], rel = [f.pos[0] - pd.cx, f.pos[1] - pd.cz];
    var awayOut = rel[0] * -f.fv[0] + rel[1] * -f.fv[1] >= 0 || f.ring === 0;
    var back = awayOut ? f.ring + 1 : f.ring - 1;
    var a = f.ring === 0 ? Math.atan2(-f.fv[1], -f.fv[0]) : f.ang;
    if (back >= 0 && back < ringCount && ringUp(f.pad, back)) {
      setMode(p, "hit");
      relocate(p, f.pad, back, a, 0.45, 0.05);
    } else {
      slideOff(p, f.ring, awayOut ? ringRadii[f.ring][1] : ringRadii[f.ring][0], a);
    }
  }

  function drop(p) {
    var f = fs[p], near = null;
    intactRings(p).forEach(function (k) {
      if (near === null || Math.abs(k - f.ring) < Math.abs(near - f.ring)) near = k;
    });
    f.move = null;
    if (near === null) { setMode(p, "fall"); return false; }
    var edge = near < f.ring ? ringRadii[near][1] : ringRadii[near][0];
    f.clingRing = near;
    f.willClimb = Math.random() < climbChance(p);        // and better at it with practice
    f.dropFrom = f.pos.slice();
    f.clingAt = groundAt(p, edge, f.ring === 0 ? rand(0.5, 2.6) : f.ang);
    setMode(p, "drop");
    return true;
  }

  function updateMode(p) {
    var f = fs[p];
    // Facing: always towards the opponent.
    if (f.foe < 0 || !alive(f.foe)) f.foe = nearestFoe(p);
    var o = fs[f.foe >= 0 ? f.foe : p].pos;
    var dx = o[0] - f.pos[0], dz = o[1] - f.pos[1], l = Math.sqrt(dx * dx + dz * dz) || 1;
    if (l < 1e-6) { dx = f.team === 0 ? 1 : -1; dz = 0; l = 1; }
    f.fv = [dx / l, dz / l];
    var hopY = 0;
    if (f.move) {
      var u = Math.min(1, (now - f.move.t0) / f.move.dur);
      f.pos = [f.move.from[0] + (f.move.to[0] - f.move.from[0]) * ease(u),
               f.move.from[1] + (f.move.to[1] - f.move.from[1]) * ease(u)];
      hopY = f.move.hop * Math.sin(Math.PI * u);
      if (u >= 1) f.move = null;
    }
    if (f.mode === "drop") {
      var v = Math.min(1, f.mt / 0.35);
      f.yOff = hangOffset(p) * ease(v);
      f.pos = [f.dropFrom[0] + (f.clingAt[0] - f.dropFrom[0]) * ease(v),
               f.dropFrom[1] + (f.clingAt[1] - f.dropFrom[1]) * ease(v)];
      if (v >= 1) setMode(p, "cling");
    } else if (f.mode === "cling") {
      f.yOff = hangOffset(p) + 0.03 * Math.sin(wall * 2.4);
      if (f.willClimb && f.mt > 0.8) setMode(p, "climb");
      else if (f.mt > 14) {
        // Nobody came to finish it off. Hanging there for the rest of the
        // round is neither much to watch nor survivable: with a ring still
        // under it, it hauls itself up; without one, its grip goes. A round
        // ends when a side is cleared, so this is also what stops two last
        // fighters hanging opposite each other with nobody able to act.
        if (ringUp(f.pad, f.clingRing)) { f.willClimb = true; setMode(p, "climb"); }
        else { setMode(p, "fall"); eliminated(p, 0.9); }   // owns no exchange to pass on
      }
    } else if (f.mode === "climb") {
      // Up and over the edge, onto the ring it was holding.
      var pc = pads[f.pad];
      var c = Math.min(1, f.mt / 0.6), top = groundAt(p, ringMid(f.clingRing), Math.atan2(f.clingAt[1] - pc.cz, f.clingAt[0] - pc.cx));
      f.yOff = hangOffset(p) * (1 - ease(c)) + 0.25 * Math.sin(Math.PI * c);
      f.pos = [f.clingAt[0] + (top[0] - f.clingAt[0]) * ease(c), f.clingAt[1] + (top[1] - f.clingAt[1]) * ease(c)];
      if (c >= 1) {
        learnPair(f, "climb", 0, 0);               // it has got back up before
        f.ring = f.clingRing;
        f.ang = Math.atan2(f.clingAt[1] - pc.cz, f.clingAt[0] - pc.cx);
        f.clingRing = -1;
        f.willClimb = false;
        setMode(p, "stand");
      }
    } else if (f.mode === "fall") {
      f.yOff = Math.min(0, hangOffset(p)) - 4.9 * f.mt * f.mt;
      f.alpha = Math.max(0, 1 - f.mt / 0.9);
      if (f.mt > 0.9) { spark([f.pos[0], f.yOff + 1, f.pos[1]], "#ffffff"); setMode(p, "gone"); }
    } else if (f.mode === "bugged") {
      f.yOff = 0; f.alpha = 1;
      if (f.mt >= BUG_HOLD) setMode(p, "stand");    // shaken off at last
    } else if (f.mode === "rez") {
      f.yOff = 0;
      f.alpha = Math.min(1, f.mt / 0.8);
      if (f.mt >= 0.8) setMode(p, "stand");
    } else if (f.mode === "stand" || f.mode === "flip" || f.mode === "evade" || f.mode === "hit") {
      f.yOff = hopY; f.alpha = 1;
    }
  }

  // Local pose (facing +x) to the world: placed at the fighter's spot and
  // turned to face the opponent.
  function toWorld(p, local, j) {
    var f = fs[p], lx = local[j * 3], lz = local[j * 3 + 2];
    return [f.pos[0] + f.fv[0] * lx - f.fv[1] * lz, local[j * 3 + 1] + f.yOff, f.pos[1] + f.fv[1] * lx + f.fv[0] * lz];
  }
  function ahead(p, w, d) { return [w[0] + fs[p].fv[0] * d, w[1], w[2] + fs[p].fv[1] * d]; }
  function canAct(p) { return fs[p].mode === "stand"; }

  // ── Discs ─────────────────────────────────────────────────────────────
  // state: "back" (on the fighter's back), "hand", "shield", or "flight".
  var trailLen = 16;

  function handWorld(p) { return toWorld(p, fs[p].pose, 19); }
  function chestWorld(p) { return toWorld(p, fs[p].pose, 9); }
  function backWorld(p) {
    var c = chestWorld(p);
    var b = ahead(p, c, -0.16);
    return [b[0], c[1] - 0.12, b[2]];
  }
  // Where the shield is: in the gripping hand, or between both hands.
  function shieldWorld(p) {
    var f = fs[p];
    var h = f.grip === "both" ? lerp3(toWorld(p, f.pose, 15), toWorld(p, f.pose, 19), 0.5)
          : f.grip === "left" ? toWorld(p, f.pose, 15) : handWorld(p);
    return f.high ? [h[0], h[1] + 0.08, h[2]] : ahead(p, h, 0.1);
  }
  function discHome(p) { return ds[p].state !== "flight" && ds[p].state !== "broken"; }
  // A second disc, for a fighter wielding two: usable if it is not in the
  // air and not broken.
  function spareReady(p) {
    var sp = fs[p].spare;
    return !!sp && sp.state !== "flight" && sp.state !== "broken";
  }
  function discReady(p) { return discHome(p) || spareReady(p); }
  // Put a disc in the throwing hand if there is one to be had: the one
  // already there, or the spare swapped in for one that is still out.
  function arm(p) {
    if (discHome(p)) return true;
    if (!spareReady(p)) return false;
    var out = ds[p];
    ds[p] = fs[p].spare;
    fs[p].spare = out;
    return true;
  }

  // Which tom a carom gets. A disc falls through the kit as it travels: the
  // first thing it hits is the high tom, the second -- or a shield turning
  // it away -- the middle one, and everything after that, including its
  // arrival back in the hand that threw it, the low one. So a throw that
  // goes off a wall, past its target, off the glass and home comes out as a
  // descending fill, and the ear can follow the disc without watching it.
  var TOM_HI = 2, TOM_MID = 1, TOM_LOW = 0;
  function bounced(p, disc) {
    var d = disc || ds[p];
    d.bounces = (d.bounces || 0) + 1;
    return d.bounces === 1 ? TOM_HI : d.bounces === 2 ? TOM_MID : TOM_LOW;
  }

  // The path of a throw, as control points for fly(). Straight at somebody
  // it is one arc; off a side wall it is two, out to the glass and back in
  // at an angle. Either wall serves -- the one across the arena, or the one
  // between the fighters and whoever is watching, which is not drawn but is
  // just as hard.
  function arc(from, to, lift, viaZ) {
    if (viaZ == null) {
      var m = lerp3(from, to, 0.5);
      return [from, [m[0], m[1] + lift, m[2] + rand(-0.6, 0.6)], to];
    }
    var turn = lerp3(from, to, 0.42);
    var w = [turn[0], turn[1] + lift * 0.4, viaZ];
    return [from, lerp3(from, w, 0.5), w, lerp3(w, to, 0.5), to];
  }
  // The path of a launched hand: a lightning bolt, jagging left and right
  // and up and down on its way to the target. Each control point sits
  // halfway along its leg, so every leg is straight and every turn a corner.
  function bolt(from, to) {
    var d = sub(to, from), side = norm([-d[2], 0, d[0]]), legs = 7, pts = [from], prev = from;
    for (var i = 1; i <= legs; i++) {
      var v = lerp3(from, to, i / legs);
      if (i < legs) {
        var k = (i % 2 ? 1 : -1) * rand(0.35, 0.8);
        v = [v[0] + side[0] * k, v[1] + rand(-0.35, 0.35), v[2] + side[2] * k];
      }
      pts.push(lerp3(prev, v, 0.5), v);
      prev = v;
    }
    return pts;
  }
  var ARM_SLOW = 2;                                // a hand takes twice as long as a disc

  // Which wall a throw might go off, or null for straight at them.
  function pickWall() {
    return (Math.random() < 0.5 ? -1 : 1) * (arenaZ - 0.35);
  }

  // A flight: quadratic Beziers through control points; a point may be a
  // function, so a disc flying home follows its owner's moving hand.
  // `d` is which disc. A fighter wielding two has one in the air while it
  // throws the other, so a flight cannot find its disc by asking whose it
  // is -- it is handed the disc when it is thrown and keeps hold of it.
  function fly(p, pts, dur, done, d) {
    d = d || ds[p];
    d.state = "flight";
    if (!d.arm) d.trail = [];                      // a launched hand keeps the wall it has laid
    d.flight = { pts: pts, t0: now, dur: dur, done: done };
  }
  function flightPoint(fl, t) {
    var pts = fl.pts.map(function (q) { return typeof q === "function" ? q() : q; });
    var n = (pts.length - 1) / 2, i = Math.min(n - 1, Math.floor(t * n)), u = t * n - i;
    var a = pts[2 * i], c = pts[2 * i + 1], b = pts[2 * i + 2];
    return lerp3(lerp3(a, c, u), lerp3(c, b, u), u);
  }

  var sparkNext = 0;
  var sparkData = [null, null, null, null];
  function spark(w, col) {
    sparkData[sparkNext] = { w: w, born: wall, col: col };
    sparkNext = (sparkNext + 1) % 4;
  }

  // ── Derez debris ──────────────────────────────────────────────────────
  var pieceCount = 100;              // per fighter
  var pieceCap = 320;                // across the arena, however many derez at once
  var pieces = [];

  // Break fighter p into pieces: each limb into six, the head into four.
  function shatter(p) {
    var f = fs[p], Wp = [];
    for (var j = 0; j < 20; j++) Wp.push(toWorld(p, f.pose, j));
    var centre = lerp3(Wp[0], Wp[9], 0.5), col = fs[p].team === 0 ? programHi : sentinelHi;
    var out = [];
    function piece(a, b, thick) {
      var mid = lerp3(a, b, 0.5), half = [(b[0] - a[0]) * 0.45, (b[1] - a[1]) * 0.45, (b[2] - a[2]) * 0.45];
      var dir = norm(sub(mid, centre)), k = rand(0.6, 2.2);
      out.push({ mid: mid, half: half, thick: thick, col: col, born: wall, who: p,
                 vel: [dir[0] * k + rand(-0.5, 0.5), rand(0.8, 2.8), dir[2] * k + rand(-0.5, 0.5)],
                 axis: norm([rand(-1, 1), rand(-1, 1), rand(-1, 1)]), spin: rand(-9, 9) });
    }
    limbs.forEach(function (lb) {
      for (var i = 0; i < 6; i++) piece(lerp3(Wp[lb[0]], Wp[lb[1]], i / 6), lerp3(Wp[lb[0]], Wp[lb[1]], (i + 1) / 6), lb[2]);
    });
    var hc = lerp3(Wp[10], Wp[11], 0.55);
    for (var h = 0; h < 4; h++) {
      var a0 = h * Math.PI / 2, a1 = a0 + Math.PI / 2;
      piece([hc[0] + Math.cos(a0) * 0.12, hc[1] + Math.sin(a0) * 0.13, hc[2]],
            [hc[0] + Math.cos(a1) * 0.12, hc[1] + Math.sin(a1) * 0.13, hc[2]], 0.05);
    }
    // Two fighters can go at once in a team match, so clouds stack up rather
    // than replacing each other; the oldest go if there are too many.
    pieces = pieces.concat(out);
    if (pieces.length > pieceCap) pieces = pieces.slice(pieces.length - pieceCap);
  }

  // Fly apart: each [a, b] a shard, thrown out from `at` and tumbling down
  // with the rest of the debris.
  function burst(segs, col, at, speed, thick) {
    segs.forEach(function (sg) {
      var mid = lerp3(sg[0], sg[1], 0.5);
      var half = [(sg[1][0] - sg[0][0]) * 0.5, (sg[1][1] - sg[0][1]) * 0.5, (sg[1][2] - sg[0][2]) * 0.5];
      var dir = norm(sub(mid, at)), k = rand(speed * 0.5, speed);
      pieces.push({ mid: mid, half: half, thick: thick || 0.035, col: col, born: wall,
                    vel: [dir[0] * k + rand(-0.4, 0.4), dir[1] * k * 0.5 + rand(0.6, 2.4), dir[2] * k + rand(-0.4, 0.4)],
                    axis: norm([rand(-1, 1), rand(-1, 1), rand(-1, 1)]), spin: rand(-14, 14) });
    });
    if (pieces.length > pieceCap) pieces = pieces.slice(pieces.length - pieceCap);
  }
  // A disc shattering: its rim in fourteen pieces and its bright core in
  // six, flung out from where it broke.
  function shatterDisc(at, col, core) {
    var r = rand(0, Math.PI), u = [Math.cos(r), 0, Math.sin(r)];
    var v = norm([-Math.sin(r) * 0.5, 0.86, Math.cos(r) * 0.5]);
    function ring(rad, n) {
      var out = [];
      for (var i = 0; i < n; i++) {
        var a0 = 2 * Math.PI * i / n, a1 = 2 * Math.PI * (i + 0.8) / n;
        out.push([0, 1].map(function (j) {
          var a = j ? a1 : a0, c = Math.cos(a) * rad, s = Math.sin(a) * rad;
          return [at[0] + u[0] * c + v[0] * s, at[1] + u[1] * c + v[1] * s, at[2] + u[2] * c + v[2] * s];
        }));
      }
      return out;
    }
    burst(ring(0.3, 14), col, at, 3.2, 0.04);
    burst(ring(0.15, 6), core, at, 2.2, 0.03);
  }

  // Rotate v about unit axis k by angle t (Rodrigues).
  function turn(v, k, t) {
    var c = Math.cos(t), s = Math.sin(t), d = dot(k, v), x = cross(k, v);
    return [v[0] * c + x[0] * s + k[0] * d * (1 - c), v[1] * c + x[1] * s + k[1] * d * (1 - c),
            v[2] * c + x[2] * s + k[2] * d * (1 - c)];
  }

  // Tumble the pieces down to the arena floor, bounce, settle and fade.
  function stepPieces(dt) {
    var live = [];
    for (var i = 0; i < pieces.length; i++) {
      var pc = pieces[i];
      var fade = wall - pc.born < 2.2 ? 1 : Math.max(0, 1 - (wall - pc.born - 2.2) / 1.0);
      if (fade <= 0) continue;          // burnt out: drop it
      live.push(pc);
      pc.vel[1] -= 9.8 * dt;
      pc.mid = [pc.mid[0] + pc.vel[0] * dt, pc.mid[1] + pc.vel[1] * dt, pc.mid[2] + pc.vel[2] * dt];
      pc.half = turn(pc.half, pc.axis, pc.spin * dt);
      if (pc.mid[1] < floorY + 0.02) {
        // Hit the floor: bounce low, lose speed, and lie flatter.
        pc.mid[1] = floorY + 0.02;
        pc.vel = [pc.vel[0] * 0.5, -pc.vel[1] * 0.25, pc.vel[2] * 0.5];
        pc.spin *= 0.5;
        pc.half = [pc.half[0], pc.half[1] * 0.4, pc.half[2]];
      }
      var a = project(sub(pc.mid, pc.half));
      var b = project([pc.mid[0] + pc.half[0], pc.mid[1] + pc.half[1], pc.mid[2] + pc.half[2]]);
      seg(1000 - (a[2] + b[2]) * 10, a, b, Math.max(1.5, 0.5 * pc.thick * cam.F / a[2]), pc.col, fade, "round");
    }
    pieces = live;
  }

  // ── What has worked before ────────────────────────────────────────────
  // When a fighter kills, the throw that did it and the throw before it are
  // kept together as a pair. From then on it will sometimes open with the
  // first of them and follow with the second, which is the nearest thing
  // here to remembering how something was done rather than what tends to
  // work. Only a champion keeps its pairs; everybody else starts empty, so
  // a long reign is a fighter carrying more and more of what it has already
  // got away with -- which is what gives a champion a reason to last.
  // A pair gets a name when it is first got away with, so a palette reads as
  // a list of things a fighter knows how to do rather than a table of
  // numbers. Verb and animal, drawn without repeating inside one palette.
  var VERBS = ["LEAPING", "STRIKING", "CIRCLING", "DIVING", "STALKING",
               "COILING", "SWOOPING", "LUNGING", "RISING", "TURNING",
               "BREAKING", "CUTTING", "DRIFTING", "VAULTING", "SNARING",
               "HUNTING", "FALLING", "CLOSING"];
  var BEASTS = ["FOX", "HERON", "ADDER", "LYNX", "RAVEN", "HARE", "MANTIS",
                "FALCON", "OTTER", "STOAT", "KITE", "SHRIKE", "PIKE", "WOLF",
                "CRANE", "MARTEN", "VIPER", "OSPREY", "BADGER", "EEL"];

  function comboName(had) {
    for (var tries = 0; tries < 60; tries++) {
      var n = VERBS[Math.floor(Math.random() * VERBS.length)] + " " +
              BEASTS[Math.floor(Math.random() * BEASTS.length)];
      var clash = false;
      for (var i = 0; i < had.length; i++) if (had[i].name === n) { clash = true; break; }
      if (!clash) return n;
    }
    return "UNNAMED";
  }

  var COMBO_MAX = 9;                 // moves kept; the least used goes first
  var COMBO_USE = 0.5;               // how often it reaches for one it has

  // Knowing which move to make is not the same as being good at it. A pair
  // that has come off before comes off more easily the next time: the throw
  // it calls for lands more often, and a finish it has done before is thrown
  // without hesitating, which leaves less of a window to climb out of. The
  // gain flattens off, so the tenth repetition is worth much less than the
  // second and nobody becomes untouchable.
  function edge(used, cap) {
    if (!used || used < 1) return 0;
    return cap * (1 - 1 / (1 + (used - 1) * 0.55));
  }
  function practisedAt(f, trig) {
    var best = null;
    for (var i = 0; i < f.combos.length; i++)
      if (f.combos[i].trig === trig && (!best || f.combos[i].used > best.used)) best = f.combos[i];
    return best;
  }
  // The same, but only entries answering a particular thing -- the aim a
  // save was made against, say.
  function practisedFor(f, trig, from) {
    var best = null;
    for (var i = 0; i < f.combos.length; i++)
      if (f.combos[i].trig === trig && f.combos[i].from === from &&
          (!best || f.combos[i].used > best.used)) best = f.combos[i];
    return best;
  }
  // How likely a fighter is to haul itself back over the edge. A third of
  // the time to begin with, and better the more often it has managed it.
  function climbChance(p) {
    var k = practisedAt(fs[p], "climb");
    return 0.33 + edge(k && k.used, 0.30);
  }

  // A kill teaches two things, and the more useful of them is the defensive
  // one. "I ducked, and then I killed with a low throw" is a counter: it is
  // keyed on a situation, so it comes back out when that situation does. "I
  // threw high, then killed with a body shot" is a press: an opening and its
  // follow-up, which has to be started on purpose. Both are kept; the
  // counter is reached for first.
  function learnPair(f, trig, from, b) {
    if (trig !== "finish" && trig !== "climb" && trig !== "catch" &&
        (from < 0 || b < 0)) return;
    for (var i = 0; i < f.combos.length; i++) {
      if (f.combos[i].trig === trig && f.combos[i].from === from && f.combos[i].b === b) {
        f.combos[i].used++;                        // seen it work again
        return;
      }
    }
    f.combos.push({ trig: trig, from: from, b: b, used: 1, name: comboName(f.combos) });
    while (f.combos.length > COMBO_MAX) {
      var worst = 0;
      for (var k = 1; k < f.combos.length; k++)
        if (f.combos[k].used < f.combos[worst].used) worst = k;
      f.combos.splice(worst, 1);
    }
  }

  // A move learned by somebody else, taken into f's palette: counted in if
  // f already knows it, added under its own name if not, and the palette
  // trimmed back to the moves used most.
  function learnPairFrom(f, cb) {
    // A move it was handed by this same champion only brings back the uses
    // made of it since; the rest the champion already counted.
    var fresh = cb.used - (cb.inherited || 0);
    for (var i = 0; i < f.combos.length; i++) {
      var c = f.combos[i];
      if (c.trig === cb.trig && c.from === cb.from && c.b === cb.b) {
        if (fresh > 0) c.used += fresh;
        return;
      }
    }
    if (fresh <= 0) return;
    var clash = f.combos.some(function (c) { return c.name === cb.name; });
    f.combos.push({ trig: cb.trig, from: cb.from, b: cb.b, used: fresh,
                    name: clash ? comboName(f.combos) : cb.name });
    while (f.combos.length > COMBO_MAX) {
      var worst = 0;
      for (var k = 1; k < f.combos.length; k++)
        if (f.combos[k].used < f.combos[worst].used) worst = k;
      f.combos.splice(worst, 1);
    }
  }

  function rememberKill(p) {
    var f = fs[p];
    learnPair(f, "guard", f.lastGuard, f.lastThrowAim);   // what it answered, then took
    learnPair(f, "aim", f.prevAim, f.lastThrowAim);       // what it opened with, then took
  }

  // The aim a pair calls for, or -1 to let the policy choose.
  function comboAim(att, def) {
    var f = fs[att];
    f.practised = null;
    if (f.plan && f.plan.foe === def) {            // finish what was started
      var b = f.plan.b;
      f.practised = f.plan.of || null;
      f.plan = null;
      return b;
    }
    f.plan = null;

    // A counter first: if it has one for the guard it just had to use, that
    // situation has come round again and this is what it did last time.
    if (f.lastGuard >= 0) {
      var hits = [];
      for (var i = 0; i < f.combos.length; i++)
        if (f.combos[i].trig === "guard" && f.combos[i].from === f.lastGuard) hits.push(f.combos[i]);
      if (hits.length && Math.random() < COMBO_USE) {
        var c = hits[Math.floor(Math.random() * hits.length)];
        f.practised = c;                           // this throw is one it knows
        return c.b;
      }
    }

    // Otherwise it may open a press, which it has to start itself and so is
    // the more readable of the two. Reached for less often for that reason.
    var press = [];
    for (var k = 0; k < f.combos.length; k++)
      if (f.combos[k].trig === "aim") press.push(f.combos[k]);
    if (press.length && Math.random() < COMBO_USE * 0.5) {
      var q = press[Math.floor(Math.random() * press.length)];
      f.plan = { foe: def, b: q.b, of: q };
      f.practised = q;
      return q.from;
    }
    return -1;
  }

  // ── Reading the throw ─────────────────────────────────────────────────
  // A throw is aimed high, at the body or low, and each guard answers one
  // of the three: duck a high one, block a body one on the disc, jump a low
  // one. So neither side has a move worth settling on, and the only edge to
  // be had is in reading the other -- which is what the two policies in
  // learn.js are for. Without that file this falls back to choosing at
  // random, which is the game played blind, and still plays.
  var NFEAT = 12;
  var brains = null;
  var HEIGHT = [1.55, 1.12, 0.45];       // where a high, body or low throw passes
  var CONNECT = 0.2;                     // a throw that gets through still has to land

  // What a champion has that the others do not. Memory turned out to be no
  // help at staying alive -- four versions of it measured flat -- because
  // everything it improved was about attacking, and a reign ends when the
  // champion is killed. These are all about not being killed instead.
  var CHAMP = {
    tough: 0.65,        // a throw that gets past its guard lands less often
    spared: true,       // the first hit that would break it up only knocks it back
    rings: 0.5,         // its broken rings come back in half the time
    stun: 0.65          // and it is reeling for less of it afterwards
  };

  // Dopamine, in the three sizes asked for: a success, a knockout or kill,
  // a round. Everything about how a fly takes it is in flybrain.js.
  function reward(p, kind) {
    if (p == null || p < 0 || !fs[p] || !fs[p].brain) return;
    fs[p].brain.burst(kind);
    emit("dopamine", { team: fs[p].team, name: fs[p].name, kind: kind });
  }

  // What a fly smells of an exchange. Facts, not numbers: each one lights
  // its own few glomeruli. The attacker smells the defender's last answers,
  // the tell it has to read; the defender smells the attacker's last
  // throws, the habit it has to read.
  function attackerSmells(att, def) {
    var a = fs[att], d = fs[def];
    return ["foe-disc-" + (discHome(def) ? "home" : "away"),
            "foe-ring-" + d.ring, "my-ring-" + a.ring,
            "foe-guarded-" + d.lastGuard, "foe-was-aimed-" + d.lastAim,
            "my-last-throw-" + a.lastThrowAim,
            "odds-" + Math.sign(liveCount(a.team) - liveCount(d.team))];
  }
  function defenderSmells(att, def) {
    var a = fs[att], d = fs[def];
    return ["my-disc-" + (discHome(def) ? "home" : "away"),
            "my-ring-" + d.ring, "foe-ring-" + a.ring,
            "foe-threw-" + a.lastThrowAim, "foe-threw-before-" + a.prevAim,
            "my-last-guard-" + d.lastGuard,
            "odds-" + Math.sign(liveCount(d.team) - liveCount(a.team))];
  }

  function startBrains() {
    if (flies()) { brains = null; return; }        // one fly each instead
    brains = (window.DiscWarsLearn)
      ? [new window.DiscWarsLearn.Side(NFEAT, 16), new window.DiscWarsLearn.Side(NFEAT, 16)]
      : null;
  }

  // What both policies see: the shape of this exchange, and what this
  // defender did the last time it was thrown at -- the tell an attacker has
  // to read, and the habit a defender has to avoid falling into.
  function situation(att, def) {
    var a = fs[att], d = fs[def];
    return [
      1,
      discHome(def) ? 1 : 0,
      d.ring / (ringCount - 1),
      a.ring / (ringCount - 1),
      d.lastAim === 0 ? 1 : 0, d.lastAim === 1 ? 1 : 0, d.lastAim === 2 ? 1 : 0,
      d.lastGuard === 0 ? 1 : 0, d.lastGuard === 1 ? 1 : 0, d.lastGuard === 2 ? 1 : 0,
      (liveCount(a.team) - liveCount(d.team)) / teamSize,
      teamSize / 3
    ];
  }

  function readThrow(att, def, canBlock) {
    var forced = comboAim(att, def);               // a pair it is trying again
    var d;
    if (flies() && fs[att].brain && fs[def].brain) {
      // Each fly decides for itself, from what it smells of the exchange.
      var A = fs[att].brain.decide("aim", attackerSmells(att, def), null);
      var G = fs[def].brain.decide("guard", defenderSmells(att, def), [true, canBlock, true]);
      // A remembered combination overrides the fly; the fly still made the
      // move, and learns from how it went as if it had chosen it.
      if (forced >= 0) fs[att].brain.override(A, forced);
      d = { aim: A.move, guard: G.move, through: G.move !== A.move };
      // A success is getting it past the guard, or having the guard that
      // covers it. Scored straight away, against what each fly expects.
      fs[att].brain.outcome(A, d.through);
      fs[def].brain.outcome(G, !d.through);
      emit("decide", { att: fs[att].name, def: fs[def].name, through: d.through });
      fs[def].lastAim = d.aim;
      fs[def].lastGuard = d.guard;
    } else if (!brains) {
      var aim = forced >= 0 ? forced : Math.floor(Math.random() * 3);
      var guards = canBlock ? [0, 1, 2] : [0, 2];
      var guard = guards[Math.floor(Math.random() * guards.length)];
      d = { aim: aim, guard: guard, through: guard !== aim };
    } else {
      var x = situation(att, def);
      d = window.DiscWarsLearn.decide(brains[fs[att].team], brains[fs[def].team], x, canBlock);
      if (forced >= 0) {
        d.aim = forced;
        d.through = d.guard !== d.aim;
      }
      // Learns from the throw actually made, whether the policy chose it or
      // a pair did: a pair that keeps working teaches the policy as well.
      window.DiscWarsLearn.settle(brains[fs[att].team], brains[fs[def].team], x, d);
      fs[def].lastAim = d.aim;
      fs[def].lastGuard = d.guard;
    }
    // Both paths end the same way. Keeping this in one place is the whole
    // point: it was in only one of them before, so a body shot from a
    // thinking fighter never recorded where it was aimed -- which left the
    // note it sounded stuck in the middle register whatever it did, and left
    // nothing for a pair to be remembered from.
    fs[att].prevAim = fs[att].lastThrowAim;
    fs[att].lastThrowAim = d.aim;
    return d;
  }

  // ── The duel ──────────────────────────────────────────────────────────
  // Anything listening to the fight -- the sequencer, if it is on. Emitting
  // is guarded so a listener that throws cannot take the fight down with it.
  var listeners = [];
  function emit(kind, info) {
    for (var i = 0; i < listeners.length; i++) {
      try { listeners[i](kind, info); } catch (e) { /* not the fight's problem */ }
    }
  }

  var queue = [];
  function after(delay, fn) { queue.push({ at: now + delay, fn: fn }); }
  // For what waits on something shown at real speed (a fall, a rez).
  var wallQueue = [];
  function afterWall(delay, fn) { wallQueue.push({ at: wall + delay, fn: fn }); }
  function hot(p) { return fs[p].team === 0 ? programHi : sentinelHi; }

  // Back to the hand that threw it. A throw that went off a wall on the way
  // out comes back off one too, which is what makes a wall shot read as a
  // wall shot rather than a funny-looking straight one.
  function flyHome(p, from, viaZ, d) {
    d = d || ds[p];
    var home = function () { return handWorld(p); };
    var land = handWorld(p);
    var pts;
    if (viaZ == null) {
      var mid = lerp3(from, land, 0.5);
      pts = [from, [mid[0], mid[1] + rand(0.4, 1.0), mid[2] + rand(-1.2, 1.2)], home];
    } else {
      var turn = lerp3(from, land, 0.45);
      var w = [turn[0], turn[1] + rand(0.3, 0.8), viaZ];
      pts = [from, lerp3(from, w, 0.5), w, lerp3(w, land, 0.5), home];
      after(rand(0.35, 0.5), function () {
        if (d.state === "flight") { spark(d.pos, "#ffffff"); emit("bounce", { team: fs[p].team, tom: bounced(p, d) }); }
      });
    }
    fly(p, pts, (viaZ == null ? rand(0.8, 1.0) : rand(1.0, 1.25)) * (d.arm ? ARM_SLOW : 1), function () {
      d.state = "hand";
      if (d.arm) { d.arm = false; d.trail = []; }   // the hand is back, and its wall goes
      emit("home", { team: fs[p].team, tom: TOM_LOW });   // back in the hand: the low one
      after(0.3, function () { if (d.state === "hand") d.state = "back"; });
    }, d);
  }

  // Wind up and release; `launch` gets the release point.
  //
  // With the music on, the release waits for the grid. The soundtrack is
  // asked when the first eighth note the wind-up can reach falls, and the
  // fighter holds its stance until it is time to start winding up, so the
  // disc leaves the hand on that eighth and the chord you hear is the throw
  // you see. The wait is never more than an eighth, and it comes before the
  // wind-up rather than in the middle of it -- a held stance reads as
  // somebody choosing their moment, a stalled arm reads as a bug.
  var lastThrow = 0;
  var beatClock = null;            // set by the page when there is music to keep time with
  function throwFrom(p, launch) {
    var wait = 0;
    if (beatClock) {
      var wind = releaseTime() / pace;             // the wind-up, in real seconds
      var due = beatClock(wind, fs[p].team, fs[p].name, !!fs[p].champion);
      if (due > wind) wait = (due - wind) * pace;  // back into fight seconds
    }
    // Spoken for from here until the disc leaves the hand. It looks free the
    // whole time -- standing, disc on its back or in its hand -- and another
    // exchange used to hand it a second throw: a clash picks its partner by
    // exactly that test. The second wind-up then pulled the first disc back
    // to the hand wherever it was, which is a disc vanishing halfway across
    // the gap, and an arm swinging with nothing in it. The wait for the beat
    // made the window wider; it was there before, for the length of a
    // wind-up.
    fs[p].primed = true;
    if (wait <= 0) { windUp(p, launch); return; }
    after(wait, function () {
      if (canAct(p)) { windUp(p, launch); return; }
      fs[p].primed = false;
      ds[p].state = "back";                           // knocked out of it while waiting
      after(0.4, function () { rally(p); });
    });
  }

  function windUp(p, launch) {
    lastThrow = wall;
    ds[p].bounces = 0;                             // a new journey through the kit
    play(p, "throw", throwSpeed);
    after(0.12, function () { ds[p].state = "hand"; });
    after(releaseTime(), function () {
      fs[p].primed = false;                           // let go, or lost it: free again either way
      if (canAct(p)) {
        launch(handWorld(p));                 // a body shot picks its aim in here
        fs[p].stats.throws++;
        emit("throw", { team: fs[p].team, aim: fs[p].lastThrowAim, name: fs[p].name,
                        lead: speaks(p), champion: !!fs[p].champion });
        // Two discs, twice the rate: with the other one in hand it does not
        // wait for this one to come back, it goes again.
        if (fs[p].spare) after(0.35, function () {
          if (alive(p) && canAct(p) && !fs[p].primed && !fs[p].move && discReady(p)) rally(p);
        });
        return;
      }
      ds[p].state = "back";                           // lost its footing mid-throw
      after(0.4, function () { rally(p); });          // the exchange carries on without it
    });
  }

  // Where a banked shot lands on ring k: under the fighter if it stands on
  // it, else somewhere on the side nearer the camera.
  function ringPoint(q, k) {
    var a = k === fs[q].ring ? fs[q].ang : rand(0.35, 2.8);
    var g = groundAt(q, k === 0 ? 0.15 : ringMid(k), a);
    return [g[0], 0, g[1]];
  }

  // Hold the disc up as a shield (overhead, or across the chest) and let
  // it go again a moment after the hit.
  function raiseShield(p, high) {
    if (!canAct(p) || !discHome(p)) return false;
    fs[p].high = high;
    // Half the time both hands; otherwise the left or the right.
    var r = Math.random();
    fs[p].grip = r < 0.5 ? "both" : r < 0.75 ? "left" : "right";
    fs[p].blockTarget = 1;
    ds[p].state = "shield";
    return true;
  }
  function lowerShield(p) {
    after(0.3, function () {
      fs[p].blockTarget = 0;
      if (ds[p].state === "shield") ds[p].state = "back";
    });
  }

  // Bank a throw off the ceiling onto one of the opponent's rings, often
  // the one it stands on. A defender with its disc at home may catch it
  // overhead instead; a clinging one cannot.
  function bankShot(p, q, k, finishing) {
    fs[p].lastThrowAim = 0;                   // off the ceiling: the high register
    // Taking the ring out from under somebody already hanging is its own
    // move, and one that can be got good at: a fighter that has done it
    // before throws without hesitating, and the disc is on its way while the
    // other is still deciding whether it can climb out.
    var skill = finishing ? practisedAt(fs[p], "finish") : null;
    throwFrom(p, function (from) {
      var disc = ds[p];
      var yes = bitCall(p, "yes");                  // the Bit makes it land
      var no = bitCall(q, "no");                    // the Bit stops it
      var grab = practisedAt(fs[q], "catch");
      var caught = !yes && !no && fs[q].mode === "stand" && canAct(q) && arm(q) &&
                   Math.random() < 0.4 + edge(grab && grab.used, 0.25);
      var over = ahead(q, chestWorld(q), 0.15);
      var to = no ? bitWorld(q) : caught ? [over[0], 2.3, over[2]] : ringPoint(q, k);
      var top = [lerp3(from, to, 0.55)[0], ceilY, rand(-1.2, 1.2)];
      var dur = rand(1.15, 1.35) * (1 - edge(skill && skill.used, 0.35));
      if (caught) after(dur - 0.35, function () { if (!raiseShield(q, true)) caught = false; });
      fly(p, [from, lerp3(from, top, 0.5).map(function (v, i) { return i === 1 ? v + 0.6 : v; }), top,
              lerp3(top, to, 0.5), to], dur, function () {
        spark(to, no ? BIT_NO : hot(p));
        if (no) {
          flyHome(p, to, null, disc);
          after(rand(0.3, 0.5), function () { rally(q); });
          return;
        }
        if (caught) {
          learnPair(fs[q], "catch", 0, 0);         // it has taken one out of the air before
          if (maybeBreak(p, q)) breakDisc(q, to);  // caught it, and the catch shattered
          lowerShield(q);
          if (maybeBreak(q, p)) breakDisc(p, to, disc);
          else flyHome(p, to, null, disc);
          after(rand(0.3, 0.5), function () { rally(q); });
          return;
        }
        flyHome(p, to, null, disc);
        breakRing(fs[q].pad, k);
        fs[p].stats.rings++;
        reward(p, "success");                      // a ring out from under somebody
        emit("ring", { team: fs[q].team });
        var f = fs[q];
        if (((f.mode === "cling" || f.mode === "climb") && k === f.clingRing) ||
            ((f.mode === "stand" || f.mode === "bugged") && k === f.ring && !drop(q))) {
          // Nothing left to hold on to.
          if (finishing) learnPair(fs[p], "finish", 0, 0);   // it knows how to do that now
          setMode(q, "fall");
          // Taking a fighter out does not end the exchange unless it was the
          // last of its side; the thrower carries it on against whoever is left.
          if (!eliminated(q, 2.4, p)) after(rand(0.7, 1.1), function () { rally(p); });
          return;
        }
        // Let a fighter who has just dropped hang there a moment.
        if (f.mode === "stand") after(rand(0.3, 0.5), function () { rally(q); });
        else afterWall(rand(1.1, 1.5), function () { rally(p); });
      }, disc);
    });
    // Spark the ceiling as the disc caroms off it.
    after(releaseTime() + 0.47, function () {
      if (ds[p].state !== "flight") return;
      spark(ds[p].pos, "#ffffff");
      emit("bounce", { team: fs[p].team, tom: bounced(p) });          // off the ceiling
    });
  }

  // A throw at the body, aimed high, at the chest or low. The defender
  // answers with one of the three guards; if it picks the one that covers
  // that aim the disc comes off it, and if it picks wrong the disc goes
  // past -- and now and then finds its mark.
  function bodyShot(p, q, viaZ, opts) {
    // viaZ, when given, is the side wall this one goes off on its way over.
    // opts.arm: it is not the disc that goes, it is the hand (Tesler Arm).
    var byHand = !!(opts && opts.arm);
    var slow = byHand ? ARM_SLOW : 1;
    var shape = function (a, b, lift, wz) { return byHand ? bolt(a, b) : arc(a, b, lift, wz); };
    throwFrom(p, function (from) {
      var disc = ds[p];
      if (byHand) { disc.arm = true; disc.trail = []; emit("arm", { team: fs[p].team, name: fs[p].name }); }
      if (viaZ != null) {
        // Spark it off the glass as it turns, the way a banked shot sparks
        // off the ceiling.
        after(releaseTime() + 0.42, function () {
          if (disc.state !== "flight") return;
          spark(disc.pos, "#ffffff");
          emit("bounce", { team: fs[p].team, tom: bounced(p, disc) });
        });
      }
      var canBlock = canAct(q) && arm(q);
      var call = readThrow(p, q, canBlock);
      var stuck = fs[q].mode === "bugged";          // covered in grid bugs: no guard at all
      if (stuck) call.through = true;
      var pass = HEIGHT[call.aim] + rand(-0.08, 0.08);

      // The Bit, if either of them has one. NO stops the disc dead in front
      // of its fighter whatever the guard was; YES puts it through whatever
      // the guard was, and it lands. Both at once: NO wins, a shield being
      // the one thing a hit cannot get past.
      var yes = bitCall(p, "yes");
      var no = bitCall(q, "no");
      if (no) {
        var at = bitWorld(q);
        fly(p, shape(from, at, rand(0.1, 0.4), viaZ), rand(0.85, 1.05) * (viaZ == null ? 1 : 1.3) * slow, function () {
          spark(at, BIT_NO);
          fs[q].stats.blocks++;
          emit("block", { team: fs[q].team, aim: call.aim, name: fs[q].name,
                         tom: TOM_MID, lead: speaks(q) });
          flyHome(p, at, null, disc);
          after(rand(0.25, 0.45), function () { rally(q); });
        }, disc);
        return;
      }
      if (yes) call.through = true;
      // A hand is half as easy to stop as a disc.
      if (byHand && !call.through && Math.random() < 0.5) call.through = true;

      if (!call.through && call.guard === 1) {
        // Caught on the disc, held up across the chest.
        var to = ahead(q, chestWorld(q), 0.6);
        to[1] += 0.05;
        var dur = rand(0.85, 1.05) * (viaZ == null ? 1 : 1.3) * slow;
        after(Math.max(0, dur - 0.3), function () { raiseShield(q, false); });
        fly(p, shape(from, to, rand(0.1, 0.6), viaZ), dur, function () {
          spark(to, hot(p));
          fs[q].stats.blocks++;
          emit("block", { team: fs[q].team, aim: call.aim, name: fs[q].name,
                         tom: TOM_MID, lead: speaks(q) });
          // Disc on disc: either one may come apart, if its opponent's
          // champion has learned how to do that to a disc. A hand is not a
          // disc, and neither breaks nor is broken.
          if (!byHand && maybeBreak(p, q)) breakDisc(q, to);
          lowerShield(q);
          if (!byHand && maybeBreak(q, p)) breakDisc(p, to, disc);
          else flyHome(p, to, viaZ == null ? null : -viaZ, disc);   // off the other wall on the way back
          after(rand(0.25, 0.45), function () { rally(q); });
        }, disc);
        return;
      }

      // A throw it has made before finds its mark more often than one it is
      // trying for the first time. This is where memory stops being a
      // preference and starts being an advantage.
      // A defender that has answered this aim before can still get a piece of
      // one its guard did not cover -- the save that a fighter who has been
      // here before makes and a new program does not. This is the defensive
      // half of the same idea: practice changes what happens, not just what
      // is chosen.
      if (call.through && !yes) {
        var hand = practisedFor(fs[q], "save", call.aim);
        if (hand && canAct(q) && Math.random() < edge(hand.used, 0.22)) {
          call.through = false;                    // saved it after all
          call.guard = call.aim;                   // shown as the guard that answers
          hand.used++;
          fs[q].stats.blocks++;
        }
      }
      // A clean answer is worth remembering, now and then, so that a fighter
      // builds up the aims it is hard to get past. Only occasionally, or a
      // palette would be nothing but these.
      if (!call.through && Math.random() < 0.15) learnPair(fs[q], "save", call.aim, call.guard);

      var know = fs[p].practised;
      var hard = fs[q].champion ? CHAMP.tough : 1;          // champions are harder to catch
      var land = CONNECT * hard * (byHand ? 2 : 1);              // a hand lands twice as often
      if (call.through && (yes || Math.random() < land + edge(know && know.used, 0.18))) {
        // It found its mark: knocked back a ring and stunned, or derezzed.
        // The Bit's YES is the second: it does not knock anyone back.
        var hitAt = chestWorld(q);
        var hdur = rand(0.85, 1.05) * (viaZ == null ? 1 : 1.3) * slow;
        var hpts = shape(from, hitAt, rand(0.1, 0.4), viaZ);
        // Unless a square of an MCP shield is in the way when it gets there.
        var sq = shieldSlot(q, hpts[hpts.length - 2], hdur);
        if (sq) {
          fly(p, shape(from, sq.at, rand(0.1, 0.4), viaZ), hdur, function () {
            spark(sq.at, hot(q));
            fs[q].stats.blocks++;
            emit("block", { team: fs[q].team, aim: call.aim, name: fs[q].name,
                           tom: TOM_MID, lead: speaks(q) });
            shieldHit(q, sq.slot, sq.at);
            flyHome(p, sq.at, null, disc);
            after(rand(0.25, 0.45), function () { rally(q); });
          }, disc);
          return;
        }
        fly(p, hpts, hdur, function () {
          spark(hitAt, yes ? BIT_YES : hot(p));
          fs[p].stats.hits++;
          flyHome(p, hitAt, null, disc);
          if (yes ? alive(q) : stuck ? Math.random() < 0.5 : (canAct(q) && Math.random() < 0.3)) {
            // A champion survives the first of these each round: it takes the
            // hit, is thrown back, and is still standing where anybody else
            // would have come apart. Once only, and then it is as breakable
            // as the rest of them -- and never against the Bit, which does
            // not miss and does not leave anyone standing.
            if (!yes && CHAMP.spared && fs[q].champion && !fs[q].spared) {
              fs[q].spared = true;
              spark(hitAt, "#ffffff");
              emit("spared", { team: fs[q].team, name: fs[q].name });
              if (canAct(q)) knockBack(q);
              after(1.0, function () { rally(p); });
              return;
            }
            shatter(q);
            spark(hitAt, "#ffffff");
            emit("derez", { team: fs[q].team });
            setMode(q, "derez");
            if (!eliminated(q, 3.0, p)) after(rand(0.9, 1.3), function () { rally(p); });
            return;
          }
          if (canAct(q)) knockBack(q);
          after(1.0, function () { rally(p); });
        }, disc);
        return;
      }

      // Either the guard covered it and the disc goes by, or the guard was
      // wrong and it goes by anyway: on to the glass behind, and home.
      // The move shown is the one the defender actually chose -- a duck or
      // a sweep kick under a high throw, a split jump over a low one -- and
      // where there is somewhere to go it may instead step or flip clear,
      // which is what carries a fighter onto a fallen teammate's rings.
      if (!call.through) fs[q].stats.dodges++;   // ducked or jumped it clean
      var lateral = call.guard !== 1 && Math.random() < 0.45 && dodgeSpot(q);
      var kind = lateral ? (Math.random() < 0.5 ? "sidestep" : "flip")
               : call.guard === 0 ? (Math.random() < 0.5 ? "duck" : "sweep")
               : call.guard === 2 ? "split"
               : "duck";                                   // blocked with the disc away
      var qp = pads[fs[q].pad];
      var glass = [qp.cx > 0 ? 15.8 : -15.8, pass, qp.cz + rand(-1.0, 1.0)];
      var dur2 = rand(1.25, 1.4) * slow;
      var passAt = Math.abs(fs[q].pos[0] - from[0]) / Math.abs(glass[0] - from[0]);
      var lead = kind === "flip" ? 0.45 : kind === "sidestep" ? 0.4 : 0.45 * evadeTime[kind];
      after(Math.max(0, dur2 * passAt - lead), function () {
        if (!canAct(q)) return;
        var spot = lateral ? dodgeSpot(q) : null;
        if (kind === "flip") {
          startFlip(q);
          if (spot) relocate(q, spot[0], spot[1], spot[2], flipTime, 0);
        } else if (kind === "sidestep") {
          play(q, "dodge", 1.3);
          if (spot) relocate(q, spot[0], spot[1], spot[2], 0.5, 0.2);
        } else {
          fs[q].evade = kind;
          setMode(q, "evade");
        }
      });
      glass[1] = pass;                               // still passes where it was aimed
      fly(p, shape(from, glass, 0, viaZ), dur2, function () {
        spark(glass, hot(p));
        emit("bounce", { team: fs[p].team, tom: bounced(p, disc) });  // off the glass
        flyHome(p, glass, viaZ == null ? null : -viaZ, disc);
        after(rand(0.3, 0.5), function () { rally(q); });
      }, disc);
    });
  }

  // Both throw together; the discs meet between them and fly home.
  function clash(p, q) {
    var m = lerp3(chestWorld(p), chestWorld(q), 0.5);
    m[1] += rand(0.2, 0.7);
    m[2] += rand(-0.6, 0.6);
    var landed = 0, discs = {};
    [p, q].forEach(function (who) {
      fs[who].lastThrowAim = 1;               // they meet in the middle
      throwFrom(who, function (from) {
        var mid = lerp3(from, m, 0.5);
        discs[who] = ds[who];
        fly(who, [from, [mid[0], mid[1] + 0.3, mid[2] + rand(-0.6, 0.6)], m], 0.65, function () {
          if (++landed < 2) return;
          spark(m, "#ffffff");
          // Disc on disc, the hardest meeting there is: either may shatter.
          var bq = maybeBreak(p, q), bp = maybeBreak(q, p);
          if (bp) breakDisc(p, m, discs[p]); else flyHome(p, m, null, discs[p]);
          if (bq) breakDisc(q, m, discs[q]); else flyHome(q, m, null, discs[q]);
          after(rand(1.0, 1.4), function () { rally(Math.random() < 0.5 ? p : q); });
        }, discs[who]);
      });
    });
  }

  // Which opponent p goes after: finish one that is hanging on, otherwise
  // mostly stay with the one it is already fighting, and now and then turn
  // on someone else.
  function pickFoe(p) {
    var live = foesOf(p).filter(alive);
    if (!live.length) return -1;
    var hanging = live.filter(function (i) { return fs[i].mode === "cling" && !fs[i].willClimb; });
    if (hanging.length && Math.random() < 0.7) return hanging[Math.floor(Math.random() * hanging.length)];
    if (live.indexOf(fs[p].foe) >= 0 && Math.random() < 0.65) return fs[p].foe;
    return live[Math.floor(Math.random() * live.length)];
  }

  // How many exchanges are running at once. This used to be a counter kept
  // by hand -- one up when an exchange began, one down when it ended -- and
  // it was wrong twice, both times upward, both times silently. An exchange
  // that ended without saying so left the count high, the arena believed
  // itself busier than it was, and fighters stood about with nothing to do
  // while the count said otherwise. That is what made the ends of rounds
  // turn into taking turns.
  //
  // So it is not counted any more, it is looked at: an exchange is a fighter
  // winding up a throw or with its disc in the air, and that cannot drift
  // from the truth because it is read off the truth.
  function engaged() {
    var n = 0;
    for (var i = 0; i < fs.length; i++)
      if (alive(i) && (ds[i].state === "flight" || fs[i].clip === "throw")) n++;
    return n;
  }
  // Fighters on a side that could take an exchange this instant.
  function ready(team) {
    var out = [];
    for (var i = 0; i < fs.length; i++)
      if (fs[i].team === team && alive(i) && canAct(i) && discReady(i) && !fs[i].move && !fs[i].primed) out.push(i);
    return out;
  }

  function startChain() {
    if (choosing) return false;                    // a winner is still choosing its power
    var idle = ready(0).concat(ready(1));
    if (!idle.length) return false;
    rally(idle[Math.floor(Math.random() * idle.length)]);
    return true;
  }

  // p's turn to attack.
  function rally(p) {
    if (!alive(p)) {
      // Whoever was carrying this exchange is gone; hand it to a teammate.
      var mates = [];
      for (var i = 0; i < fs.length; i++)
        if (fs[i].team === fs[p].team && alive(i)) mates.push(i);
      if (!mates.length) return;                  // its whole side has gone
      p = mates[Math.floor(Math.random() * mates.length)];
    }
    var q = pickFoe(p);
    if (q < 0) return;                             // nobody left to throw at
    fs[p].foe = q;
    if (!canAct(p) || fs[p].primed || !arm(p)) {
      // It cannot throw just now -- mid-flip, still waiting on its disc.
      // Rather than making the exchange queue behind it, give it to somebody
      // who can: its own side first, since the fight should keep swinging
      // back and forth, then the other. Several exchanges at once only work
      // if they are not all waiting on the same fighter.
      var mine = ready(fs[p].team);
      if (mine.length) { rally(mine[Math.floor(Math.random() * mine.length)]); return; }
      var them = ready(1 - fs[p].team);
      if (them.length) { rally(them[Math.floor(Math.random() * them.length)]); return; }
      if (allDisarmed()) {
        // Nobody standing has a disc to throw -- two champions who break
        // discs, between them, can do that. A round nobody can end is not
        // a round, so the discs come back.
        for (var r = 0; r < fs.length; r++) if (ds[r].state === "broken") ds[r].state = "back";
        emit("rearm", {});
      }
      after(0.25, function () { rally(p); });
      return;
    }
    if (fs[q].mode === "climb" || (fs[q].mode === "cling" && fs[q].willClimb)) {
      afterWall(0.4, function () { rally(p); });                                // let it try
      return;
    }
    if (fs[q].mode === "cling") { bankShot(p, q, fs[q].clingRing, true); return; }  // finish it
    // Now and then, move to another ring before throwing.
    if (!fs[p].move && Math.random() < 0.3) {
      var spot = dodgeSpot(p);
      if (spot) {
        relocate(p, spot[0], spot[1], spot[2], 0.45, 0.3);
        after(0.5, function () { rally(p); });
        return;
      }
    }
    if (has(p, "arm") && Math.random() < ARM_CHANCE) { bodyShot(p, q, null, { arm: true }); return; }
    if (has(p, "bugs") && Math.random() < BUG_CHANCE && !swarmed(q)) {
      gridBugs(p, q);                              // they go on their own; the exchange carries on
      after(0.6, function () { rally(p); });
      return;
    }
    if (canAct(q) && discHome(q) && !fs[q].primed && Math.random() < 0.15) { clash(p, q); return; }
    if (Math.random() < 0.12) {
      // Bank one off the ceiling: at the ring it stands on, or another. Late
      // in a round every other ring under a fighter can be broken, and then
      // there is no other -- the one it is standing on is the only place the
      // disc can come down. Picking out of an empty list handed ringMid an
      // undefined index and took the whole animation loop down with it.
      var up = intactRings(q);
      var at = fs[q].ring;
      if (up.length && Math.random() >= 0.55) at = up[Math.floor(Math.random() * up.length)];
      bankShot(p, q, at);
      return;
    }
    // Or off a side wall, coming in from an angle rather than straight on.
    bodyShot(p, q, Math.random() < 0.22 ? pickWall() : null);
  }

  // ── Powers ────────────────────────────────────────────────────────────
  // A fighter that wins a round chooses a power, one a win, and keeps every
  // one it has chosen for as long as it holds the title -- and in the Hall,
  // for good. The fight waits while it chooses. A second disc and Power of
  // Flynn both need a comrade, so they are not offered to a side of one.
  var POWERS = {
    dual: { name: "DUAL WIELD",
            text: "When a comrade falls, takes up their disc: two discs, twice the fire rate." },
    "break": { name: "DISC BREAK",
               text: "When its disc meets another, 1 in 10 shatters the other disc for the rest of the round." },
    bit: { name: "BIT",
           text: "1 in 10 exchanges the Bit acts: YES, a hit that always lands, or NO, a disc that never does." },
    shield: { name: "MCP SHIELD",
              text: "Eight squares turn slowly around it. Each stops one hit and is gone; the shield is spent with the last." },
    flynn: { name: "POWER OF FLYNN",
             text: "5 in 100: a comrade knocked out comes back." },
    arm: { name: "TESLER ARM",
           text: "1 in 30 attacks it launches its hand, trailing a light wall. Lands twice as often, stopped half as often." },
    absorb: { name: "MCP ABSORB",
              text: "Every enemy that goes down, it takes in that enemy's moves and what its fly learned." },
    bugs: { name: "GRID BUGS",
            text: "1 in 40 attacks, five grid bugs rise from the floor below it, scuttle to one opponent and climb on: 10 seconds wriggling, no throwing, no guarding." }
  };
  var POWER_ORDER = ["dual", "break", "bit", "shield", "flynn", "arm", "absorb", "bugs"];
  var BUG_CHANCE = 1 / 40, BUG_COUNT = 5, BUG_HOLD = 10, BUG_SPEED = 3.4;   // metres a second
  var BUG_EYE = "#b84dff", BUG_GREEN = "#4dff5e";
  var BREAK_CHANCE = 0.1, BIT_CHANCE = 0.1;
  var FLYNN_CHANCE = 0.05, ARM_CHANCE = 1 / 30;
  var SHIELD_SQUARES = 8, SHIELD_R = 0.75, SHIELD_SIDE = 0.5, SHIELD_SPIN = 0.5;   // radians a second
  var BIT_REST = "#4fc3ff", BIT_YES = "#ffd60a", BIT_NO = "#ff3b30";
  var choosing = null;                             // { p, options } while a winner chooses

  function has(p, id) { return !!(fs[p] && fs[p].powers && fs[p].powers.indexOf(id) >= 0); }

  // What a winner may choose from: what it does not have yet. A second disc
  // has to come from a comrade, so it is not offered to a side of one.
  function offerFor(p) {
    return POWER_ORDER.filter(function (id) {
      return !has(p, id) && !((id === "dual" || id === "flynn") && sideSize[fs[p].team] < 2);
    });
  }
  function choiceInfo() {
    if (!choosing) return null;
    var f = fs[choosing.p];
    return { name: f.name, team: f.team, rank: (rankOf(f.stats.rounds) || {}).name || null,
             have: f.powers.map(function (id) { return POWERS[id].name; }),
             options: choosing.options.map(function (id) {
               return { id: id, name: POWERS[id].name, text: POWERS[id].text };
             }) };
  }
  function grant(id) {
    if (!choosing || choosing.options.indexOf(id) < 0) return false;
    var p = choosing.p;
    choosing = null;
    fs[p].powers.push(id);
    if (id === "shield") fs[p].shield = fullShield();
    keep(p);                                       // the Hall has it straight away
    emit("choose", null);
    emit("granted", { team: fs[p].team, name: fs[p].name, power: id });
    beginChains(0.6);
    return true;
  }

  // Disc Break. A disc that meets another -- a block, a catch, a clash in
  // the air -- may shatter it, if the disc's owner has the power. A broken
  // disc is gone for the round: no throwing, no blocking, only getting out
  // of the way. `d` is which disc, when it is the one in the air.
  function maybeBreak(by, q) {
    return has(by, "break") && alive(q) && Math.random() < BREAK_CHANCE;
  }
  function breakDisc(q, at, d) {
    d = d || ds[q];
    d.state = "broken"; d.flight = null; d.trail = [];
    spark(at, "#ffffff");
    spark([at[0], at[1] + 0.25, at[2]], hot(q));
    shatterDisc(at, fs[q].team === 0 ? program : sentinel, hot(q));
    emit("discbreak", { team: fs[q].team, name: fs[q].name });
  }
  function allDisarmed() {
    for (var i = 0; i < fs.length; i++) if (alive(i) && discReady(i)) return false;
    for (var j = 0; j < fs.length; j++) if (alive(j) && ds[j].state === "flight") return false;
    return true;
  }

  // The Bit. Every exchange its fighter is part of, it acts one time in ten,
  // and when it acts it is a coin: YES or NO. YES is a hit that lands; NO is
  // a disc that does not. A YES that comes up while its fighter is the one
  // being thrown at, or a NO while it is throwing, has nothing to do yet, so
  // the Bit holds it for the next exchange where it has -- every time it
  // acts, it counts.
  function bitCall(p, want) {
    if (!has(p, "bit") || !alive(p)) return false;
    var f = fs[p];
    if (f.bitHold === want) { f.bitHold = null; bitAct(p, want); return true; }
    if (Math.random() >= BIT_CHANCE) return false;
    var mode = Math.random() < 0.5 ? "yes" : "no";
    if (mode === want) { bitAct(p, mode); return true; }
    f.bitHold = mode;
    return false;
  }
  function bitAct(p, mode) {
    fs[p].bitShow = { mode: mode, at: wall };
    emit("bit", { team: fs[p].team, name: fs[p].name, mode: mode });
  }
  // Where the Bit is: drawn there every frame, and a NO stops a disc there.
  function bitWorld(p) {
    var a = fs[p].bitAt;
    return a ? a.slice() : ahead(p, chestWorld(p), 0.5);
  }

  // MCP Shield. Eight squares stand in a ring around the fighter at chest
  // height and turn slowly. A hit that would land meets whichever square is
  // on its side when it arrives; that square is gone, and the next disc from
  // that side goes through the gap. The last square takes the shield with
  // it -- and it is a shield, not armour: it covers the chest, so a disc off
  // the ceiling at the rings is nothing to do with it.
  function fullShield() { var a = []; for (var i = 0; i < SHIELD_SQUARES; i++) a.push(true); return a; }
  function shieldTurn(w) { return w * SHIELD_SPIN; }
  // The square in the way of a disc coming in from `from` and arriving in
  // `dur` fight seconds, with where it will be then; null for a gap.
  function shieldSlot(q, from, dur) {
    var f = fs[q];
    if (!f.shield || !has(q, "shield") || !alive(q)) return null;
    var N = SHIELD_SQUARES, step = 2 * Math.PI / N;
    var rot = shieldTurn(wall + dur / pace);       // where the ring will have turned to
    var k = Math.round((Math.atan2(from[2] - f.pos[1], from[0] - f.pos[0]) - rot) / step);
    var slot = ((k % N) + N) % N;
    if (!f.shield[slot]) return null;
    var a = rot + k * step, c = chestWorld(q);
    return { slot: slot, at: [f.pos[0] + Math.cos(a) * SHIELD_R, c[1], f.pos[1] + Math.sin(a) * SHIELD_R] };
  }
  function squareCorners(cx, cy, cz, a, h) {
    var tx = -Math.sin(a) * h, tz = Math.cos(a) * h;
    return [[cx - tx, cy - h, cz - tz], [cx + tx, cy - h, cz + tz], [cx + tx, cy + h, cz + tz], [cx - tx, cy + h, cz - tz]];
  }
  function shieldHit(q, slot, at) {
    var f = fs[q];
    if (!f.shield) return;
    f.shield[slot] = false;
    var C = squareCorners(at[0], at[1], at[2], Math.atan2(at[2] - f.pos[1], at[0] - f.pos[0]), SHIELD_SIDE / 2);
    burst([[C[0], C[1]], [C[1], C[2]], [C[2], C[3]], [C[3], C[0]]], hot(q), at, 2.4, 0.03);
    var left = f.shield.filter(Boolean).length;
    emit("shieldhit", { team: f.team, name: f.name, left: left });
    if (!left) {
      f.shield = null;
      f.powers = f.powers.filter(function (id) { return id !== "shield"; });
      emit("shieldgone", { team: f.team, name: f.name });
    }
    keep(q);
  }
  function drawShield(p, cy, alpha) {
    var f = fs[p], N = SHIELD_SQUARES, rot = shieldTurn(wall), col = hot(p);
    for (var i = 0; i < N; i++) {
      if (!f.shield[i]) continue;
      var a = rot + i * 2 * Math.PI / N;
      var cx = f.pos[0] + Math.cos(a) * SHIELD_R, cz = f.pos[1] + Math.sin(a) * SHIELD_R;
      var z = 1000 - project([cx, cy, cz])[2] * 20;
      [[SHIELD_SIDE / 2, 0.85], [SHIELD_SIDE * 0.3, 0.3]].forEach(function (sz) {
        var P = squareCorners(cx, cy, cz, a, sz[0]).map(project);
        var w = Math.max(1, 0.012 * cam.F / P[0][2]);
        for (var e = 0; e < 4; e++) seg(z, P[e], P[(e + 1) % 4], w, col, alpha * sz[1], "round");
      });
    }
  }

  // Power of Flynn. A comrade knocked out comes back, now and then, if a
  // fighter with the power is still standing on its side: it rezzes in on
  // its own platform -- or an empty one, if a teammate has moved onto its
  // own -- with every ring there back up. The knockout still counts.
  function comeBack(p, settle) {
    afterWall(settle + 0.6, function () {
      if (alive(p) || !liveCount(fs[p].team)) return;
      var pad = fs[p].home;
      if (occupied(pad)) {
        for (var i = 0; i < pads.length; i++) if (pads[i].team === fs[p].team && !occupied(i)) { pad = i; break; }
      }
      restoreRings(pad);
      resetFighter(p, pad);
      spark([pads[pad].cx, 1.2, pads[pad].cz], "#ffffff");
      emit("flynn", { team: fs[p].team, name: fs[p].name });
    });
  }

  // MCP Absorb. Every enemy that goes down, the fighter with it takes in:
  // the moves it had named and what its fly had learned, the way a
  // champion takes in its own side's at the end of a round.
  function absorbFrom(c, p) {
    var f = fs[c], g = fs[p];
    if (f.brain && g.brain) f.brain.absorb([g.brain]);
    g.combos.forEach(function (cb) { learnPairFrom(f, cb); });
    f.absorbed = (f.absorbed || 0) + 1;
    emit("mcpabsorb", { team: f.team, name: f.name, from: g.name });
  }
  // What it looks like: the fallen enemy does not fall or break up the usual
  // way, it comes apart into motes of light where it stood, and they leave
  // one at a time, a stream rather than a cloud, each flying in to the
  // absorbing champion (or, with more than one, to each in turn).
  var motes = [];
  function dissolve(p, takers) {
    var f = fs[p], W = [], col = hot(p), i, n = 0;
    for (i = 0; i < 20; i++) W.push(toWorld(p, f.pose, i));
    var at = [];
    limbs.forEach(function (lb) { for (var k = 0; k < 5; k++) at.push(lerp3(W[lb[0]], W[lb[1]], (k + 0.5) / 5)); });
    var hc = lerp3(W[10], W[11], 0.55);
    for (i = 0; i < 8; i++) at.push([hc[0] + Math.cos(i * 0.785) * 0.12, hc[1] + Math.sin(i * 0.785) * 0.13, hc[2]]);
    // Shuffle, so the stream takes the body apart from all over at once.
    for (i = at.length - 1; i > 0; i--) { var j = Math.floor(Math.random() * (i + 1)), t = at[i]; at[i] = at[j]; at[j] = t; }
    at.forEach(function (w) {
      motes.push({ home: w, to: takers[n % takers.length], go: wall + 0.35 + n * 0.028,
                   dur: rand(0.6, 0.85), lift: rand(0.4, 1.2), sw: rand(-0.8, 0.8), col: col, ph: rand(0, 6) });
      n++;
    });
    // Instead of falling or breaking up: what it was is all in the motes now.
    pieces = pieces.filter(function (pc) { return pc.who !== p || pc.born !== wall; });
    if (f.mode === "fall" || f.mode === "derez") setMode(p, "gone");
  }
  function stepMotes() {
    var live = [];
    motes.forEach(function (m) {
      var pos, tail = null, u = (wall - m.go) / m.dur, a = 1;
      function along(v) {
        var e = ease(v), q = lerp3(m.home, chestWorld(m.to), e);
        q[1] += m.lift * Math.sin(Math.PI * v);
        q[2] += m.sw * Math.sin(Math.PI * v);
        return q;
      }
      if (u >= 1) { if (motes.length === 1 || Math.random() < 0.08) spark(chestWorld(m.to), m.col); return; }
      if (u < 0) {
        // Still waiting its turn: hanging where the body was, shimmering.
        var j = 0.015 * Math.sin(wall * 13 + m.ph);
        pos = [m.home[0] + j, m.home[1] + j, m.home[2] - j];
        a = 0.75 + 0.25 * Math.sin(wall * 9 + m.ph);
      } else {
        pos = along(u);
        tail = along(Math.max(0, u - 0.12));      // a short streak behind it
        a = 1 - 0.3 * u;
      }
      live.push(m);
      var c = project(pos);
      if (c[2] <= 0.2) return;
      var r = Math.max(2.5, 0.075 * cam.F / c[2]);
      if (tail) seg(1000 - c[2] * 20 + 2, project(tail), c, r * 0.45, m.col, a * 0.6, "round");
      seg(1000 - c[2] * 20 + 3, [c[0] - 0.4, c[1]], [c[0] + 0.4, c[1]], r, m.col, a, "round");
    });
    motes = live;
  }

  // Grid bugs. Five rise through the floor grid far below the fighter that
  // sent them, scuttle across it to under one opponent, and jump up onto
  // it: it wriggles for ten seconds, unable to throw or guard, and they drop
  // off when it is free -- or when it falls, or the round ends. Each is four
  // legs and an upside-down triangle of a head with a purple eye.
  var bugs = [];
  function swarmed(q) {
    if (fs[q].mode === "bugged") return true;
    for (var i = 0; i < bugs.length; i++) if (bugs[i].q === q && bugs[i].ph !== "fall") return true;
    return false;
  }
  var BUG_HOLDS = [9, 12, 16, 0, 10];              // where on the body each one ends up
  function gridBugs(p, q) {
    var pd = pads[fs[p].pad];
    for (var i = 0; i < BUG_COUNT; i++) {
      var a = 2 * Math.PI * i / BUG_COUNT + rand(-0.3, 0.3), r = rand(0.6, 1.6);
      bugs.push({ by: p, q: q, ph: "rise", t0: wall + i * 0.18, gait: rand(0, 6), alpha: 0,
                  pos: [pd.cx + Math.cos(a) * r, floorY - 0.6, pd.cz + Math.sin(a) * r],
                  off: [rand(-0.5, 0.5), rand(-0.5, 0.5)], j: BUG_HOLDS[i % BUG_HOLDS.length],
                  jit: rand(0, 6), col: BUG_GREEN, vel: null });
    }
    spark([pd.cx, floorY + 0.2, pd.cz], hot(p));
    emit("gridbugs", { team: fs[p].team, name: fs[p].name, at: fs[q].name });
  }
  function bugHold(b) {
    var w = toWorld(b.q, fs[b.q].pose, b.j);
    var s = Math.sin(wall * 9 + b.jit) * 0.03;
    return [w[0] + s, w[1] + Math.cos(wall * 7 + b.jit) * 0.03, w[2] - s];
  }
  function stepBugs(dt) {
    var live = [];
    bugs.forEach(function (b) {
      var q = b.q, f = fs[q], u;
      if (!f) return;
      if (b.ph === "rise") {
        if (wall < b.t0) { live.push(b); return; }
        u = Math.min(1, (wall - b.t0) / 0.8);
        b.pos[1] = floorY - 0.6 + 0.75 * ease(u);
        b.alpha = u; b.gait += dt * 4;
        if (u >= 1) b.ph = "walk";
      } else if (b.ph === "walk") {
        if (!alive(q)) { b.ph = "fall"; b.vel = [0, 0, 0]; }
        else {
          // Sideways and skittering, like a crab: it wanders off its line
          // and back as it goes.
          var to = [f.pos[0] + b.off[0], floorY + 0.15, f.pos[1] + b.off[1]];
          var dx = to[0] - b.pos[0], dz = to[2] - b.pos[2], l = Math.sqrt(dx * dx + dz * dz);
          b.gait += dt * 16;
          if (l < 0.25) { b.ph = "jump"; b.t0 = wall; b.from = b.pos.slice(); }
          else {
            var st = Math.min(l, BUG_SPEED * dt), wob = Math.sin(b.gait * 0.35) * 0.6;
            b.pos[0] += (dx / l) * st - (dz / l) * st * wob;
            b.pos[2] += (dz / l) * st + (dx / l) * st * wob;
          }
        }
      } else if (b.ph === "jump") {
        if (!alive(q)) { b.ph = "fall"; b.vel = [0, 0, 0]; }
        else {
          u = Math.min(1, (wall - b.t0) / 0.9);
          var hold = bugHold(b), at = lerp3(b.from, hold, ease(u));
          at[1] += 1.4 * Math.sin(Math.PI * u);
          b.pos = at; b.gait += dt * 6;
          if (u >= 1) {
            b.ph = "on";
            var m = f.mode;
            if (m === "stand" || m === "hit" || m === "evade" || m === "flip") {
              setMode(q, "bugged");                // the first one on starts the ten seconds
              f.move = null; f.blockTarget = 0;
              emit("bugged", { team: f.team, name: f.name });
            } else if (m !== "bugged") { b.ph = "fall"; b.vel = [rand(-1, 1), 0, rand(-1, 1)]; }
          }
        }
      } else if (b.ph === "on") {
        if (f.mode !== "bugged") { b.ph = "fall"; b.vel = [rand(-1.5, 1.5), rand(1, 2.5), rand(-1.5, 1.5)]; }
        else { b.pos = bugHold(b); b.gait += dt * 20; }
      }
      if (b.ph === "fall") {
        if (b.fallAt == null) b.fallAt = wall;
        b.vel[1] -= 9.8 * dt;
        b.pos = [b.pos[0] + b.vel[0] * dt, b.pos[1] + b.vel[1] * dt, b.pos[2] + b.vel[2] * dt];
        b.gait += dt * 25;
        b.alpha = Math.max(0, 1 - (wall - b.fallAt) / 1.4);
        if (b.alpha <= 0 || b.pos[1] < floorY - 1) return;
      }
      live.push(b);
      drawBug(b);
    });
    bugs = live;
  }
  function drawBug(b) {
    if (b.alpha <= 0.01) return;
    var c = project(b.pos);
    if (c[2] <= 0.2) return;
    var s = 0.42 * cam.F / c[2], z = 1000 - c[2] * 20 + 4, col = b.col, a = b.alpha;
    var w = Math.max(1, 0.025 * cam.F / c[2]), x = c[0], y = c[1], g = b.gait;
    // Four legs, two a side, stepping in alternate pairs.
    [[-1, 0], [-1, 1], [1, 0], [1, 1]].forEach(function (L) {
      var sd = L[0], ph = g + (L[1] ? Math.PI : 0) + (sd > 0 ? Math.PI : 0);
      var lift = Math.max(0, Math.sin(ph)) * 0.2, swing = Math.cos(ph) * 0.16;
      var hip = [x + sd * s * 0.22, y - s * 0.02 + L[1] * s * 0.12];
      var knee = [x + sd * s * (0.6 + swing * 0.4), y - s * (0.3 + lift) + L[1] * s * 0.14];
      var foot = [x + sd * s * (0.82 + swing), y + s * (0.42 - lift) + L[1] * s * 0.1];
      seg(z, hip, knee, w, col, a, "round");
      seg(z, knee, foot, w, col, a, "round");
    });
    // The head: a triangle, point down, and the eye.
    var A = [x - s * 0.34, y - s * 0.22], B = [x + s * 0.34, y - s * 0.22], C = [x, y + s * 0.34];
    seg(z + 0.1, A, B, w * 1.2, col, a, "round");
    seg(z + 0.1, B, C, w * 1.2, col, a, "round");
    seg(z + 0.1, C, A, w * 1.2, col, a, "round");
    seg(z + 0.2, [x - 0.5, y - s * 0.06], [x + 0.5, y - s * 0.06], Math.max(2.5, s * 0.17), BUG_EYE, a, "round");
  }

  // Its shapes, as wireframes. The icosahedron's twelve vertices and its
  // twenty face directions are enough for all of them: the dodecahedron's
  // vertices are the face directions, and so are the stellation's spikes.
  var BIT = (function () {
    var P = (1 + Math.sqrt(5)) / 2, v = [], i, j, k;
    [-1, 1].forEach(function (a) {
      [-1, 1].forEach(function (b) {
        v.push([0, a, b * P], [a, b * P, 0], [b * P, 0, a]);
      });
    });
    var R = Math.sqrt(1 + P * P);
    v = v.map(function (q) { return [q[0] / R, q[1] / R, q[2] / R]; });   // circumradius 1
    var e = 2 / R, near = function (a, b) {
      var dx = a[0] - b[0], dy = a[1] - b[1], dz = a[2] - b[2];
      return Math.abs(Math.sqrt(dx * dx + dy * dy + dz * dz) - e) < 1e-6;
    };
    var ico = [], faces = [];
    for (i = 0; i < 12; i++) for (j = i + 1; j < 12; j++) if (near(v[i], v[j])) ico.push([i, j]);
    for (i = 0; i < 12; i++) for (j = i + 1; j < 12; j++) for (k = j + 1; k < 12; k++)
      if (near(v[i], v[j]) && near(v[j], v[k]) && near(v[i], v[k])) faces.push([i, j, k]);
    var dirs = faces.map(function (f) {
      var c = [0, 1, 2].map(function (a) { return v[f[0]][a] + v[f[1]][a] + v[f[2]][a]; });
      var l = Math.sqrt(c[0] * c[0] + c[1] * c[1] + c[2] * c[2]);
      return [c[0] / l, c[1] / l, c[2] / l];
    });
    var dod = [], tri = [];
    for (i = 0; i < 20; i++) {
      for (j = i + 1; j < 20; j++) {
        var shared = faces[i].filter(function (x) { return faces[j].indexOf(x) >= 0; }).length;
        if (shared === 2) dod.push([i, j]);        // neighbouring faces: a dodecahedron edge
      }
      faces[i].forEach(function (x) { tri.push([i, x]); });
    }
    var oct = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]], octE = [];
    for (i = 0; i < 6; i++) for (j = i + 1; j < 6; j++) if (Math.abs(oct[i][0] + oct[j][0]) + Math.abs(oct[i][1] + oct[j][1]) + Math.abs(oct[i][2] + oct[j][2]) > 0.5) octE.push([i, j]);
    return { v: v, dirs: dirs, ico: ico, dod: dod, tri: tri, oct: oct, octE: octE };
  })();

  // Draw the Bit for fighter p, around world point c.
  function drawBit(p, c, z0, alpha) {
    var f = fs[p], size = 0.2;
    var a = wall * 0.9, b = wall * 0.53;
    var ca = Math.cos(a), sa = Math.sin(a), cb = Math.cos(b), sb = Math.sin(b);
    function place(q, r) {
      var x = q[0] * r, y = q[1] * r, zz = q[2] * r;
      var x1 = x * ca + zz * sa, z1 = -x * sa + zz * ca;
      var y1 = y * cb - z1 * sb, z2 = y * sb + z1 * cb;
      return project([c[0] + x1 * size, c[1] + y1 * size, c[2] + z2 * size]);
    }
    function edges(list, A, B, col, w, o) {
      for (var i = 0; i < list.length; i++) {
        var pa = A(list[i][0]), pb = B(list[i][1]);
        seg(z0, pa, pb, w, col, alpha * o, "round");
      }
    }
    var sh = f.bitShow, age = sh ? wall - sh.at : 99;
    var w = Math.max(1, 0.012 * cam.F / project(c)[2]);
    if (age < 1.1 && sh.mode === "yes") {
      // YES: a yellow octahedron.
      var O = BIT.oct.map(function (q) { return place(q, 1.15); });
      edges(BIT.octE, function (i) { return O[i]; }, function (i) { return O[i]; }, BIT_YES, w * 1.3, 1);
      return;
    }
    var I = BIT.v.map(function (q) { return place(q, 1); });
    if (age < 1.1 && sh.mode === "no") {
      // NO: red, all points -- a stellation of the icosahedron, every face
      // drawn out into a long spike.
      var S = BIT.dirs.map(function (q) { return place(q, 2.3); });
      edges(BIT.ico, function (i) { return I[i]; }, function (i) { return I[i]; }, BIT_NO, w, 0.6);
      edges(BIT.tri, function (i) { return S[i]; }, function (i) { return I[i]; }, BIT_NO, w * 1.2, 1);
      return;
    }
    // At rest it never settles: icosahedron, dodecahedron, icosahedron,
    // dodecahedron, half a second each, with a quick crossfade between so the
    // change reads as a shift rather than a flicker.
    var ph = (wall / 0.5) % 2, k = ph % 1, XF = 0.2;      // crossfade in the last fifth of each
    var ico = ph < 1;
    var fade = k > 1 - XF ? (k - (1 - XF)) / XF : 0;      // 0 holding, 1 fully turned
    var oIco = ico ? 1 - fade : fade, oDod = 1 - oIco;
    var D = BIT.dirs.map(function (q) { return place(q, 1); });
    if (oIco > 0.01) edges(BIT.ico, function (i) { return I[i]; }, function (i) { return I[i]; }, BIT_REST, w, oIco);
    if (oDod > 0.01) edges(BIT.dod, function (i) { return D[i]; }, function (i) { return D[i]; }, BIT_REST, w, oDod);
  }

  // ── Rounds ────────────────────────────────────────────────────────────
  // A fighter that goes over the edge is out. Nobody comes back until one
  // side has been cleared off the board entirely; then the whole arena is
  // set up again and the next round begins.
  // Rounds won, and what to say when one is. A match is a fresh scoreline,
  // so changing the match size starts the count again.
  var score = [0, 0];
  var banner = "";
  var SIDE_NAME = ["PROGRAMS", "SENTINELS"];

  function liveCount(team) {
    var n = 0;
    for (var i = 0; i < fs.length; i++) if (fs[i].team === team && alive(i)) n++;
    return n;
  }

  // Called the moment a fighter is out, with how long the fall or the derez
  // still has to play before the arena should be reset. True once that was
  // the last of its side: the round is over and the caller's exchange dies
  // with it, rather than being handed on.
  function eliminated(p, settle, by) {
    if (by != null && by !== p && fs[by]) {
      fs[by].stats.kills++;
      rememberKill(by);                            // keep how it was done
      reward(by, "knockout");                      // a knockout or a kill: the bigger dose
    }
    if (fs[p].champion) keep(p);                   // its record as it fell
    // A champion that wields two takes up the disc of the comrade who fell.
    for (var c = 0; c < fs.length; c++) {
      if (c === p || fs[c].team !== fs[p].team || !alive(c) || !has(c, "dual") || fs[c].spare) continue;
      fs[c].spare = { state: "back", pos: [0, 0, 0], trail: [], flight: null };
      spark(chestWorld(c), hot(c));
      emit("dual", { team: fs[c].team, name: fs[c].name });
    }
    // Power of Flynn: one roll, if anybody standing on its side has it.
    for (var fl = 0; fl < fs.length; fl++) {
      if (fl === p || fs[fl].team !== fs[p].team || !alive(fl) || !has(fl, "flynn")) continue;
      if (Math.random() < FLYNN_CHANCE) comeBack(p, settle);
      break;
    }
    // MCP Absorb: every enemy standing with it takes in what this one knew.
    var takers = [];
    for (var ab = 0; ab < fs.length; ab++)
      if (fs[ab].team !== fs[p].team && alive(ab) && has(ab, "absorb")) { absorbFrom(ab, p); takers.push(ab); }
    if (takers.length) dissolve(p, takers);
    // Called once per fighter per round, so it is what the tempo counts.
    emit("out", { team: fs[p].team, left: liveCount(fs[p].team) });
    if (liveCount(fs[p].team) > 0) return false;   // its side fights on without it
    var winner = 1 - fs[p].team;
    lastWinner = winner;
    score[winner]++;
    // The biggest dose of all, to every fly on the side that won it --
    // standing or not, since a fallen teammate's moves wore the other side
    // down too. Only the survivors carry it anywhere: the rest are about to
    // be replaced.
    for (var w = 0; w < fs.length; w++) if (fs[w].team === winner) reward(w, "round");
    banner = SIDE_NAME[winner] + " WIN";
    // The round is decided here, not when the next one is set up a second
    // and a half later. Anything still sounding belongs to a fight that has
    // finished, so say so now rather than at "round".
    emit("over", { team: winner });
    afterWall(settle + 1.4, newRound);             // let the last one finish falling
    return true;
  }

  // A round of a match from the Hall. The champions picked for it keep their
  // seats for every round, fallen or not; a round won while still standing
  // counts toward a champion's rank, as it does anywhere. Anyone not from
  // the Hall -- the new programs filling a side nobody was picked for -- is
  // replaced with a new program and a new fly, as a losing side is.
  function hallRound() {
    var taken = [];
    fs.forEach(function (f) { if (f.seated) taken.push(f.name); });
    for (var n = 0; n < fs.length; n++) {
      var f = fs[n];
      if (f.seated) {
        if (f.team === lastWinner && alive(n)) f.stats.rounds++;
        if (f.brain) f.brain.clearTrace();
        keep(n);
        continue;
      }
      f.name = freshName(taken);
      f.stats = blankStats();
      f.combos = []; f.plan = null; f.prevAim = -1;
      f.powers = []; f.shield = null; f.absorbed = 0;
      f.brain = freshBrain();
      f.foe = -1; f.lastAim = -1; f.lastGuard = -1;
    }
  }

  // Everyone back on their platform, every ring up, and the next round on.
  function newRound() {
    emit("round", {});                             // everything back to the top

    // One fighter goes through to the next round, and only one. A champion
    // that is still standing keeps the place however the points fell: the
    // title is held until somebody takes it off them, not lent out again
    // every round to whoever had the best few minutes. Only when the
    // champion has gone does it pass, and then to whichever survivor has
    // most to show for the round. Everybody else is a new program with a
    // new name and nothing to their name yet, so a champion is the only
    // thing in the arena that accumulates -- and the only one with anything
    // to lose.
    var picker = -1;                               // who chooses a power for winning
    if (hall) {
      hallRound();
      // From the Hall, the champion standing on the winning side with the
      // most to show for the round chooses.
      var bestH = -1;
      for (var hp = 0; hp < fs.length; hp++) {
        if (!fs[hp].seated || fs[hp].team !== lastWinner || !alive(hp)) continue;
        if (tally(fs[hp]) > bestH) { bestH = tally(fs[hp]); picker = hp; }
      }
    }
    else {
      var champ = -1, best = -1;
      for (var h = 0; h < fs.length; h++) {
        if (fs[h].champion && alive(h)) { champ = h; break; }   // still standing: still champion
      }
      if (champ < 0) {
        for (var c = 0; c < fs.length; c++) {
          if (!alive(c)) continue;
          var pts = tally(fs[c]);
          if (pts > best) { best = pts; champ = c; }
        }
      }
      if (champ >= 0) fs[champ].stats.rounds++;
      picker = champ;

      // The champion stood on the winning side -- nobody else is left standing
      // -- and before its teammates are replaced it takes in what they learned
      // winning: their flies' weights, and the moves they named.
      var mates = [];
      if (champ >= 0) {
        for (var m = 0; m < fs.length; m++)
          if (m !== champ && fs[m].team === fs[champ].team) mates.push(m);
        if (fs[champ].brain)
          fs[champ].brain.absorb(mates.map(function (k) { return fs[k].brain; }));
        mates.forEach(function (k) {
          fs[k].combos.forEach(function (cb) { learnPairFrom(fs[champ], cb); });
        });
        fs[champ].taught = mates.length;
        if (mates.length) emit("absorb", { team: fs[champ].team, name: fs[champ].name, from: mates.length });
      }
      if (champ >= 0 && fs[champ].brain) fs[champ].brain.clearTrace();   // last round is paid for

      var taken = champ >= 0 ? [fs[champ].name] : [];
      for (var n = 0; n < fs.length; n++) {
        fs[n].champion = (n === champ);
        if (n === champ) continue;
        fs[n].name = freshName(taken);               // a new program on that platform
        fs[n].cid = null; fs[n].crowned = null;
        fs[n].stats = blankStats();
        fs[n].combos = []; fs[n].plan = null; fs[n].prevAim = -1;
        fs[n].powers = []; fs[n].shield = null;      // powers are won, not handed down
        fs[n].absorbed = 0;
        // The champion's side starts the round knowing what the champion
        // knows: a copy of its fly, and its moves. The side that lost starts
        // from nothing -- new flies that will flail at first.
        if (champ >= 0 && fs[n].team === fs[champ].team && fs[champ].brain && flies()) {
          fs[n].brain = freshBrain().taughtBy(fs[champ].brain, fs[champ].name);
          fs[n].combos = fs[champ].combos.map(function (cb) {
            return { trig: cb.trig, from: cb.from, b: cb.b, used: cb.used, name: cb.name,
                     inherited: cb.used };
          });
        } else {
          fs[n].brain = freshBrain();
        }
        fs[n].foe = -1;
        fs[n].lastAim = -1; fs[n].lastGuard = -1;
      }
      if (champ >= 0) keep(champ);                 // the Hall has its latest
    }

    for (var g = 0; g < pads.length; g++) restoreRings(g);
    for (var i = 0; i < fs.length; i++) resetFighter(i, fs[i].home);
    // Anything still queued belongs to the round that just ended.
    queue = []; wallQueue = []; bugs = [];
    banner = "";
    // The winner chooses a power before anybody throws. The arena waits for
    // the choice -- the fighters stand rezzed in, ready -- however long it
    // takes.
    var offer = picker >= 0 ? offerFor(picker) : [];
    if (offer.length) {
      choosing = { p: picker, options: offer };
      emit("choose", choiceInfo());
    } else {
      beginChains(1.2);
    }
  }

  // A fighter rezzing in on platform `pad`: at the start of a round, or
  // brought back by Power of Flynn.
  function resetFighter(i, pad) {
    var f = fs[i];
    f.pad = pad;
    f.ring = 0; f.ang = 0; f.pos = [pads[pad].cx, pads[pad].cz];
    f.move = null; f.clingRing = -1; f.willClimb = false; f.foe = -1;
    f.blockTarget = 0; f.block = 0;
    f.plan = null;                                 // nothing half-played carries over
    f.primed = false;                              // nor a throw half thrown
    f.spared = false;                              // the free hit comes back each round
    f.spare = null;                                // a second disc is taken up again, or not
    f.bitHold = null; f.bitShow = null;
    setMode(i, "rez");
    f.yOff = 0; f.alpha = 0;
    play(i, "idle");
    ds[i] = { state: "back", pos: [0, 0, 0], trail: [], flight: null };
  }

  function beginChains(lead) {
    for (var j = 0; j < teamSize; j++) afterWall(lead + j * 0.35, startChain);
  }

  // ── Frame ─────────────────────────────────────────────────────────────
  function step(realDt) {
    var dt = realDt * pace;
    now += dt;
    wall += realDt;
    var due = queue.filter(function (e) { return e.at <= now; });
    if (due.length) {
      queue = queue.filter(function (e) { return e.at > now; });
      due.forEach(function (e) { e.fn(); });
    }
    var dueWall = wallQueue.filter(function (e) { return e.at <= wall; });
    if (dueWall.length) {
      wallQueue = wallQueue.filter(function (e) { return e.at > wall; });
      dueWall.forEach(function (e) { e.fn(); });
    }
    // Rings that have finished rising are simply up again, and one that has
    // been gone a while starts back on its own.
    var champPad = -1;
    for (var cp = 0; cp < fs.length; cp++)
      if (fs[cp].champion && alive(cp)) { champPad = fs[cp].pad; break; }
    pads.forEach(function (pd, pix) {
      var rs = pd.rings;
      var back = pix === champPad ? ringBack * CHAMP.rings : ringBack;
      rs.forEach(function (r, k) {
        if (r.s === "rising" && wall - r.t > 0.9) rs[k] = { s: "up" };
        else if (r.s === "falling" && wall - r.t > back) rs[k] = { s: "rising", t: wall };
      });
    });
    // Keep as many exchanges going as the match should have.
    if (wall - lastChainCheck > 0.4) {
      lastChainCheck = wall;
      // As the round wears on there are fewer fighters to carry exchanges,
      // so ask for no more than the thinner side can still put up.
      // How many exchanges should be going. Taking the thinner side was
      // wrong: it meant three fighters facing one ran a single exchange
      // between them and took turns, so a round went quiet exactly where it
      // should be at its worst. What matters is how many can throw, which is
      // the larger side -- three onto one is three discs in the air, and
      // being outnumbered looks like it.
      var a = liveCount(0), b = liveCount(1);
      var want = (a > 0 && b > 0) ? Math.min(teamSize, Math.max(a, b)) : 0;
      // One at a time, several times a second: it climbs to where it should
      // be within a second and cannot run away, since starting one needs a
      // fighter standing idle with its disc in hand.
      if (engaged() < want) startChain();
    }
    aimCamera(realDt);

    dn = 0;                                    // start this frame's draw list

    for (var i = 0; i < lines.length; i++) {
      var ln = lines[i];
      seg(-1000, project(ln[0]), project(ln[1]), ln[4], ln[3], ln[2]);
    }

    // Rings: project each edge circle once, then lay its segments.
    for (var ci = 0; ci < ringCircles.length; ci++) {
      var cc = ringCircles[ci], look = ringLook(cc[0], cc[1]), pts = [];
      var cxw = pads[cc[0]].cx, czw = pads[cc[0]].cz;
      if (look[1] <= 0.01) continue;
      for (var a = 0; a <= ringSegs; a++) {
        var ang = 2 * Math.PI * a / ringSegs;
        pts.push(project([cxw + Math.cos(ang) * cc[2], look[0], czw + Math.sin(ang) * cc[2]]));
      }
      var outer = cc[2] === ringRadii[cc[1]][1];
      var col = pads[cc[0]].team === 0 ? program : sentinel;
      for (var sg = 0; sg < ringSegs; sg++) {
        seg(1000 - (pts[sg][2] + pts[sg + 1][2]) * 10 - 1, pts[sg], pts[sg + 1],
            outer ? 2 : 1.2, col, look[1] * (outer ? 0.95 : 0.55));
      }
    }

    fs.forEach(function (_f, p) {
      var local = localPose(p, dt, realDt);
      updateMode(p);
      var f = fs[p];
      if (f.mode === "gone" || f.mode === "derez") return;
      var col = f.team === 0 ? program : sentinel, alpha = f.alpha;
      var S = [];
      for (var j = 0; j < 20; j++) S.push(project(toWorld(p, local, j)));
      // With its hand launched, the arm ends at the wrist.
      var handOut = (ds[p].arm && ds[p].state === "flight") || !!(f.spare && f.spare.arm && f.spare.state === "flight");
      for (var k = 0; k < limbs.length; k++) {
        if (handOut && limbs[k][1] === 19) continue;
        var lb = limbs[k], a1 = S[lb[0]], b1 = S[lb[1]], depth = (a1[2] + b1[2]) / 2;
        limb(1000 - depth * 20, a1, b1, Math.max(2, lb[2] * cam.F / depth), col, alpha);
      }
      var hc = project(lerp3(toWorld(p, local, 10), toWorld(p, local, 11), 0.55));
      var hs = 0.24 * cam.F / hc[2];
      var hd = put("head", 1000 - hc[2] * 20 + 1);
      hd.x = hc[0] - hs / 2; hd.y = hc[1] - hs * 0.56;
      hd.w = hs; hd.h = hs * 1.12; hd.c = col; hd.o = alpha;
      // The visor sits on whichever side the fighter faces, as seen on screen.
      var front = project(ahead(p, toWorld(p, local, 11), 0.3));
      hd.vx = front[0] > hc[0] ? hs * 0.45 : hs * 0.05;

      // The name over the head, and above that, if it is the champion, the
      // rank it has climbed to by holding on.
      var nameTop = hc[1] - hs * 1.75;
      var lit = f.team === 0 ? programHi : sentinelHi;
      var zAt = 1000 - hc[2] * 20 + 2;
      nameAt(f.name, hc[0], nameTop, hs * 0.62,
             f.champion ? lit : col, alpha * (f.champion ? 1 : 0.8), zAt);
      if (f.champion) rankAt(f.stats.rounds, hc[0], nameTop - hs * 0.42, hs * 0.23, lit, alpha, zAt);
      // The Bit keeps station beside the head, below the name, swinging
      // slowly from one shoulder to the other and bobbing as it goes.
      if (has(p, "bit")) {
        // Behind the shoulder, out of the line of its own throws.
        var head = toWorld(p, local, 11), sway = Math.sin(wall * 0.35 + p);
        f.bitAt = [head[0] - f.fv[0] * 0.6, head[1] + 0.02 + Math.sin(wall * 2.1) * 0.05,
                   head[2] - f.fv[1] * 0.6 + sway * 0.25];
        drawBit(p, f.bitAt, 1000 - project(f.bitAt)[2] * 20 + 2, alpha);
      }
      if (f.shield && has(p, "shield")) drawShield(p, toWorld(p, local, 9)[1], alpha);
    });

    // Discs and their trails -- a fighter's own, and a second one if it has
    // taken up a fallen comrade's.
    fs.forEach(function (_d, p) {
      drawDisc(p, ds[p], false);
      if (fs[p].spare) drawDisc(p, fs[p].spare, true);
    });
    function drawDisc(p, d, second) {
      var f = fs[p];
      if (d.state === "broken") return;
      if (d.state === "flight") {
        var fl = d.flight, t = Math.min(1, (now - fl.t0) / fl.dur);
        d.pos = flightPoint(fl, t);
        d.trail = [d.pos].concat(d.trail);
        // A disc's streak is short; a launched hand's light wall stays, all
        // of it, until the hand is home.
        if (!d.arm) d.trail = d.trail.slice(0, trailLen + 1);
        else if (d.trail.length > 900) d.trail.length = 900;
        if (t >= 1) { d.flight = null; d.state = "hand"; fl.done(); }
      } else {
        d.pos = second ? toWorld(p, f.pose, 15)        // the second disc rides in the other hand
              : d.state === "hand" ? handWorld(p) : d.state === "shield" ? shieldWorld(p) : backWorld(p);
        d.trail = d.trail.slice(0, Math.max(0, d.trail.length - 3));     // the streak fades after a catch
      }
      if (f.mode === "gone" || f.mode === "derez") return;
      var alpha = d.state === "flight" ? 1 : f.alpha;
      if (d.arm && d.state === "flight") { drawArm(p, d); return; }
      var s = project(d.pos), r = 0.3 * cam.F / s[2], view = norm(sub(d.pos, cam.p));
      var dw, dh;
      if (d.state === "flight") {
        // Flying flat: seen more or less edge-on from the side.
        var squash = Math.max(0.25, Math.abs(view[1]) + 0.15);
        dw = r; dh = r * squash;
      } else if (d.state === "shield") {
        // Held upright facing the enemy: narrow as the camera sees it.
        dw = r * Math.max(0.3, Math.abs(view[0])); dh = r * 1.05;
      } else {
        dw = r; dh = r;
      }
      var di = put("disc", 1000 - s[2] * 20 + (d.state === "back" ? -3 : 3));
      di.x = s[0]; di.y = s[1]; di.w = dw; di.h = dh;
      di.c = f.team === 0 ? program : sentinel;
      di.hot = f.team === 0 ? programHi : sentinelHi;
      di.o = alpha;
      // The trail: segments between successive positions, thinning out.
      var tp = d.trail.map(project);
      for (var g = 0; g + 1 < tp.length && g < trailLen; g++) {
        var tw = Math.max(1, 0.06 * cam.F / tp[g][2] * (1 - g / trailLen));
        seg(1000 - tp[g][2] * 20 - 1, tp[g], tp[g + 1], tw,
            f.team === 0 ? programHi : sentinelHi, 0.85 * (1 - g / trailLen), "round");
      }
    }

    // A launched hand, and the light wall it lays behind it like a light
    // cycle: a bright top edge, a dimmer foot and the wall between, all the
    // way back to where it left the wrist. Its disc stays on its back.
    function drawArm(p, d) {
      var f = fs[p], hc = hot(p);
      var tp = d.trail.map(project);
      var lo = d.trail.map(function (q) { return project([q[0], q[1] - 0.16, q[2]]); });
      for (var g = 0; g + 1 < tp.length; g++) {
        var z = 1000 - tp[g][2] * 20 - 1;
        seg(z, tp[g], tp[g + 1], Math.max(1.5, 0.03 * cam.F / tp[g][2]), hc, 0.95, "round");
        seg(z - 1, lo[g], lo[g + 1], 1, hc, 0.5);
        if (g % 3 === 0) seg(z - 1, tp[g], lo[g], Math.max(1, 0.02 * cam.F / tp[g][2]), hc, 0.22);
      }
      // The hand: a fist leading, the stub of a wrist behind it.
      var back = d.trail.length > 3 ? d.trail[3] : handWorld(p);
      var dir = norm(sub(d.pos, back));
      var tail = [d.pos[0] - dir[0] * 0.16, d.pos[1] - dir[1] * 0.16, d.pos[2] - dir[2] * 0.16];
      var a = project(d.pos), b = project(tail);
      limb(1000 - a[2] * 20 + 2, b, a, Math.max(3, 0.09 * cam.F / a[2]), f.team === 0 ? program : sentinel, 1);
      seg(1000 - a[2] * 20 + 3, b, a, Math.max(1, 0.03 * cam.F / a[2]), hc, 1, "round");
      if (f.mode === "gone" || f.mode === "derez") return;
      var bw = backWorld(p), bs = project(bw), br = 0.3 * cam.F / bs[2];
      var di = put("disc", 1000 - bs[2] * 20 - 3);
      di.x = bs[0]; di.y = bs[1]; di.w = br; di.h = br;
      di.c = f.team === 0 ? program : sentinel; di.hot = hc; di.o = f.alpha;
    }

    if (pieces.length) stepPieces(realDt);
    if (bugs.length) stepBugs(realDt);
    if (motes.length) stepMotes();

    for (var n = 0; n < sparkData.length; n++) {
      var sd = sparkData[n];
      if (!sd) continue;
      var age = wall - sd.born;
      if (age >= 0.5) continue;
      var ps = project(sd.w);
      var sp = put("spark", 1500);
      sp.x = ps[0]; sp.y = ps[1];
      sp.size = 0.3 * cam.F / ps[2];
      sp.age = age; sp.c = sd.col;
    }

    ctx.fillStyle = ink;
    ctx.fillRect(0, 0, W, H);
    paint();
  }

  // ── Bootstrap ─────────────────────────────────────────────────────────
  var canvas, last = 0, raf = 0, gen = 0, paused = false, lastChainCheck = 0;

  function resize() {
    var dpr = Math.min(2, window.devicePixelRatio || 1);
    W = canvas.clientWidth;
    H = canvas.clientHeight;
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  // One loop per generation, so a resume can always start a fresh one
  // without ever ending up with two running at once.
  function start() {
    var mine = ++gen;
    last = 0;
    raf = requestAnimationFrame(function loop(ts) {
      if (paused || mine !== gen) return;
      if (!last) last = ts;
      var dt = Math.min(0.05, (ts - last) / 1000);
      last = ts;
      step(dt);
      raf = requestAnimationFrame(loop);
    });
  }

  function setPaused(p) {
    paused = !!p;
    if (!paused) start();
  }

  window.DiscWars = {
    themes: THEMES,
    setTheme: function (key) { if (THEMES[key]) applyPalette(THEMES[key]); },
    // An ENCOM palette straight out of a theme's encom.json, as the desktop
    // hands it over. Anything it leaves out falls back to TRON Legacy, so a
    // partial palette still draws.
    setPalette: function (p) {
      var base = THEMES["tron-legacy"];
      applyPalette({
        name: p.brand || base.name,
        sideA: p.sideA || base.sideA, sideAHi: p.sideAHi || base.sideAHi,
        sideB: p.sideB || base.sideB, sideBHi: p.sideBHi || base.sideBHi,
        accent: p.accent || base.accent, accentHi: p.accentHi || base.accentHi,
        ink: p.ink || base.ink
      });
    },
    setPaused: setPaused,
    // The winner's power, chosen from what "choose" offered. The next round
    // starts once it is given.
    grant: grant,
    // Listen to the fight: ("throw"|"block", { team, aim }).
    on: function (fn) { if (typeof fn === "function") listeners.push(fn); },
    // Something to keep time with: fn(windUp, team, name, champion) -> real seconds from now
    // until the release, or null for none. See throwFrom.
    setBeatClock: function (fn) { beatClock = typeof fn === "function" ? fn : null; },
    // 1 for the duel, 2 or 3 for a team match. Restarts the fight.
    setTeams: function (n) {
      buildMatch(n);
      for (var i = 0; i < teamSize; i++) after(0.8 + i * 0.35, startChain);
    },
    get teams() { return teamSize; },
    // A match out of the Hall of Champions: [programs, sentinels], each a
    // list of up to three saved champion records. Restarts the fight.
    startHall: function (roster) {
      if (!roster || roster.length !== 2) return false;
      var a = (roster[0] || []).slice(0, 3), b = (roster[1] || []).slice(0, 3);
      if (!a.length && !b.length) return false;
      buildMatch(0, [a, b]);
      for (var i = 0; i < teamSize; i++) after(0.8 + i * 0.35, startChain);
      return true;
    },
    // What the scoreboard needs: the scoreline, who is still standing, and
    // the word on a round just won. Read, never held on to -- the fighters
    // are rebuilt whenever the match size changes.
    state: function () {
      return {
        teams: teamSize,
        sizes: sideSize.slice(),
        hall: hall,
        score: score.slice(),
        banner: banner,
        choosing: choiceInfo(),
        sides: SIDE_NAME.slice(),
        fighters: fs.map(function (f, i) {
          return { team: f.team, alive: alive(i), name: f.name,
                   champion: f.champion, seated: !!f.seated, id: f.cid || null,
                   points: tally(f), stats: f.stats,
                   rank: f.champion ? (rankOf(f.stats.rounds) || {}).name : null,
                   powers: (f.powers || []).map(function (id) { return POWERS[id].name; }),
                   disarmed: ds[i].state === "broken", dual: !!f.spare,
                   shield: f.shield ? f.shield.filter(Boolean).length : 0, bugged: f.mode === "bugged",
                   combos: f.combos.map(function (c) {
                     return { name: c.name, used: c.used, trig: c.trig };
                   }) };
        }),
        // Each fighter's fly, for the readout: what it does, how much it has
        // been taught, and the neurons behind its last decision.
        flies: flies() ? fs.map(function (f, i) {
          var b = f.brain;
          if (!b) return null;
          return { name: f.name, team: f.team, alive: alive(i), champion: f.champion,
                   decisions: b.decisions, dopamine: b.dopamine,
                   teacher: b.teacher, absorbed: f.champion ? (f.taught || 0) : 0,
                   aims: b.mix.aim.slice(), guards: b.mix.guard.slice(),
                   last: b.last, lastDA: b.lastDA };
        }) : null,
        // What the two policies have come to, for the readout. Null when
        // learn.js is not loaded and the fight is being played blind.
        learning: brains && brains.map(function (b) {
          return { throws: b.throws, through: b.recent,
                   aims: b.aimMix.slice(), guards: b.guardMix.slice() };
        })
      };
    },
    init: function (el, n) {
      canvas = el;
      ctx = canvas.getContext("2d");
      applyPalette(THEMES["tron-legacy"]);
      buildMatch(n || 1);
      resize();
      window.addEventListener("resize", resize);
      // A hidden tab stops getting animation frames; start a fresh loop on
      // the way back rather than assuming the old one survived.
      document.addEventListener("visibilitychange", function () {
        if (!document.hidden && !paused) start();
      });
      for (var i = 0; i < teamSize; i++) after(0.8 + i * 0.35, startChain);
      start();
    }
  };
})();
