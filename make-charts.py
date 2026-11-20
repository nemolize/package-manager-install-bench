"""Draw one chart of every result: a panel per scenario, bars grouped by tool and ordered small, medium, large.

uv run --with matplotlib python make-charts.py
"""
import json
import statistics
from collections import defaultdict
from pathlib import Path

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402
from matplotlib.colors import to_rgb  # noqa: E402
from matplotlib.patches import Patch  # noqa: E402

HERE = Path(__file__).resolve().parent
OUT = HERE / "charts"
SOURCES = {"small": "results/results.jsonl", "medium": "results/results-medium-large.jsonl", "large": "results/results-medium-large.jsonl"}
SCALES = [("small", "小", 0.45), ("medium", "中", 0.22), ("large", "大", 0.0)]
TOOLS = [
    ("npm", "npm", "#0072B2"),
    ("pnpm", "pnpm", "#E69F00"),
    ("bun", "bun", "#009E73"),
    ("yarn-classic", "yarn classic", "#7a7a7a"),
    ("yarn-berry", "Berry（既定）", "#CC79A7"),
    ("yarn-berry-nm", "Berry（nm）", "#D55E00"),
]
SCENARIOS = [
    ("clean install", lambda c: c["clean"]),
    ("lockfile only", lambda c: c["lockfile"]),
    ("warm cache", lambda c: c["warm"]),
    ("add then remove", lambda c: c["add"] + c["remove"]),
    ("run one script", lambda c: c["script"]),
]

plt.rcParams["font.family"] = ["Hiragino Sans GB", "Noto Sans CJK JP", "sans-serif"]
plt.rcParams["axes.unicode_minus"] = False


def shade(color, white):
    return tuple(c + (1 - c) * white for c in to_rgb(color))


def load():
    chains = defaultdict(dict)
    for scale, name in SOURCES.items():
        for line in (HERE / name).read_text().splitlines():
            r = json.loads(line)
            if r["kind"] == "timing" and r["scale"] == scale:
                chains[(scale, r["tool"], r["rep"])][r["step"]] = r["ms"] / 1000
    return chains


def main():
    chains = load()
    rows = []  # (label, color, key) top to bottom
    for tool, name, color in TOOLS:
        for scale, mark, white in SCALES:
            rows.append((f"{name} {mark}", shade(color, white), tool, scale))
    fig, axes = plt.subplots(2, 3, figsize=(14, 12.5))
    for ax, (label, f) in zip(axes.flat, SCENARIOS):
        stats = []
        for _, _, tool, scale in rows:
            v = sorted(f(c) for (s, t, _), c in chains.items() if s == scale and t == tool)
            assert len(v) == 10, (scale, tool, len(v))
            stats.append((statistics.median(v), v[0], v[-1]))
        top = max(s[2] for s in stats)
        ys = []
        y = 0.0
        for i in range(len(rows)):
            ys.append(y)
            y += 1.0 if (i + 1) % 3 else 1.55
        ymax = ys[-1]
        for (name, color, tool, scale), (med, lo, hi), yy in zip(rows, stats, ys):
            yp = ymax - yy
            ax.barh(yp, med, color=color, height=0.78)
            ax.plot([lo, hi], [yp, yp], color="#222222", lw=1.0, solid_capstyle="butt")
            ax.plot([lo, lo], [yp - 0.22, yp + 0.22], color="#222222", lw=1.0)
            ax.plot([hi, hi], [yp - 0.22, yp + 0.22], color="#222222", lw=1.0)
            text = f"{med:.2f}" if med >= 1 else f"{med:.3f}"
            ax.text(hi + top * 0.02, yp, text, va="center", fontsize=7.5, color="#222222")
        ax.set_yticks([ymax - yy for yy in ys])
        ax.set_yticklabels([r[0] for r in rows], fontsize=8)
        ax.set_xlim(0, top * 1.15)
        ax.set_ylim(-0.7, ymax + 0.7)
        ax.set_title(label, fontsize=11, loc="left")
        ax.tick_params(axis="x", labelsize=8)
        ax.spines[["top", "right"]].set_visible(False)
        ax.grid(axis="x", color="#dddddd", lw=0.6)
        ax.set_axisbelow(True)
    note = axes.flat[5]
    note.axis("off")
    note.text(0, 0.80, "棒：中央値（秒）\n線：最小から最大（10 回）\n小：three.js　中：pdf.js　大：Another Redis\n濃さが規模（薄い＝小、濃い＝大）\n\n場面ごとに横軸の長さが違います", fontsize=10, va="center", color="#222222", linespacing=1.7)
    handles = [Patch(facecolor=shade("#555555", w), label=f"{mark}（{n}）") for (_, mark, w), n in zip(SCALES, ["three.js", "pdf.js", "Another Redis"])]
    note.legend(handles=handles, loc="lower left", frameon=False, fontsize=10, title="規模の濃さ", title_fontsize=10, alignment="left")
    fig.suptitle("インストール時間（ツールごとに 小・中・大 の順）", fontsize=13, x=0.01, ha="left")
    fig.tight_layout(rect=(0, 0, 1, 0.97))
    OUT.mkdir(parents=True, exist_ok=True)
    fig.savefig(OUT / "all.png", dpi=120, facecolor="white")
    print(OUT / "all.png")


main()
