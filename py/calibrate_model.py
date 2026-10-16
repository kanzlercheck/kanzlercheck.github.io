#!/usr/bin/env python3
"""Calibrates the win-probability model of the "299 Races" tab and writes the numbers to data/constituencies.json["model"].

  python py/calibrate_model.py            # re-estimate the noise levels from the 2017 / 2021 / 2025 results and polls, write them
  python py/calibrate_model.py --backtest # also replay 2021 -> 2025 (with and without state polls) and print how well it did

What is estimated (all on the log scale of a party's vote share, because a 1 % party and a 30 % party do not wobble by the same points):
  localSd[party]       how far one constituency strays from its state's swing (candidate effects, local issues)
  stateVarPerYear[p]   how far the swing of a whole state strays from the national swing, as a variance that grows with time
  natA, natB           how far the national poll average misses the national result: sd = sqrt(natA^2 + (natB / share)^2)
                       (a constant error in percentage points, plus a bit that scales with the share)
The projection itself (ratio swing, state-poll step, 2,000 simulations) runs in the browser (js/app.js); backtest() below is a line-for-line
Python twin of that logic, used only to validate it.  Needs numpy.
"""
import csv, datetime as dt, glob, json, math, os, sys
import numpy as np

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))   # repo root (this script lives in py/)
K = ["CDU/CSU", "AfD", "SPD", "Grüne", "Linke", "BSW", "FDP", "Sonstige"]     # Free Voters are folded into Sonstige, as on the site
M = len(K); BIG = [0, 1, 2, 3, 4, 6]                                            # parties that exist in all three elections
SETTINGS = {"halfLifeDays": 45, "maxAgeDays": 180, "refWindowDays": 120, "designEffect": 1.6, "houseSdPts": 1.2,
            "minSharePct": 2.0, "natSmoothDays": 10, "runs": 2000, "widen": 1.3}
# widen: every noise level is multiplied by this.  Chosen on the two replays below (2017->2021 and 2021->2025): the pooled log score is best between
# 1.3 and 1.5, 2021 -> 2025 hardly notices it, and 2017 -> 2021 (a very turbulent cycle) was overconfident without it.
LAND_OF = {"Baden-Wuerttemberg": "Baden-Württemberg", "Thueringen": "Thüringen"}
D = lambda s: dt.datetime.strptime(s, "%d.%m.%Y").date()
num = lambda x: float(x.replace(",", ".")) if x and x.strip() else None

def load():
    C = json.load(open(os.path.join(HERE, "data", "constituencies.json"), encoding="utf-8")); P = C["parties"]
    def merge(a):
        a = np.array(a, float); o = [a[P.index(k)] for k in K[:7]]; o.append(a[P.index("Sonstige")] + a[P.index("Freie Wähler")]); return np.array(o)
    wk = C["wk"]
    return C, wk, np.array([w["v"] for w in wk], float), np.array([w["land"] for w in wk]), \
        np.array([merge(w["s"]) for w in wk]), np.array([merge(w["p"]) for w in wk]), \
        np.array([merge(w["q"]) if w.get("q") else np.zeros(M) for w in wk]), np.array([bool(w.get("q")) for w in wk])

def project(Sb, Vw, T, L0=None, active=None):
    """Ratio swing: every party's base share is multiplied by one party-wide factor (plus optional per-constituency log offsets L0), shares are
    re-normalised in each constituency, and the factors are solved until the vote-weighted national total equals T (in %)."""
    act = np.ones(M, bool) if active is None else active
    L = np.log(np.maximum(Sb, .01) / 100) + (0 if L0 is None else L0); c = np.zeros(M)
    for _ in range(500):
        X = np.exp(L + c) * act; X /= X.sum(1, keepdims=True); nat = (Vw[:, None] * X).sum(0) / Vw.sum()
        d = np.where(act, np.log(np.maximum(T, 1e-9) / 100 / np.maximum(nat, 1e-12)), 0); c += .8 * d
        if np.abs(d).max() < 1e-7: break
    return X

def nat_share(S, V, idx=None):
    idx = np.arange(len(V)) if idx is None else idx; return (V[idx, None] * S[idx]).sum(0) / V[idx].sum()

# ---------- 1. noise levels from past elections ----------
def decompose(Sb, Se, V, land, idx, parties, active):
    """Move the earlier result to the TRUE national result, then split what is left into a state part and a local part."""
    idx = np.array(idx); T = nat_share(Se, V, idx); X = project(Sb[idx], V[idx], T, active=active); ls = land[idx]; out = {}
    for j in parties:
        ok = (Sb[idx, j] >= .5) & (Se[idx, j] >= .5)                      # e.g. no Green list in Saarland 2021: skip such cases
        e = np.log(np.maximum(Se[idx, j], .01) / 100) - np.log(np.maximum(X[:, j], 1e-9)); loc, bt = [], []
        for s in set(ls):
            m = (ls == s) & ok
            if m.sum() < 2: continue
            w = V[idx][m]; mu = np.average(e[m], weights=w); loc.append((np.average((e[m] - mu) ** 2, weights=w) * m.sum() / (m.sum() - 1), m.sum(), mu))
        lv = float(np.mean([l[0] for l in loc])); sv = float(np.mean([l[2] ** 2 - l[0] / l[1] for l in loc]))
        out[j] = (lv, max(sv, 0.0))
    return out

def calibrate():
    C, wk, V, land, S25, S21, S17, h17 = load()
    S17m = S17.copy(); S17m[:, 7] += S17m[:, 5]; S17m[:, 5] = 0                # BSW did not exist in 2017
    act17 = np.array([1, 1, 1, 1, 1, 0, 1, 1], bool)
    a = decompose(S21, S25, V, land, range(len(wk)), BIG, np.ones(M, bool)); b = decompose(S17m, S21 * np.array([1, 1, 1, 1, 1, 0, 1, 1]), V, land, np.where(h17)[0], BIG, act17)
    # 2017 -> 2021: S21's BSW share (zero anyway) is ignored
    dy = [(dt.date(2021, 9, 26) - dt.date(2017, 9, 24)).days / 365.25, (dt.date(2025, 2, 23) - dt.date(2021, 9, 26)).days / 365.25]
    local, svy = {}, {}
    for j in BIG:
        local[K[j]] = round(math.sqrt((a[j][0] + b[j][0]) / 2), 4); svy[K[j]] = round((a[j][1] + b[j][1]) / (dy[0] + dy[1]), 5)
    for d_ in (local, svy):                                                      # BSW has no history: use the average of the others
        d_["BSW"] = round(float(np.mean([d_[K[j]] for j in BIG])), 5)
    # national: 30-day poll average before each election vs the result
    rows = list(csv.DictReader(open(os.path.join(HERE, "data", "germanpolls.csv"), encoding="utf-8"))); errs = []
    for d0, S, idx in ((dt.date(2017, 9, 24), S17, np.where(h17)[0]), (dt.date(2021, 9, 26), S21, None), (dt.date(2025, 2, 23), S25, None)):
        res = nat_share(S, V, idx); sel = [r for r in rows if d0 - dt.timedelta(days=30) <= D(r["Datum"]) < d0]
        for j in range(7):
            v = [num(r.get(K[j], "") or "") for r in sel]; v = [x for x in v if x is not None]
            if v and res[j] >= 2 and np.mean(v) >= 2: errs.append((res[j], math.log(np.mean(v) / res[j])))
    sh = np.array([e[0] for e in errs]); er = np.array([e[1] for e in errs]); best = (1e9, 0, 0)
    for A in np.arange(.02, .2, .005):
        for B in np.arange(0, 4, .05):
            s2 = A ** 2 + (B / sh) ** 2; ll = float(np.sum(np.log(s2) + er ** 2 / s2))
            if ll < best[0]: best = (ll, A, B)
    # how much do state-poll gaps miss the truth beyond their sampling noise?  replay both transitions, compare the poll-implied state move with the
    # state move that really happened, and fit the extra variance (kappa) by maximum likelihood
    nat_, sp_ = read_national(), read_state_polls(); obs = []
    for Sb, Se, idxs, act, ref, today in ((S17m, S21, np.where(h17)[0], act17, dt.date(2017, 9, 24), dt.date(2021, 8, 27)),
                                         (S21, S25, np.arange(len(V)), np.ones(M, bool), dt.date(2021, 9, 26), dt.date(2025, 1, 24))):
        X = project(Sb[idxs], V[idxs], nat_share(Se, V, idxs), active=act); ls = land[idxs]
        for st in sorted(set(ls)):
            m = ls == st
            for j in BIG:
                ok = Sb[idxs][m, j] >= .5
                if ok.sum() < 2: continue
                tru = np.average((np.log(np.maximum(Se[idxs][m, j], .01) / 100) - np.log(np.maximum(X[m, j], 1e-9)))[ok], weights=V[idxs][m][ok])
                _, _, g, vg, _ = state_signal(sp_.get(st, []), nat_, j, today, ref, svy[K[j]], 0.0, raw=True)
                if g is not None: obs.append((g, vg, tru))
    og = np.array(obs); kb, best_ll = 0.0, 1e18
    for kap in np.arange(0, .12, .002):
        v = og[:, 1] + kap; ll = float(np.sum(np.log(v) + (og[:, 0] - og[:, 2]) ** 2 / v))
        if ll < best_ll: best_ll, kb = ll, float(kap)
    model = {"localSd": local, "stateVarPerYear": svy, "natA": round(float(best[1]), 3), "natB": round(float(best[2]), 2), "stateMismatchVar": round(kb, 3), "refDate": "2025-02-23",
             "settings": SETTINGS, "fit": {"nStateObservations": len(og), "nNationalErrors": len(er), "rmsNationalLogError": round(float(np.sqrt((er ** 2).mean())), 3)}}
    return C, model

# ---------- 2. the same projection as the browser runs, for validation ----------
def read_state_polls():
    out = {}
    for f in glob.glob(os.path.join(HERE, "state_polls", "*.csv")):
        slug = os.path.basename(f)[:-4]; recs = []
        for r in csv.DictReader(open(f, encoding="utf-8")):
            try: t = D(r["Datum"])
            except Exception: continue
            n = num(r.get("Befragtenanzahl", "") or "") or 1000
            recs.append((t, min(n, 2500), [num(r.get(k, "") or "") for k in K[:7]]))
        out[LAND_OF.get(slug, slug)] = sorted(recs, key=lambda x: x[0])
    return out

def read_national():
    rows = list(csv.DictReader(open(os.path.join(HERE, "data", "germanpolls.csv"), encoding="utf-8")))
    return sorted(((D(r["Datum"]), [num(r.get(k, "") or "") for k in K[:7]]) for r in rows), key=lambda x: x[0])

def nat_at(nat, t, j, bw):
    s = w = 0.0
    for d0, v in nat:
        dx = (d0 - t).days / bw
        if dx < -3: continue
        if dx > 3: break
        if v[j] is None: continue
        k = math.exp(-.5 * dx * dx); w += k; s += k * v[j]
    return s / w if w else None

def state_signal(recs, nat, j, today, ref, v1, kappa=0.0, S=SETTINGS, raw=False):
    """Returns (u, posterior variance): how much better/worse than the nation this state has moved since the reference date, in log shares, shrunk
    towards 0 in proportion to how noisy the state polls are.  See the long comment in js/app.js (stateSignal) for the reasoning."""
    prior = v1 * (today - ref).days / 365.25
    def win(center, span, one_sided):
        w = []
        for t, n, v in recs:
            age = (t - center).days
            if (one_sided and not (-span <= age <= 0)) or (not one_sided and abs(age) > span): continue
            if v[j] is None or v[j] < S["minSharePct"]: continue
            N = nat_at(nat, t, j, S["natSmoothDays"])
            if N is None or N < S["minSharePct"]: continue
            w.append((.5 ** (abs(age) / S["halfLifeDays"]), n, math.log(v[j]) - math.log(N), v[j], age))
        return w
    def stat(w):
        if len(w) == 0: return None
        R = np.array([x[0] for x in w]); n = np.array([x[1] for x in w]); g = np.array([x[2] for x in w]); sh = np.array([x[3] for x in w]); age = np.array([x[4] for x in w])
        W = R * n; G = (W * g).sum() / W.sum(); A = (W * sh).sum() / W.sum()
        vp = S["designEffect"] * A * (100 - A) * (R ** 2 * n).sum() / W.sum() ** 2 + S["houseSdPts"] ** 2 * (R ** 2).sum() / R.sum() ** 2
        return G, vp / A ** 2, float((R * np.abs(age)).sum() / R.sum()) / 365.25
    a, b = stat(win(today, S["maxAgeDays"], True)), stat(win(ref, S["refWindowDays"], False))
    if a is None or b is None: return (0.0, prior, None, None, prior) if raw else (0.0, prior)
    vg = a[1] + b[1] + v1 * (a[2] + b[2]) + kappa; g = a[0] - b[0]       # kappa = extra mismatch between a state-election gap and the federal one
    if raw: return g * prior / (prior + vg), prior * vg / (prior + vg), g, vg, prior
    return g * prior / (prior + vg), prior * vg / (prior + vg)

def simulate(X, Vw, lands, model, T, post, runs, seed=2029):
    """Win chances: national shock per party + state shock per (state, party) + local shock per (constituency, party)."""
    rng = np.random.default_rng(seed); n = len(Vw); states = sorted(set(lands)); si = np.array([states.index(l) for l in lands])
    f = model["settings"]["widen"]
    sdN = f * np.array([math.sqrt(model["natA"] ** 2 + (model["natB"] / max(T[j], 1)) ** 2) for j in range(M - 1)])
    sdL = f * np.array([model["localSd"][K[j]] for j in range(M - 1)]); sdS = f * np.array([[math.sqrt(post[s][j]) for j in range(M - 1)] for s in states])
    LX = np.log(np.maximum(X[:, :M - 1], 1e-9)); wins = np.zeros((n, M - 1))
    for _ in range(runs):
        z = LX + rng.normal(0, sdN) + (rng.normal(0, 1, (len(states), M - 1)) * sdS)[si] + rng.normal(0, 1, (n, M - 1)) * sdL
        wins[np.arange(n), z.argmax(1)] += 1
    return wins / runs

def backtest(model, use_state, base, actual, ref, today, V, land, wk_idx=None, runs=1000, active=None):
    nat = read_national(); sp = read_state_polls(); idx = np.arange(len(V)) if wk_idx is None else wk_idx
    Sb, Se, Vw, ls = base[idx], actual[idx], V[idx], land[idx]
    act = np.ones(M, bool) if active is None else active
    T = np.array([np.mean([v[j] for d0, v in nat if today - dt.timedelta(days=30) <= d0 <= today and v[j] is not None] or [0]) for j in range(7)]); T = np.append(T, 100 - T.sum()); T = T * act; T = T / T.sum() * 100
    states = sorted(set(ls)); post = {}; U = {}
    for s in states:
        post[s] = []; U[s] = []
        for j in range(M - 1):
            v1 = model["stateVarPerYear"][K[j]]; u, pv = state_signal(sp.get(s, []), nat, j, today, ref, v1, model["stateMismatchVar"]) if use_state else (0.0, v1 * (today - ref).days / 365.25)
            U[s].append(u); post[s].append(pv)
    L0 = np.zeros((len(idx), M)); [L0.__setitem__((ls == s, slice(0, M - 1)), np.array(U[s])) for s in states]
    X = project(Sb, Vw, T, L0=L0, active=act); pr = simulate(X, Vw, ls, model, T, post, runs)
    lead_true = Se[:, :M - 1].argmax(1); p_true = pr[np.arange(len(idx)), lead_true]; lead_pred = X[:, :M - 1].argmax(1)
    ci = np.clip(p_true, 1 / runs, 1)
    return {"leaderRight%": round(100 * (lead_pred == lead_true).mean(), 1), "meanLogScore": round(float(np.log(ci).mean()), 4),
            "brier": round(float(((pr - np.eye(M - 1)[lead_true]) ** 2).sum(1).mean()), 4), "shareMAE_pts": round(float(np.abs(X * 100 - Se)[:, BIG].mean()), 3),
            "expectedRight%": round(100 * float(pr.max(1).mean()), 1)}, pr, lead_true, U

def main(run_backtest=None, verbose=True):
    run_backtest = ("--backtest" in sys.argv) if run_backtest is None else run_backtest
    C, model = calibrate(); C["model"] = model
    if verbose: print(json.dumps(model, indent=1, ensure_ascii=False))
    def save(): json.dump(C, open(os.path.join(HERE, "data", "constituencies.json"), "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))
    save()
    if run_backtest:
        _, wk, V, land, S25, S21, S17, h17 = load(); S17m = S17.copy(); S17m[:, 7] += S17m[:, 5]; S17m[:, 5] = 0
        act17 = np.array([1, 1, 1, 1, 1, 0, 1, 1], bool); i17 = np.where(h17)[0]
        for label, args in (("2021 -> 2025", (S21, S25, dt.date(2021, 9, 26), dt.date(2025, 1, 24), V, land, None, 1000, None)),
                            ("2017 -> 2021", (S17m, S21, dt.date(2017, 9, 24), dt.date(2021, 8, 27), V, land, i17, 1000, act17))):
            for name, st in (("no state polls  ", False), ("with state polls", True)):
                r, pr, lt, U = backtest(model, st, *args)
                if verbose: print(label, name, r)
                if st: model.setdefault("validation", {})[label[-4:]] = {"leaderRightPct": float(r["leaderRight%"]), "expectedRightPct": float(r["expectedRight%"]), "n": int(len(pr))}
        r, pr, lt, U = backtest(model, True, S21, S25, dt.date(2021, 9, 26), dt.date(2025, 1, 24), V, land)
        bins = [0, .6, .8, .95, 1.01]; fav = pr.max(1); hit = pr.argmax(1) == lt; print("reliability, 2021 -> 2025 with state polls:") if verbose else None
        for lo, hi in zip(bins[:-1], bins[1:]):
            m = (fav >= lo) & (fav < hi)
            if m.sum() and verbose: print(f"  favourite given {int(lo*100)}-{int(min(hi,1)*100)}%: n={m.sum():3d}  predicted {100*fav[m].mean():.0f}%  actually won {100*hit[m].mean():.0f}%")
        save()
    return model

if __name__ == "__main__":
    main()
