// A fruit fly's mushroom body for every fighter.
//
// The wiring is real: the right-hemisphere mushroom body out of the FlyWire
// whole-brain connectome (mbdata.js) -- 344 projection neurons, 2,597
// Kenyon cells, 48 output neurons (MBONs) and 165 dopamine neurons, joined
// by the synapses actually counted between them. What is not real, because
// a connectome cannot say it, is how a disc fight reaches the fly and how
// the fly's answer reaches its limbs. Those two seams are ours, and they are
// kept as plain as possible:
//
//   in   Each fact about the exchange ("my disc is home", "it threw low last
//        time") is a smell. It lights a fixed handful of the fly's real
//        glomeruli, chosen by hashing the fact, so the same situation always
//        smells the same and different ones mostly smell different.
//
//   out  The 48 MBONs are dealt out among the moves on offer -- three aims,
//        three guards -- so every move is voiced by a few real output
//        neurons. A move's pull is how hard its MBONs are being driven.
//
// Between the two, nothing is invented. Projection neurons drive Kenyon
// cells through their real synapses; the APL neuron's feedback inhibition
// leaves only the most driven ~5% of Kenyon cells firing, which is what it
// does in the fly; those drive the MBONs through their real synapses.
//
// Learning is the fly's own rule, the three-factor one: a KC->MBON synapse
// changes only where the Kenyon cell was active (an eligibility trace that
// fades), the MBON's compartment got dopamine, and by how much dopamine came.
// How much dopamine each MBON can get is read off the real DAN->MBON wiring.
// A fresh fly has never had dopamine, so every learned weight starts at zero
// and every move pulls equally: it flails. What works is reinforced.
//
// The rewards, smallest to largest:
//   a success  -- a throw past the guard, a guard that covers it,
//                 or a ring taken out from under somebody              1
//   a knockout or a kill -- the opponent out of the round              5
//   a round won -- every brain on the winning side                    10
// A success is scored against what this fly has come to expect (a reward
// prediction error, which is what dopamine neurons report), so a move that
// usually works and fails this once is pushed down. The bigger two are
// bursts that arrive late, so they are shared back along the trace: the most
// recent moves get most of it.
(function () {
  "use strict";

  var D = window.FlyMB;
  if (!D) return;                                  // no fly: learn.js, or blind

  var MOVES = { aim: 3, guard: 3 };                // what a fly is asked
  var REWARD = { success: 1, knockout: 5, round: 10 };
  var SPARSE = 0.05;                               // fraction of KCs APL lets fire
  var GLOMS_PER_FACT = 3;
  var LR = 0.2;                                    // logit shift per unit of dopamine
  var CAP = 4;                                     // a synapse can only change so far
  var EPS = 0.12;                                  // still tries what it has stopped doing
  var TRACE = 40;                                  // decisions it can still credit
  var BURST = 0.25;                                // how hard a late burst teaches, per unit

  // ── The wiring, unpacked once ─────────────────────────────────────────
  var nPN = D.pnGlom.length, nKC = D.kcType.length, nM = D.mbonType.length;

  // Glomeruli: the units smells are written in.
  var glomNames = [], glomPNs = {};
  D.pnGlom.forEach(function (g, i) {
    if (!glomPNs[g]) { glomPNs[g] = []; glomNames.push(g); }
    glomPNs[g].push(i);
  });

  // PN -> KC, indexed by PN so a smell only touches what it reaches.
  var pnOut = [];
  for (var i = 0; i < nPN; i++) pnOut.push([]);
  for (i = 0; i < D.pnKc.length; i += 3) pnOut[D.pnKc[i]].push(D.pnKc[i + 1], D.pnKc[i + 2]);

  // KC -> MBON, indexed by KC: these are the synapses that learn.
  var nSyn = D.kcMbon.length / 3;
  var synM = new Int16Array(nSyn), synW = new Float32Array(nSyn);
  var kcStart = new Int32Array(nKC + 1);
  var byKc = [];
  for (i = 0; i < nKC; i++) byKc.push([]);
  for (i = 0; i < D.kcMbon.length; i += 3) byKc[D.kcMbon[i]].push(D.kcMbon[i + 1], D.kcMbon[i + 2]);
  var meanSyn = 0;
  for (i = 2; i < D.kcMbon.length; i += 3) meanSyn += D.kcMbon[i];
  meanSyn /= nSyn;
  var s = 0;
  for (i = 0; i < nKC; i++) {
    kcStart[i] = s;
    for (var j = 0; j < byKc[i].length; j += 2) {
      synM[s] = byKc[i][j];
      synW[s] = byKc[i][j + 1] / meanSyn;          // real synapse count, ~1 on average
      s++;
    }
  }
  kcStart[nKC] = s;
  byKc = null;

  // How much dopamine each MBON's compartment can get: the real DAN->MBON
  // synapses onto it, as a share of the most any MBON gets. Some MBONs have
  // almost none; they still learn, slowly, through the KCs' own DAN input.
  var danIn = new Float32Array(nM), top = 0;
  for (i = 0; i < D.danMbon.length; i += 3) danIn[D.danMbon[i + 1]] += D.danMbon[i + 2];
  for (i = 0; i < nM; i++) top = Math.max(top, danIn[i]);
  var danGain = new Float32Array(nM);
  for (i = 0; i < nM; i++) danGain[i] = 0.35 + 0.65 * Math.sqrt(danIn[i] / top);

  // Which DANs light up when an MBON is taught -- for drawing, nothing more.
  var mbonDans = [];
  for (i = 0; i < nM; i++) mbonDans.push([]);
  for (i = 0; i < D.danMbon.length; i += 3)
    if (D.danMbon[i + 2] >= 3) mbonDans[D.danMbon[i + 1]].push(D.danMbon[i]);

  // ── Moves, voiced by MBONs ────────────────────────────────────────────
  // Deal the MBONs out so every move is reached by about as many KC
  // synapses as every other -- otherwise a fresh fly would favour whichever
  // move happened to get the best-connected neurons. Strongest first, each
  // to the move with the least so far. Deterministic: every fly is wired
  // the same way, as every fly of a species nearly is.
  var mbonIn = new Float32Array(nM);
  for (i = 0; i < nSyn; i++) mbonIn[synM[i]] += synW[i];
  var channels = [];                               // [{group, move, mbons, load}]
  Object.keys(MOVES).forEach(function (g) {
    for (var m = 0; m < MOVES[g]; m++) channels.push({ group: g, move: m, mbons: [], load: 0 });
  });
  var order = [];
  for (i = 0; i < nM; i++) order.push(i);
  order.sort(function (a, b) { return mbonIn[b] - mbonIn[a]; });
  var chanOf = new Int16Array(nM);
  order.forEach(function (m) {
    var best = 0;
    for (var c = 1; c < channels.length; c++) if (channels[c].load < channels[best].load) best = c;
    channels[best].mbons.push(m);
    channels[best].load += mbonIn[m];
    chanOf[m] = best;
  });
  function channel(group, move) {
    for (var c = 0; c < channels.length; c++)
      if (channels[c].group === group && channels[c].move === move) return c;
    return -1;
  }

  // ── Smell -> Kenyon cells ─────────────────────────────────────────────
  function hash(str) {
    var h = 2166136261;
    for (var k = 0; k < str.length; k++) { h ^= str.charCodeAt(k); h = Math.imul(h, 16777619); }
    return h >>> 0;
  }
  function glomsFor(fact) {
    var out = [], h = hash(fact);
    while (out.length < GLOMS_PER_FACT) {
      var g = glomNames[h % glomNames.length];
      if (out.indexOf(g) < 0) out.push(g);
      h = Math.imul(h ^ (h >>> 15), 2246822519) >>> 0;
    }
    return out;
  }

  // Every fly has the same wiring, so the same smell lights the same KCs
  // in all of them: worked out once and kept.
  var cache = {}, cached = 0;
  var kcK = Math.round(nKC * SPARSE);
  function smell(facts) {
    var key = facts.join("|");
    if (cache[key]) return cache[key];
    var pn = new Float32Array(nPN);
    facts.forEach(function (f) {
      glomsFor(f).forEach(function (g) {
        glomPNs[g].forEach(function (p) { pn[p] = 1; });
      });
    });
    var drive = new Float32Array(nKC);
    for (var p = 0; p < nPN; p++) {
      if (!pn[p]) continue;
      var o = pnOut[p];
      for (var k = 0; k < o.length; k += 2) drive[o[k]] += o[k + 1];
    }
    // APL: one inhibitory neuron fed by every KC and feeding back onto all
    // of them, so the more the layer is driven the higher the bar. Modelled
    // by its effect: only the most driven ~5% get over it.
    var idx = [];
    for (k = 0; k < nKC; k++) if (drive[k] > 0) idx.push(k);
    idx.sort(function (a, b) { return drive[b] - drive[a]; });
    var on = new Int32Array(idx.slice(0, kcK));
    var pnOn = [];
    for (p = 0; p < nPN; p++) if (pn[p]) pnOn.push(p);
    var r = { kcs: on, pns: pnOn };
    if (cached++ > 4000) { cache = {}; cached = 0; }
    cache[key] = r;
    return r;
  }

  // ── One fly ───────────────────────────────────────────────────────────
  function Brain() {
    this.p = new Float32Array(nSyn);               // learned: zero in a fresh fly
    this.trace = [];                               // recent decisions, newest last
    this.base = { aim: 0.5, guard: 0.5 };          // what it has come to expect
    this.decisions = 0;
    this.dopamine = 0;                             // all it has ever been given
    this.last = null;                              // for the readout
    this.lastDA = null;
    this.teacher = null;                           // the champion it learned from, if any
    this.mix ={ aim: [1 / 3, 1 / 3, 1 / 3], guard: [1 / 3, 1 / 3, 1 / 3] };
  }

  // How hard each MBON is driven by the KCs this smell lights.
  Brain.prototype.mbons = function (kcs) {
    var out = new Float32Array(nM);
    for (var a = 0; a < kcs.length; a++) {
      var k = kcs[a];
      for (var e = kcStart[k]; e < kcStart[k + 1]; e++) out[synM[e]] += synW[e] * this.p[e];
    }
    return out;
  };

  // Choose a move. `mask[m]` false rules it out (no blocking without a disc).
  // Returns the move, and remembers the choice so it can be paid for.
  Brain.prototype.decide = function (group, facts, mask) {
    var sm = smell([group].concat(facts));
    var drive = this.mbons(sm.kcs);
    var n = MOVES[group], z = [], hi = -Infinity, m;
    for (m = 0; m < n; m++) {
      if (mask && !mask[m]) { z.push(-Infinity); continue; }
      var c = channels[channel(group, m)], v = 0;
      for (var q = 0; q < c.mbons.length; q++) v += drive[c.mbons[q]];
      z.push(v);
      if (v > hi) hi = v;
    }
    var pr = [], sum = 0, avail = 0;
    for (m = 0; m < n; m++) {
      pr.push(z[m] === -Infinity ? 0 : Math.exp(z[m] - hi));
      sum += pr[m];
      if (z[m] !== -Infinity) avail++;
    }
    for (m = 0; m < n; m++) {
      pr[m] = z[m] === -Infinity ? 0 : (1 - EPS) * pr[m] / sum + EPS / avail;
    }
    var r = Math.random(), acc = 0, pick = n - 1;
    for (m = 0; m < n; m++) { acc += pr[m]; if (r < acc) { pick = m; break; } }
    while (pr[pick] === 0 && pick > 0) pick--;

    var d = { group: group, move: pick, kcs: sm.kcs, pns: sm.pns, probs: pr, drive: drive };
    this.trace.push(d);
    if (this.trace.length > TRACE) this.trace.shift();
    this.decisions++;
    this.last = d;
    // A slow average of what it plays, for the readout.
    var mix = this.mix[group];
    for (m = 0; m < n; m++) mix[m] += 0.08 * (pr[m] - mix[m]);
    return d;
  };

  // Something else chose -- a remembered combination, say. The fly still
  // made that move, and learns from it as its own.
  Brain.prototype.override = function (d, move) { if (d) d.move = move; };

  // Dopamine onto the compartments that voiced decision d's move, at the
  // synapses of the KCs that were active when it was made.
  Brain.prototype.teach = function (d, amount) {
    if (!d || !amount) return;
    var c = channels[channel(d.group, d.move)];
    var inChan = {};
    for (var q = 0; q < c.mbons.length; q++) inChan[c.mbons[q]] = true;
    // Spread so that one unit of dopamine moves this move's pull by about
    // LR in this situation, however many synapses that takes.
    var reach = 0, a, e, k;
    for (a = 0; a < d.kcs.length; a++) {
      k = d.kcs[a];
      for (e = kcStart[k]; e < kcStart[k + 1]; e++) if (inChan[synM[e]]) reach += synW[e] * synW[e];
    }
    if (!reach) return;
    var step = LR * amount / reach;
    for (a = 0; a < d.kcs.length; a++) {
      k = d.kcs[a];
      for (e = kcStart[k]; e < kcStart[k + 1]; e++) {
        var mb = synM[e];
        if (!inChan[mb]) continue;
        var v = this.p[e] + step * synW[e] * danGain[mb];
        this.p[e] = v > CAP ? CAP : v < -CAP ? -CAP : v;
      }
    }
    this.lastDA = { at: Date.now(), amount: amount, mbons: c.mbons.slice(), kcs: d.kcs };
  };

  // A success or a failure, against what this fly expects of that kind of
  // decision: the prediction error is what is taught.
  Brain.prototype.outcome = function (d, success) {
    if (!d) return;
    var r = success ? REWARD.success : 0;
    var err = r - this.base[d.group];
    this.base[d.group] += 0.04 * err;
    if (r) this.dopamine += r;
    this.teach(d, err);
  };

  // A late, large burst -- a knockout, a round -- shared back along what it
  // did on the way there, the most recent getting the most.
  Brain.prototype.burst = function (kind) {
    var amount = REWARD[kind] || 0;
    if (!amount || !this.trace.length) return;
    var fade = kind === "round" ? 0.88 : 0.55;
    var w = 1, total = 0, i;
    for (i = this.trace.length - 1; i >= 0; i--) { total += w; w *= fade; }
    w = 1;
    for (i = this.trace.length - 1; i >= 0 && w > 0.02; i--) {
      this.teach(this.trace[i], BURST * amount * w / total);
      w *= fade;
    }
    this.dopamine += amount;
    var last = this.trace[this.trace.length - 1];
    this.lastDA = { at: Date.now(), amount: amount, burst: kind,
                    mbons: channels[channel(last.group, last.move)].mbons.slice(), kcs: last.kcs };
  };

  // A round is over: what it was doing then has been paid for.
  Brain.prototype.clearTrace = function () { this.trace = []; };

  // A champion takes in what its winning teammates learned. Their learned
  // weights are added to its own, half-strength, so where they agree with
  // it the habit deepens and where they disagree it cancels out -- a lesson
  // the whole side learned counts for more than one fly's fluke. Only what
  // was learned moves across; the wiring is the same in every fly anyway.
  Brain.prototype.absorb = function (others) {
    var self = this;
    others.forEach(function (o) {
      if (!o || o === self) return;
      // Only what it learned for itself: a fly that started as a copy of
      // this champion would otherwise hand the champion back its own
      // lessons, and every round would double them.
      var from = o.origin;
      for (var e = 0; e < nSyn; e++) {
        var v = self.p[e] + 0.5 * (from ? o.p[e] - from[e] : o.p[e]);
        self.p[e] = v > CAP ? CAP : v < -CAP ? -CAP : v;
      }
      self.dopamine += o.dopamine;
      Object.keys(self.base).forEach(function (g) { self.base[g] = (self.base[g] + o.base[g]) / 2; });
    });
  };

  // A new fly that starts out knowing what its champion knows: the learned
  // weights and expectations, not the champion's history.
  Brain.prototype.taughtBy = function (mentor, name) {
    this.p.set(mentor.p);
    this.origin = new Float32Array(mentor.p);      // what it was given, kept apart from what it learns
    this.base = { aim: mentor.base.aim, guard: mentor.base.guard };
    this.mix = { aim: mentor.mix.aim.slice(), guard: mentor.mix.guard.slice() };
    this.teacher = name || null;
    return this;
  };

  // ── Keeping a fly ─────────────────────────────────────────────────────
  // Only what it learned needs keeping: the wiring is the same in every
  // fly. The learned weights go down as one signed byte each (steps of
  // CAP/127, finer than a single success moves them), base64 -- about 17 KB.
  Brain.prototype.save = function () {
    var q = new Int8Array(nSyn);
    for (var e = 0; e < nSyn; e++) q[e] = Math.max(-127, Math.min(127, Math.round(this.p[e] / CAP * 127)));
    var bin = "", u = new Uint8Array(q.buffer);
    for (var i = 0; i < u.length; i++) bin += String.fromCharCode(u[i]);
    return { v: 1, n: nSyn, p: btoa(bin), base: this.base, mix: this.mix,
             decisions: this.decisions, dopamine: this.dopamine, teacher: this.teacher };
  };
  function load(o) {
    var b = new Brain();
    if (!o || o.v !== 1 || o.n !== nSyn || typeof o.p !== "string") return b;   // a different fly: start over
    try {
      var bin = atob(o.p);
      for (var e = 0; e < nSyn && e < bin.length; e++) {
        var c = bin.charCodeAt(e);
        b.p[e] = (c > 127 ? c - 256 : c) / 127 * CAP;
      }
    } catch (err) { return new Brain(); }
    if (o.base) b.base = { aim: +o.base.aim || 0.5, guard: +o.base.guard || 0.5 };
    if (o.mix && o.mix.aim && o.mix.guard) b.mix = { aim: o.mix.aim.slice(0, 3), guard: o.mix.guard.slice(0, 3) };
    b.decisions = o.decisions | 0;
    b.dopamine = +o.dopamine || 0;
    b.teacher = o.teacher || null;
    return b;
  }

  window.FlyBrain = {
    Brain: Brain,
    load: load,
    REWARD: REWARD,
    channels: channels,
    chanOf: chanOf,
    mbonDans: mbonDans,
    data: D,
    sizes: { pn: nPN, kc: nKC, mbon: nM, dan: D.danType.length, synapses: nSyn },
    activeKCs: kcK
  };
})();
