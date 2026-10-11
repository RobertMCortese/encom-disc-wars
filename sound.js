// The fight, as a track.
//
// A four-on-the-floor kick with a snare on two and four holds 120 BPM under
// everything, an open hat on every off-beat, and a bassline on the root.
// Over that, a riff: sixteen steps through the notes of the chord, round and
// round, the way a French house record is built. The chords move every two
// bars and the riff moves with them. Every round is dealt its own
// progression and basslines, and every fourth bar ends on a fill.
//
// Every fighter has a riff of its own, one of thirty-six, and plays it when it
// throws: a bar of it, starting on the eighth the disc leaves the hand. The
// riff goes with the name, so a champion brings its riff into the next round
// and back out of the Hall, and no two fighters in a round share one.
//
// What came before this had the fight write the notes. Every fighter's name
// hashed out a phrase of its own, a throw played it, and every throw moved
// the key. It was honest and it sounded like random beeps: nothing came
// round twice, so there was nothing to recognise. Now the notes are written
// and the fight ARRANGES them. Throws strike the chord on the grid; discs in
// the air open the riff's filter, so a busy exchange sweeps it bright and a
// lull lets it close back down; each side plays its fighters' riffs its own
// way, so an exchange is call and response. The same exchange still sounds like the same
// exchange -- it is just played on a record now rather than on a keyboard
// that somebody dropped.
//
// The fight keeps time with it, too. When Sound is on, a fighter about to
// throw waits for the grid and lets go on it, so the disc leaves the hand
// on an eighth note and the stab you hear is the throw you see.
//
// Everything is made from oscillators and one buffer of noise: no samples,
// nothing fetched. Times come from the audio clock and are scheduled ahead
// of playback -- setTimeout is far too loose to sequence from, and would
// swing every beat audibly.
(function () {
  "use strict";

  // The tempo holds. It used to wind up ten for every fighter knocked out
  // and drop back for the next round, which made every round a ramp and
  // every respawn a lurch; a record that keeps its tempo is one you can
  // settle into, and the fight has plenty of other ways to build.
  var BASE_BPM = 120;
  var bpm = BASE_BPM;
  var STEP = 60 / BASE_BPM / 2;    // the grid everything snaps to: eighths
  var LOOKAHEAD = 0.12;            // seconds of audio scheduled in advance
  var TICK = 25;                   // ms between runs of the scheduler
  var fighting = false;            // false between the deciding fall and the next round

  var ctx = null, master = null, notes = null, comp = null, noise = null;
  var sounding = [];               // every melodic voice currently ringing
  var step = 0, stepTime = 0, timer = null;
  var pending = [];                // kit events waiting for their slot
  var running = false;

  function mtof(m) { return 440 * Math.pow(2, (m - 69) / 12); }

  function makeNoise() {
    var n = Math.floor(ctx.sampleRate * 2.0);   // long enough for a crash to ring out
    var buf = ctx.createBuffer(1, n, ctx.sampleRate);
    var d = buf.getChannelData(0);
    for (var i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
    return buf;
  }

  // ── The kit ───────────────────────────────────────────────────────────
  function kick(t) {
    var o = ctx.createOscillator(), g = ctx.createGain();
    o.type = "sine";
    o.frequency.setValueAtTime(150, t);
    o.frequency.exponentialRampToValueAtTime(44, t + 0.09);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.95, t + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.30);
    o.connect(g); g.connect(master);
    o.start(t); o.stop(t + 0.32);
  }

  function snare(t) {
    // Noise for the rattle, a short tuned body under it.
    var s = ctx.createBufferSource(), hp = ctx.createBiquadFilter(), g = ctx.createGain();
    s.buffer = noise;
    hp.type = "highpass"; hp.frequency.value = 1500;
    g.gain.setValueAtTime(0.45, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.17);
    s.connect(hp); hp.connect(g); g.connect(master);
    s.start(t); s.stop(t + 0.2);

    var o = ctx.createOscillator(), g2 = ctx.createGain();
    o.type = "triangle";
    o.frequency.setValueAtTime(200, t);
    o.frequency.exponentialRampToValueAtTime(150, t + 0.08);
    g2.gain.setValueAtTime(0.32, t);
    g2.gain.exponentialRampToValueAtTime(0.0001, t + 0.11);
    o.connect(g2); g2.connect(master);
    o.start(t); o.stop(t + 0.13);
  }

  // Three toms, tuned low to high, each falling a little as it goes. Which
  // one a carom gets is not random: the fight says. The first thing a disc
  // hits is the high tom, the second -- or a shield turning it away -- the
  // middle one, and the last, including its arrival back in the hand, the
  // low one. A throw off a wall, past its target, off the glass and home
  // comes out as a descending fill that follows the disc.
  var TOMS = [[168, 96], [232, 134], [316, 188]];
  function tom(t, which) {
    var f = TOMS[which % TOMS.length];
    var o = ctx.createOscillator(), g = ctx.createGain();
    o.type = "triangle";
    o.frequency.setValueAtTime(f[0], t);
    o.frequency.exponentialRampToValueAtTime(f[1], t + 0.2);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.42, t + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.4);
    o.connect(g); g.connect(master);
    o.start(t); o.stop(t + 0.42);
  }

  // A crash, for a ring going out from under somebody: wide, bright, and
  // left to ring for a bar and a half.
  function crash(t) {
    var s = ctx.createBufferSource(), hp = ctx.createBiquadFilter(),
        bp = ctx.createBiquadFilter(), g = ctx.createGain();
    s.buffer = noise;
    hp.type = "highpass"; hp.frequency.value = 3800;
    bp.type = "bandpass"; bp.frequency.value = 7600; bp.Q.value = 0.55;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.40, t + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 1.5);
    s.connect(hp); hp.connect(bp); bp.connect(g); g.connect(master);
    s.start(t); s.stop(t + 1.55);
  }

  // A ride, for a fighter broken up: tighter than the crash, and metallic
  // rather than white -- a stack of squares at no sensible interval to each
  // other, which is how a cymbal was got out of an analogue box and is still
  // the cheapest way to make metal out of oscillators.
  var RIDE = [1047, 1481, 1899, 2411, 2917, 3413];
  function ride(t) {
    var hp = ctx.createBiquadFilter(), g = ctx.createGain();
    hp.type = "highpass"; hp.frequency.value = 5600;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.26, t + 0.003);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 1.0);
    hp.connect(g); g.connect(master);
    for (var i = 0; i < RIDE.length; i++) {
      var o = ctx.createOscillator();
      o.type = "square";
      o.frequency.value = RIDE[i];
      o.connect(hp);
      o.start(t); o.stop(t + 1.02);
    }
    var s = ctx.createBufferSource();          // a little air over the metal
    s.buffer = noise;
    s.connect(hp);
    s.start(t); s.stop(t + 1.02);
  }

  // A hat: noise through a high-pass, a tick when closed and a hiss when
  // open. The open one on every off-beat is most of what turns four kicks a
  // bar into a groove rather than a metronome.
  function hat(t, open) {
    var s = ctx.createBufferSource(), hp = ctx.createBiquadFilter(), g = ctx.createGain();
    s.buffer = noise;
    hp.type = "highpass"; hp.frequency.value = 7000;
    var len = open ? 0.16 : 0.04;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(open ? HAT_OPEN : HAT_CLOSED, t + 0.002);
    g.gain.exponentialRampToValueAtTime(0.0001, t + len);
    s.connect(hp); hp.connect(g); g.connect(master);
    // A different stretch of the noise each time, or every hat is one hat.
    s.start(t, Math.random() * 1.5); s.stop(t + len + 0.01);
  }

  // ── Keeping hold of what rings ────────────────────────────────────────
  // Everything melodic is registered here, because a note that has been
  // scheduled is otherwise beyond reach: the web audio graph will play it
  // whatever happens next, and what happens next may be that the fight it
  // belonged to ended.
  // The pad and the bass are the groove, not the fight, and are marked so:
  // the end of a round cuts the fighters' riffs and leaves the groove alone.
  function keep(g, os, end, groove) {
    sounding.push({ g: g, os: os, end: end, groove: !!groove });
    if (sounding.length > 160) {
      var now = ctx.currentTime;
      sounding = sounding.filter(function (v) { return v.end > now; });
    }
  }

  // The fighters' riffs stop, now. A round is over the moment the last of a
  // side falls, and a riff still going over the result is a fight carrying
  // on after it has been decided. Everything else plays on -- kit, hats,
  // bass and pad are the record, not the argument, and the record does not
  // stop for a respawn. A hit that has already
  // landed still sounds, so kit events waiting for their slot stay -- the
  // deciding derez is queued for the grid, the round ends before its slot
  // comes round, and emptying the queue here once took its cymbal with it.
  function cutAll() {
    if (!ctx) return;
    var t = ctx.currentTime, groove = [];
    for (var i = 0; i < sounding.length; i++) {
      var v = sounding[i];
      if (v.groove) { if (v.end > t) groove.push(v); continue; }
      try {
        v.g.gain.cancelScheduledValues(t);
        v.g.gain.setValueAtTime(Math.max(0.0001, v.g.gain.value), t);
        v.g.gain.linearRampToValueAtTime(0.0001, t + 0.02);   // 20ms, so it does not click
        for (var k = 0; k < v.os.length; k++) {
          try { v.os[k].stop(t + 0.03); } catch (e) { /* already stopped */ }
        }
      } catch (e) { /* node already finished */ }
    }
    sounding = groove;
    reserved = [];
    pending = pending.filter(function (e) { return e.kind !== "stab" && e.kind !== "phrase"; });
  }

  // ── The harmony ───────────────────────────────────────────────────────
  // D# natural minor, and four chords in it, two bars each. Which four is
  // picked fresh every round from PROGS, so the ground under one round is
  // not the ground under the last. Everything below is written in degrees
  // of SCALE, so it follows if the scale is changed.
  var ROOT = 27;                                   // D#1
  var SCALE = [0, 2, 3, 5, 7, 8, 10];              // D# E# F# G# A# B C#
  // Each chord's root, as a degree.
  var PROGS = [
    [0, 5, 2, 6],                                  // i VI III VII: D#m B F# C#, the trailer's walk
    [0, 6, 5, 6],                                  // i VII VI VII: D#m C# B C#, the minor-key lift
    [0, 3, 5, 4],                                  // i iv VI v: D#m G#m B A#m, darker
    [0, 5, 3, 4]                                   // i VI iv v: D#m B G#m A#m
  ];
  var BARS_PER_CHORD = 2;
  var TRIAD = [0, 2, 4];
  // The riff's notes, as steps above the chord's root: root, third, fifth,
  // octave, the third above that and the fifth above that. Every one is in
  // the chord, so however a riff is entered it never argues with what is
  // under it.
  var TONES = [0, 2, 4, 7, 9, 11];

  function degree(d) {
    var n = SCALE.length;
    var oct = Math.floor(d / n), i = d - oct * n;
    if (i < 0) { i += n; oct -= 1; }
    return SCALE[i] + 12 * oct;
  }

  // The levels are set by ear on paper only, until somebody listens.
  // Everything goes into one compressor, set to glue the kit.
  var PAD_GAIN = 0.05;
  var BASS_GAIN = 0.26;
  var RIFF_GAIN = 0.11;
  var STAB_GAIN = 0.09;
  var HANG_GAIN = 0.06;
  var HAT_CLOSED = 0.05, HAT_OPEN = 0.09;
  var DUCK = 0.6;                  // the bed gives way this much on every kick
  var PAD_LP = 900, PAD_LP_BUILD = 2500;
  var DETUNE = 0.4;                // Hz either side; the slow beating is the shimmer

  // ── The riffs ─────────────────────────────────────────────────────────
  // Sixteen sixteenths through the chord. Each entry is one of TONES, or -1
  // for a rest; the rests are as much of a riff as the notes. There are
  // thirty-six, so a fight of six is six tunes, and each fighter has one,
  // and it is read against the bar rather than from its own first
  // step, so a throw on the off-beat comes in partway through its riff and
  // every riff keeps its accents where they belong however it is entered.
  var RIFFS = [
    [0, -1, 2, 3, -1, 2, -1, 1, 0, -1, 2, 3, -1, 2, 1, -1],       // the first one
    [3, -1, 2, -1, 0, -1, 2, -1, 3, -1, 2, 0, -1, 1, 2, -1],
    [0, 0, 2, -1, 3, -1, 2, 0, -1, 0, 2, -1, 3, 2, 1, -1],
    [0, 2, 3, 4, 3, 2, 0, 2, 3, 4, 3, 2, 0, -1, 1, -1],            // climbing and back
    [-1, -1, 3, -1, -1, -1, 3, -1, -1, -1, 3, -1, -1, 2, -1, 1],   // off-beat pumps
    [0, -1, -1, 0, -1, -1, 2, -1, -1, 2, -1, -1, 3, -1, 1, -1],    // three, three, two
    [0, 2, 3, 2, 0, 2, 3, 2, 0, 2, 4, 2, 0, 2, 3, 1],              // rolling sixteenths
    [3, 3, -1, 2, -1, -1, -1, -1, 1, 1, -1, 0, -1, 2, -1, -1],     // call, then answer
    [0, 3, 0, 3, -1, 3, 0, 3, 0, 3, -1, 3, 2, 3, 1, 3],            // octave bounce
    [2, -1, -1, -1, -1, -1, 1, -1, -1, -1, -1, -1, 0, -1, -1, -1], // a slow hook, held
    [4, -1, 3, -1, 2, -1, 3, -1, 4, -1, 3, -1, 2, 1, 0, -1],       // falling from the top
    [0, -1, 1, 2, -1, 3, -1, 2, -1, 1, -1, 0, -1, -1, 2, -1],
    [0, -1, 0, -1, 2, -1, 0, -1, 3, -1, 2, -1, 1, -1, 0, -1],      // walking eighths
    [3, -1, -1, 3, -1, -1, 2, -1, 3, -1, -1, 3, -1, -1, 4, -1],    // octave, pushed
    [0, 1, 2, 1, 0, 1, 2, 3, 2, 1, 0, 1, 2, -1, -1, -1],           // turning sixteenths
    [5, -1, 3, -1, 5, -1, 3, -1, 4, -1, 2, -1, 3, -1, -1, -1],     // up high
    [0, -1, -1, -1, 3, -1, -1, -1, 2, -1, -1, -1, 1, -1, -1, -1],  // four on the beat, falling
    [-1, 0, -1, 0, -1, 2, -1, 2, -1, 3, -1, 3, -1, 2, -1, 1],      // all off the beat
    [0, 0, -1, 0, 0, -1, 0, -1, 2, 2, -1, 2, 3, -1, 1, -1],        // stutter
    [3, 2, 3, -1, 3, 2, 3, -1, 4, 3, 4, -1, 2, -1, 0, -1],         // trill and drop
    [0, -1, 2, -1, 3, -1, 5, -1, 3, -1, 2, -1, 0, -1, -1, -1],     // up the chord and down
    [-1, -1, -1, -1, 0, 2, 3, 4, -1, -1, -1, -1, 4, 3, 2, 0],      // run up, run down
    [2, -1, -1, 1, -1, -1, 0, -1, 2, -1, -1, 1, -1, -1, 3, -1],    // three, three, two, sung
    [0, 3, -1, 0, 3, -1, 0, 3, -1, 0, 3, -1, 2, -1, 1, -1],        // octaves across the bar
    [4, 4, -1, 3, -1, 2, -1, -1, 3, 3, -1, 2, -1, 0, -1, -1],      // two sighs
    [0, -1, 1, -1, 2, -1, 3, -1, 4, -1, 5, -1, 4, -1, 2, -1],      // ladder
    [-1, 3, -1, -1, 3, -1, -1, 3, -1, -1, 3, -1, 2, -1, -1, -1],   // stabs between the beats
    [0, 2, -1, 2, 0, 2, -1, 2, 1, 3, -1, 3, 1, 3, -1, 3],          // two and two
    [5, 4, 3, 2, 1, 0, -1, -1, 5, 4, 3, 2, 1, 0, -1, -1],          // cascade
    [0, -1, -1, 2, -1, -1, 3, -1, -1, -1, -1, -1, -1, -1, -1, -1], // said once
    [3, -1, 0, -1, 3, -1, 0, -1, 3, -1, 0, -1, 2, -1, 1, -1],      // octave rock
    [0, 1, 0, -1, 2, 3, 2, -1, 3, 4, 3, -1, 2, 1, 0, -1],          // turns, climbing
    [-1, -1, 0, 2, -1, -1, 3, 2, -1, -1, 0, 2, -1, -1, 4, 3],      // pickups
    [2, -1, 2, -1, 2, -1, 1, -1, 0, -1, 0, -1, 0, -1, -1, -1],     // repeated, falling
    [0, -1, 3, 2, -1, 0, -1, 3, 2, -1, 0, -1, 3, -1, 2, -1],       // tumbling
    [4, -1, -1, -1, 3, -1, -1, -1, 2, -1, -1, -1, 3, -1, 4, -1]    // a slow tune
  ];
  // Each side plays its fighters' riffs its own way: the programs high, on a
  // pair of saws held legato; the sentinels an octave down on a square,
  // clipped short. One riff a side at a time -- a throw from the same side
  // takes over from whatever its side was playing -- and the two sides can
  // overlap, high against low.
  var SIDES = [
    { base: ROOT + 36, wave: "sawtooth", gate: 0.85 },   // D#4
    { base: ROOT + 24, wave: "square", gate: 0.45 }      // D#3
  ];
  // Every fourth bar the riff's last beat is changed, the way a house record
  // marks the end of a phrase instead of running the loop straight through:
  // the same notes an octave up, a beat of nothing, or a run down or up into
  // the next bar. null is "the same notes, an octave up".
  var FILLS = [null, [-1, -1, -1, -1], [3, 2, 1, 0], [0, 1, 2, 3]];

  // Basslines, dealt a pair a round, turning over every eight bars. 1 the
  // root, 2 its octave, 3 its fifth, 0 nothing; a note is held up to the next
  // one and then gated, so a long gap is a long note.
  var BASSES = [
    { gate: 0.45, steps: [1, 0, 2, 1, 0, 1, 2, 0, 1, 0, 2, 1, 0, 2, 1, 2] },   // octaves, driving
    { gate: 0.5,  steps: [1, 0, 1, 0, 2, 0, 1, 0, 1, 0, 1, 0, 2, 0, 3, 0] },   // straight eighths
    { gate: 0.8,  steps: [1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 3, 0, 2, 0] },   // syncopated
    { gate: 0.9,  steps: [1, 0, 0, 0, 0, 0, 0, 0, 3, 0, 0, 0, 2, 0, 0, 0] }    // long, under a busy riff
  ];

  var bed = null;                  // its own bus, so the kick can push it down
  var bedBar = -1, chord = 0, variation = 0;
  // What this round was dealt: a progression, a pair of basslines, and the
  // fill the next fourth bar ends on.
  var prog = PROGS[0], basses = [0, 1], fill = 0;
  // The riff each side is playing, if any: whose, which, and how many
  // sixteenths of it are left.
  var phrases = [null, null];
  // How much is going on: each throw, block, ring and fall adds to it, and
  // it drains away an eighth at a time. It is what the riff's filter opens
  // to, so a flurry of throws sweeps it bright and a lull lets it close.
  var heat = 0, HEAT_DECAY = 0.93;
  var lastStand = false, building = false;
  var onEdge = {};                 // everybody hanging off a ring edge
  var padFilters = [];             // the pad now ringing, so a build can open it mid-chord
  var reserved = [];               // throws already given a slot on the grid
  var lastStab = -1;
  var stats = { chords: 0, bass: 0, riff: 0, phrases: 0, stabs: 0, synced: 0, ducks: 0, builds: 0 };

  function chordRoot() { return prog[chord]; }

  function pick(n) { return Math.floor(Math.random() * n); }

  // A new round, a new hand: a progression and two basslines. The riffs
  // are the fighters', and they keep them. The groove never stops, so a new
  // hand is not played the moment it is dealt -- a progression swapped
  // mid-chord would put the bass under one chord and the pad on another.
  // It waits for the next chord change and starts there, from the top.
  var dealt = null, progFrom = 0;
  function dealRound() {
    var b0 = pick(BASSES.length), b1 = (b0 + 1 + pick(BASSES.length - 1)) % BASSES.length;
    dealt = { prog: PROGS[pick(PROGS.length)], basses: [b0, b1] };
  }

  // ── Whose riff is whose ───────────────────────────────────────────────
  // A name is hashed to a riff, and the answer is written down, so the same
  // name always plays the same riff: a champion carries its riff into the
  // next round, and one fielded from the Hall comes back with it. The book
  // is kept in the browser alongside the Hall.
  //
  // No two fighters in a round play the same riff -- that would make two of
  // them one voice. The first to throw claims theirs; anyone after whose
  // riff is already taken borrows the next free one for the round and keeps
  // its own in the book. A champion is never the one who moves: if a new
  // program got there first, it is the program that is moved on.
  var BOOK_KEY = "discwars.riffs";
  var book = {}, claimed = {};                     // name -> riff: for good, and this round
  try { book = JSON.parse(localStorage.getItem(BOOK_KEY) || "{}") || {}; } catch (e) { book = {}; }

  function hashName(name) {
    var h = 2166136261;
    for (var i = 0; i < name.length; i++) { h ^= name.charCodeAt(i); h = Math.imul(h, 16777619); }
    return h >>> 0;
  }

  function riffFor(name, champion) {
    name = name || "?";
    if (claimed[name] != null) return claimed[name];
    var own = book[name];
    if (own == null || own >= RIFFS.length) {
      own = hashName(name) % RIFFS.length;
      book[name] = own;
      try { localStorage.setItem(BOOK_KEY, JSON.stringify(book)); } catch (e) { /* private window: this visit only */ }
    }
    var holder = null;
    for (var n in claimed) if (claimed.hasOwnProperty(n) && claimed[n] === own) holder = n;
    var mine = own;
    if (holder !== null && champion) {
      delete claimed[holder];                      // the champion keeps its riff; the other moves
    } else if (holder !== null) {
      var used = {};
      for (n in claimed) if (claimed.hasOwnProperty(n)) used[claimed[n]] = true;
      for (var k = 1; k < RIFFS.length && used[mine]; k++) mine = (own + k) % RIFFS.length;
    }
    claimed[name] = mine;
    return mine;
  }

  // A fighter's throw: its riff, for a bar, from this eighth.
  function startPhrase(team, name, champion) {
    phrases[team] = { team: team, name: name, riff: riffFor(name, champion), left: 16 };
    stats.phrases++;
  }

  // The riff a phrase is playing at sixteenth s of the bar, with this bar's fill.
  function riffAt(riff, s, fillBar) {
    var r = RIFFS[riff];
    if (!fillBar || s < 12) return { tone: r[s], up: 0 };
    var f = FILLS[fill];
    if (!f) return { tone: r[s], up: 7 };          // an octave is seven degrees
    return { tone: f[s - 12], up: 0 };
  }

  // The pump: every kick pushes the bed down and lets it back up inside the
  // beat, so the chords and the riff breathe with the kit. The bed only;
  // ducking master would pump the kick itself.
  function duck(t) {
    var back = Math.min(0.22, STEP * 1.2);
    bed.gain.setValueAtTime(1, t);
    bed.gain.linearRampToValueAtTime(1 - DUCK, t + 0.006);
    bed.gain.linearRampToValueAtTime(1, t + back);
    stats.ducks++;
  }

  // One chord, struck once and held for its whole length: two sines a note,
  // a little apart, so it shimmers. Retriggered each bar, its slow attack
  // would swell every bar on its own.
  function padChord(t, dur) {
    var g = ctx.createGain(), lp = ctx.createBiquadFilter(), os = [];
    lp.type = "lowpass"; lp.Q.value = 0.5;
    lp.frequency.setValueAtTime(building ? PAD_LP_BUILD : PAD_LP, t);
    lp.connect(g); g.connect(bed);
    for (var i = 0; i < TRIAD.length; i++) {
      var f0 = mtof(ROOT + 24 + degree(chordRoot() + TRIAD[i]));
      for (var k = -1; k <= 1; k += 2) {
        var o = ctx.createOscillator();
        o.type = "sine";
        o.frequency.value = f0 + k * DETUNE;
        o.connect(lp); os.push(o);
      }
    }
    var lvl = PAD_GAIN / TRIAD.length;
    var atk = Math.min(0.4, dur * 0.3), rel = Math.min(0.6, dur * 0.3);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(lvl, t + atk);
    g.gain.setValueAtTime(lvl, t + dur - rel * 0.5);
    g.gain.linearRampToValueAtTime(0.0001, t + dur + rel);
    var off = t + dur + rel + 0.03;
    for (i = 0; i < os.length; i++) { os[i].start(t); os[i].stop(off); }
    keep(g, os, off, true);
    padFilters.push({ lp: lp, end: off });
    stats.chords++;
  }

  // Half square for presence, half sine for weight, short and on the grid.
  function bassNote(t, midi, dur) {
    var f0 = mtof(midi);
    var g = ctx.createGain(), lp = ctx.createBiquadFilter();
    var sq = ctx.createOscillator(), si = ctx.createOscillator();
    var sg = ctx.createGain(), ng = ctx.createGain();
    lp.type = "lowpass"; lp.Q.value = 2;
    lp.frequency.setValueAtTime(900, t);
    lp.frequency.exponentialRampToValueAtTime(300, t + dur);
    sq.type = "square"; sq.frequency.value = f0;
    si.type = "sine"; si.frequency.value = f0;
    sg.gain.value = 0.5; ng.gain.value = 0.6;
    sq.connect(sg); si.connect(ng); sg.connect(lp); ng.connect(lp);
    lp.connect(g); g.connect(bed);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(BASS_GAIN, t + 0.004);
    g.gain.exponentialRampToValueAtTime(BASS_GAIN * 0.5, t + dur * 0.7);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    var off = t + dur + 0.02;
    sq.start(t); si.start(t); sq.stop(off); si.stop(off);
    keep(g, [sq, si], off, true);
    stats.bass++;
  }

  // One step of the riff: an oscillator through a resonant lowpass whose
  // cutoff is the heat of the fight, with a little snap of filter at the
  // start of each note. That moving filter is the sound of the whole style.
  function riffNote(t, midi, dur, side) {
    var f0 = mtof(midi);
    var cut = 350 * Math.pow(2, 3.5 * Math.min(1, heat + (building ? 0.35 : 0)));
    var g = ctx.createGain(), lp = ctx.createBiquadFilter(), os = [];
    lp.type = "lowpass"; lp.Q.value = 7;
    lp.frequency.setValueAtTime(Math.min(cut * 2.5, 12000), t);
    lp.frequency.exponentialRampToValueAtTime(Math.max(cut, f0 * 1.2), t + Math.max(0.02, dur * 0.6));
    lp.connect(g); g.connect(bed);
    var n = side.wave === "sawtooth" ? 2 : 1;       // two saws a few cents apart: width
    for (var i = 0; i < n; i++) {
      var o = ctx.createOscillator();
      o.type = side.wave;
      o.frequency.value = f0 * (n > 1 ? Math.pow(2, (i ? 6 : -6) / 1200) : 1);
      o.connect(lp); os.push(o);
    }
    var lvl = RIFF_GAIN / (n > 1 ? 1.4 : 1);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(lvl, t + 0.003);
    g.gain.exponentialRampToValueAtTime(lvl * 0.6, t + dur * 0.8);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    var off = t + dur + 0.02;
    for (i = 0; i < os.length; i++) { os[i].start(t); os[i].stop(off); }
    keep(g, os, off);
    stats.riff++;
  }

  // A throw strikes the chord: three saws, the whole triad, cut short. A
  // block is the same chord an octave down and quieter -- the answer, not
  // the question. Never two on the same step: three fighters letting go
  // together is one hit, louder in the room but not in the mix.
  function stab(t, low) {
    if (Math.abs(t - lastStab) < 0.02) return;
    lastStab = t;
    var g = ctx.createGain(), lp = ctx.createBiquadFilter(), os = [];
    lp.type = "lowpass"; lp.Q.value = 3;
    lp.frequency.setValueAtTime(low ? 2400 : 5000, t);
    lp.frequency.exponentialRampToValueAtTime(low ? 500 : 900, t + 0.14);
    lp.connect(g); g.connect(notes);
    var base = low ? ROOT + 24 : ROOT + 36;
    for (var i = 0; i < TRIAD.length; i++) {
      var o = ctx.createOscillator();
      o.type = "sawtooth";
      o.frequency.value = mtof(base + degree(chordRoot() + TRIAD[i]));
      o.connect(lp); os.push(o);
    }
    var lvl = (low ? 0.6 : 1) * STAB_GAIN / TRIAD.length * 1.7;
    var len = low ? 0.14 : 0.2;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(lvl, t + 0.003);
    g.gain.exponentialRampToValueAtTime(0.0001, t + len);
    var off = t + len + 0.02;
    for (i = 0; i < os.length; i++) { os[i].start(t); os[i].stop(off); }
    keep(g, os, off);
    stats.stabs++;
  }

  // Somebody over the edge: the chord, arpeggiated high and quiet, once an
  // eighth for as long as anybody is hanging on. It is the one sound in the
  // arena that is held rather than struck, so it reads as somebody still
  // out there.
  function hangNote(t, k) {
    var m = ROOT + 48 + degree(chordRoot() + TRIAD[k % 3]);
    var o = ctx.createOscillator(), g = ctx.createGain();
    o.type = "triangle";
    o.frequency.value = mtof(m);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(HANG_GAIN, t + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.2);
    o.connect(g); g.connect(notes);
    o.start(t); o.stop(t + 0.22);
    keep(g, [o], t + 0.22);
  }

  // The build: a side down to its last fighter, or anybody hanging off an
  // edge -- in a duel nobody is ever down to their last, so the edge is the
  // only last stand a duel has. The pad opens up and the riff's filter
  // stops closing all the way.
  function setBuild(on, t) {
    if (on === building) return;
    building = on;
    if (on) stats.builds++;
    var live = [];
    for (var i = 0; i < padFilters.length; i++) {
      var p = padFilters[i];
      if (p.end <= t) continue;
      p.lp.frequency.setTargetAtTime(on ? PAD_LP_BUILD : PAD_LP, t, 0.4);
      live.push(p);
    }
    padFilters = live;
  }

  // What belongs to one round of the fight: who is playing what, how hot it
  // is, whether it is a last stand. The groove's own place in the record --
  // which bar, which chord -- carries straight on.
  function resetFight() {
    phrases = [null, null]; claimed = {};
    heat = 0; lastStand = false; onEdge = {}; reserved = [];
    if (ctx) setBuild(false, ctx.currentTime);
    dealRound();
  }

  // Only when Sound is switched on: the record from the top.
  function resetRecord() {
    bedBar = -1; chord = 0; variation = 0; progFrom = 0;
    building = false; padFilters = [];
    dealRound();
    prog = dealt.prog; basses = dealt.basses; dealt = null;
    resetFight();
    dealt = null;                                  // the first hand is already in play
  }

  // Once an eighth, from the clock, whether or not anybody is fighting.
  // When Sound comes on the record comes in a layer at a time: the pad and
  // closed hats on its first bar, the bass and the open hats on its second.
  // After that it runs, through rounds and respawns alike, and whatever
  // riffs the fighters' throws start are played over it.
  function arrange(t, eighth, n) {
    heat *= HEAT_DECAY;
    var edge = Object.keys(onEdge).length > 0;
    setBuild(fighting && (lastStand || edge), t);
    if (eighth === 0) {
      bedBar++;
      if (bedBar > 1 && (bedBar - 1) % 8 === 0) variation++;   // the other bassline
      if (bedBar % 4 === 3) fill = pick(FILLS.length);
      if (bedBar % BARS_PER_CHORD === 0) {
        if (dealt) {                               // a new round's hand, from its first chord
          prog = dealt.prog; basses = dealt.basses; dealt = null;
          progFrom = bedBar; variation = 0;
        }
        chord = ((bedBar - progFrom) / BARS_PER_CHORD) % prog.length;
        padChord(t, STEP * 8 * BARS_PER_CHORD);
      }
    }
    var off = eighth % 2 === 1;
    hat(t, off && bedBar >= 1);
    if (edge) hangNote(t, n);
    var six = STEP / 2;
    var fillBar = bedBar % 4 === 3;
    var hush = fillBar && FILLS[fill] && FILLS[fill][0] < 0;   // a beat of nothing
    var bass = BASSES[basses[variation % 2]];
    for (var k = 0; k < 2; k++) {
      var s = eighth * 2 + k, ts = t + k * six, len;
      var bn = bass.steps[s];
      // The bass drops out with the riff for a fill that is a beat of nothing.
      if (bedBar >= 1 && bn && !(hush && s >= 12)) {
        len = 1;
        while (len < 8 && s + len < 16 && !bass.steps[s + len]) len++;
        var up = bn === 2 ? 7 : bn === 3 ? 4 : 0;
        bassNote(ts, ROOT + 12 + degree(chordRoot() + up), six * len * bass.gate);
      }
      for (var team = 0; team < 2; team++) {
        var ph = phrases[team];
        if (!ph) continue;
        var rn = riffAt(ph.riff, s, fillBar);
        if (rn.tone >= 0) {
          // Held up to the next note of the riff, then gated, so a rest is
          // heard -- and never past the end of the phrase or the bar.
          len = 1;
          while (len < 6 && len < ph.left && s + len < 16 && riffAt(ph.riff, s + len, fillBar).tone < 0) len++;
          var side = SIDES[team];
          riffNote(ts, side.base + degree(chordRoot() + TONES[rn.tone] + rn.up), six * len * side.gate, side);
        }
        if (--ph.left <= 0) phrases[team] = null;
      }
    }
  }

  // ── The grid, for the fight ───────────────────────────────────────────
  // The first eighth on the grid at or after a moment. The scheduler is
  // always a little ahead, so the grid is known exactly up to stepTime and
  // carried on from there at the tempo it is at.
  function gridFrom(target) {
    if (target <= stepTime) return stepTime - Math.floor((stepTime - target) / STEP) * STEP;
    return stepTime + Math.ceil((target - stepTime) / STEP) * STEP;
  }

  // ── The clock ─────────────────────────────────────────────────────────
  function schedule() {
    var now = ctx.currentTime;
    while (stepTime < now + LOOKAHEAD) {
      var eighth = step % 8;                       // eight eighths to the bar
      if (eighth % 2 === 0) {
        kick(stepTime);                            // every beat: the pulse
        duck(stepTime);
        var b = eighth / 2;
        if (b === 1 || b === 3) snare(stepTime);   // two and four
      }
      // A throw that asked for this eighth starts its fighter's riff on it.
      for (var r = 0; r < reserved.length; r++) {
        var rv = reserved[r];
        if (!rv.struck && Math.abs(rv.t - stepTime) < 1e-4) {
          rv.struck = true;
          if (fighting) startPhrase(rv.team, rv.name, rv.champion);
        }
      }
      // So does one that did not ask, on the next eighth after it lands.
      for (var q = 0; q < pending.length; ) {
        if (pending[q].kind !== "phrase") { q++; continue; }
        var pq = pending.splice(q, 1)[0];
        if (fighting) startPhrase(pq.team, pq.name, pq.champion);
      }
      arrange(stepTime, eighth, step);

      // The kit answers on the next eighth. It is never dropped when the bar
      // is busy -- it is what the fight is doing -- but a pile-up is not
      // music, so past a point the oldest go.
      var fired = 0;
      while (pending.length && fired < 8) {
        var e = pending.shift();
        fired++;
        if (e.kind === "stab") { if (fighting) stab(stepTime, e.low); }
        else if (e.kind === "tom") tom(stepTime, e.tom);
        else if (e.kind === "crash") crash(stepTime);
        else if (e.kind === "ride") ride(stepTime);
      }
      if (pending.length > 24) pending.length = 0;
      step++;
      stepTime += STEP;
    }
  }

  // A browser will not resume an audio context in a background tab, and only
  // resumes one at all off a real interaction. Rather than deciding after a
  // fixed wait that it has refused -- resume is asynchronous, and that wait
  // can easily be the shorter of the two -- keep asking: whenever the tab
  // comes to the front, and on the next click anywhere. Once it takes, these
  // do nothing.
  function wake() {
    if (!ctx || ctx.state === "running") return;
    try {
      var r = ctx.resume();
      if (r && r.catch) r.catch(function () { /* still refused; we try again */ });
    } catch (e) { /* same */ }
  }

  var watching = false;
  function watchForPermission() {
    if (watching) return;
    watching = true;
    document.addEventListener("visibilitychange", function () {
      if (!document.hidden && running) wake();
    });
    window.addEventListener("pointerdown", function () { if (running) wake(); }, true);
    window.addEventListener("keydown", function () { if (running) wake(); }, true);
  }

  window.DiscWarsSound = {
    get on() { return running; },
    get bpm() { return bpm; },
    // Whether anything is actually coming out. A browser will not resume an
    // audio context except off a real click, and does not resume one in a
    // background tab at all, so wanting sound and having it are two
    // different questions and a control that conflates them lies.
    get live() { return running && !!ctx && ctx.state === "running"; },
    // What the track has played since the page opened, for checking it is there.
    get stats() {
      var o = {};
      for (var k in stats) if (stats.hasOwnProperty(k)) o[k] = stats[k];
      o.building = building; o.variation = variation;
      o.prog = PROGS.indexOf(prog);
      o.playing = phrases.map(function (p) { return p ? p.name + ":" + p.riff : null; });
      o.claimed = {};
      for (var n in claimed) if (claimed.hasOwnProperty(n)) o.claimed[n] = claimed[n];
      o.bassline = basses[variation % 2]; o.heat = +heat.toFixed(2);
      return o;
    },

    start: function () {
      var AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return false;
      if (!ctx) {
        ctx = new AC();
        comp = ctx.createDynamicsCompressor();     // glue, and a lid on pile-ups
        comp.threshold.value = -14;
        comp.ratio.value = 6;
        comp.attack.value = 0.004;
        comp.release.value = 0.12;
        master = ctx.createGain();
        master.gain.value = 0.55;
        master.connect(comp); comp.connect(ctx.destination);
        // The stabs go through a bus of their own, apart from the kit.
        notes = ctx.createGain();
        notes.gain.value = 1;
        notes.connect(master);
        // And the pad, bass and riff through another, which the kick ducks.
        bed = ctx.createGain();
        bed.gain.value = 1;
        bed.connect(master);
        noise = makeNoise();
      }
      wake();
      step = 0;
      bpm = BASE_BPM;
      STEP = 60 / bpm / 2;
      stepTime = ctx.currentTime + 0.08;
      pending = [];
      resetRecord();
      fighting = true;              // the first round counts too
      running = true;
      watchForPermission();
      if (timer) clearInterval(timer);
      timer = setInterval(schedule, TICK);
      schedule();
      return true;
    },

    stop: function () {
      running = false;
      if (timer) { clearInterval(timer); timer = null; }
      pending = []; reserved = [];
      if (ctx && ctx.state === "running") ctx.suspend();
    },

    // A fighter about to throw asks when to let go. `after` is how long its
    // wind-up takes, in real seconds; the answer is how long from now until
    // the release should happen, which is the first eighth on the grid that
    // the wind-up can reach. That eighth is held for the fighter's riff,
    // which the clock starts exactly on it -- not wherever the next frame
    // happens to fall, and in whatever chord is playing by then, since a
    // throw half a second off can land past a chord change. The time handed
    // back includes the audio's own delay to the speakers, so the disc leaves
    // the hand when the riff is heard. Nothing to wait for when nothing is
    // playing: then the answer is just `after`.
    syncThrow: function (after, team, name, champion) {
      if (!running || !ctx || ctx.state !== "running" || !fighting) return after;
      var now = ctx.currentTime;
      var t = gridFrom(now + after);
      reserved.push({ t: t, team: team, name: name, champion: !!champion, struck: false });
      if (reserved.length > 12) reserved.shift();
      stats.synced++;
      var lat = (ctx.baseLatency || 0) + (ctx.outputLatency || 0);
      return t - now + lat;
    },

    // What the fight has done to the shape of the round, rather than a note:
    // a fighter out turns the bassline over, and a side down to its last
    // fighter is a last stand.
    mark: function (kind, info) {
      if (kind === "out") {
        variation++;                               // the other bassline, now
        heat = Math.min(1, heat + 0.3);
        if (info && info.left === 1) lastStand = true;
      }
    },

    // Called by the fight.
    play: function (kind, info) {
      if (!running || !ctx) return;
      var team = (info && info.team) || 0;
      if (kind === "over") {                       // the last of a side is down
        fighting = false; cutAll(); resetFight();
        return;
      }
      if (kind === "round") { resetFight(); fighting = true; return; }
      if (kind === "hang") { if (fighting) onEdge[info.name] = true; return; }
      if (kind === "unhang") { delete onEdge[info.name]; return; }
      if (!fighting && (kind === "throw" || kind === "block")) return;
      if (kind === "throw") {
        heat = Math.min(1, heat + 0.35);
        // Already on the grid if the fighter asked when to let go.
        var now = ctx.currentTime;
        for (var i = 0; i < reserved.length; i++) {
          if (reserved[i].team === team && Math.abs(reserved[i].t - now) < 0.3) {
            reserved.splice(i, 1);
            return;
          }
        }
        pending.push({ kind: "phrase", team: team, name: info && info.name, champion: !!(info && info.champion) });
      } else if (kind === "block") {
        heat = Math.min(1, heat + 0.2);
        pending.push({ kind: "stab", low: true });
        pending.push({ kind: "tom", tom: info && info.tom != null ? info.tom : 1 });
      } else if (kind === "bounce" || kind === "home") {
        pending.push({ kind: "tom", tom: info && info.tom != null ? info.tom : 1 });
      } else if (kind === "ring") {
        heat = Math.min(1, heat + 0.25);
        pending.push({ kind: "crash" });
      } else if (kind === "derez") {
        heat = Math.min(1, heat + 0.4);
        pending.push({ kind: "ride" });
      }
    }
  };
})();
