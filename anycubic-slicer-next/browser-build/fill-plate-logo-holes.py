#!/usr/bin/env python3
# The Bambu printers' plate model without Bambu Lab's logo. profiles/BBL/bbl-3dp-*.stl (machine/*.json "bed_model") is a flat slab with holes cut through it; the logo
# is a PAIR of matching slanted holes at the front edge (y < 0, beside each other): X1/A1 front right, H2D/H2C/O1S front
# left and right. Those holes are filled (top and bottom faces closed, their side walls dropped); every other hole stays
# (the handle slot at the back, the A1 mini's round mount hole), so the plate keeps its outline, size and thickness.
# Edits the Bambu (or Orca) source tree in place, BEFORE the recipe packs profiles/BBL into b3d-bundle. Idempotent.
#   python3 fill-plate-logo-holes.py <resources dir>
import collections, glob, os, struct, sys

R = 4   # rounding of coordinates (mm) when matching vertices


def read(p):
    b = open(p, 'rb').read()
    if b[:5] == b'solid' and b'facet' in b[:400]: raise SystemExit(f'bed-model-fill: {p} is ascii, not handled')
    n = struct.unpack('<I', b[80:84])[0]
    tris = [struct.unpack('<12fH', b[84 + 50 * i:134 + 50 * i]) for i in range(n)]
    return b[:80], tris


def write(p, head, tris):
    out = [head, struct.pack('<I', len(tris))] + [struct.pack('<12fH', *t) for t in tris]
    tmp = p + '.tmp'; open(tmp, 'wb').write(b''.join(out)); os.replace(tmp, p)


def pts(t): return [tuple(round(c, R) for c in t[3 + 3 * j:6 + 3 * j]) for j in range(3)]


def loops_at(tris, z):
    """Boundary loops (xy) of the faces lying flat at height z."""
    E = collections.Counter()
    for t in tris:
        p = pts(t)
        if all(abs(q[2] - z) < 1e-3 for q in p):
            for a, c in ((0, 1), (1, 2), (2, 0)): E[frozenset((p[a][:2], p[c][:2]))] += 1
    adj = collections.defaultdict(list)
    for e, k in E.items():
        if k == 1: a, c = tuple(e); adj[a].append(c); adj[c].append(a)
    if any(len(v) != 2 for v in adj.values()): raise SystemExit('bed-model-fill: plate outline is not simple loops')
    seen, loops = set(), []
    for s in adj:
        if s in seen: continue
        loop, cur = [s], s; seen.add(s)
        while True:
            nx = [q for q in adj[cur] if q not in seen]
            if not nx: break
            cur = nx[0]; seen.add(cur); loop.append(cur)
        loops.append(loop)
    return loops


def area(l): return sum(l[i][0] * l[i - 1][1] - l[i - 1][0] * l[i][1] for i in range(len(l))) / -2   # >0 = counter-clockwise


def ear_clip(poly):
    """Triangles (index triples into poly, counter-clockwise) of a simple polygon."""
    P = list(poly) if area(poly) > 0 else list(reversed(poly))
    idx, out = list(range(len(P))), []
    cross = lambda o, a, b: (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])
    def inside(p, a, b, c): return cross(a, b, p) >= 0 and cross(b, c, p) >= 0 and cross(c, a, p) >= 0
    while len(idx) > 3:
        for k in range(len(idx)):
            i0, i1, i2 = idx[k - 1], idx[k], idx[(k + 1) % len(idx)]
            a, b, c = P[i0], P[i1], P[i2]
            if cross(a, b, c) <= 1e-12: continue
            if any(inside(P[j], a, b, c) for j in idx if j not in (i0, i1, i2) and P[j] not in (a, b, c)): continue
            out.append((a, b, c)); idx.pop(k); break
        else: raise SystemExit('bed-model-fill: hole polygon could not be cut into triangles')
    out.append(tuple(P[i] for i in idx))
    return out


def logo_holes(loops):
    outer = max(loops, key=lambda l: abs(area(l)))
    holes = [l for l in loops if l is not outer and min(q[1] for q in l) < 0]
    pair = []
    for h in holes:
        a, x = abs(area(h)), min(q[0] for q in h)
        if any(g is not h and abs(abs(area(g)) - a) < 0.01 * a and abs(min(q[0] for q in g) - x) < 25 for g in holes): pair.append(h)
    return pair


def fill(p):
    head, tris = read(p)
    zs = sorted({q[2] for t in tris for q in pts(t)})
    top, bot = zs[-1], zs[0]
    holes, under = logo_holes(loops_at(tris, top)), logo_holes(loops_at(tris, bot))
    if not holes and not under: return 0
    if len(holes) != len(under): raise SystemExit(f'bed-model-fill: {p}: {len(holes)} logo holes on top, {len(under)} underneath')
    # the holes' side walls go: every face reached from a hole's rim without crossing the flat top or bottom (upright,
    # banded or rounded, whatever the maker drew); the plate between two holes and the outer edge stay
    F = [pts(t) for t in tris]
    cap = [all(q[2] == top for q in f) or all(q[2] == bot for q in f) for f in F]
    by_edge = collections.defaultdict(list)
    for i, f in enumerate(F):
        for k in range(3): by_edge[frozenset((f[k - 1], f[k]))].append(i)
    rim = {frozenset(((*l[i - 1], z), (*l[i], z))) for ls, z in ((holes, top), (under, bot)) for l in ls for i in range(len(l))}
    todo = [i for e in rim for i in by_edge.get(e, []) if not cap[i]]
    gone = set(todo)
    while todo:
        f = F[todo.pop()]
        for k in range(3):
            for j in by_edge[frozenset((f[k - 1], f[k]))]:
                if j not in gone and not cap[j]: gone.add(j); todo.append(j)
    keep = [t for i, t in enumerate(tris) if i not in gone]
    for h in holes:
        for a, b, c in ear_clip(h): keep.append((0, 0, 1, a[0], a[1], top, b[0], b[1], top, c[0], c[1], top, 0))
    for h in under:
        for a, b, c in ear_clip(h): keep.append((0, 0, -1, a[0], a[1], bot, c[0], c[1], bot, b[0], b[1], bot, 0))
    left = logo_holes(loops_at(keep, top))
    if left: raise SystemExit(f'bed-model-fill: {p}: {len(left)} logo holes still open')
    E = collections.Counter(frozenset((x[i - 1], x[i])) for t in keep for x in [pts(t)] for i in range(3))
    if any(k != 2 for k in E.values()): raise SystemExit(f'bed-model-fill: {p}: the filled plate is not closed')
    write(p, head, keep)
    return len(holes)


res = sys.argv[1].rstrip('/')
files = sorted(glob.glob(res + '/profiles/BBL/bbl-3dp-*.stl'))
files = [f for f in files if not f.endswith('hotend.stl')]
if not files: raise SystemExit('bed-model-fill: no plate models under ' + res + '/profiles/BBL')
for f in files:
    n = fill(f)
    print('bed-model-fill:', os.path.basename(f), f'{n} logo holes filled' if n else '(already filled)')
