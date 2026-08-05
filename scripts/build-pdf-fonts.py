#!/usr/bin/env python3
"""
產生 PDF 匯出用的內嵌字型 public/fonts/NotoSansTC-{Regular,Bold}.ttf。

來源：node_modules/@fontsource/noto-sans-tc（Noto Sans TC, SIL OFL 1.1）。
fontsource 的 `chinese-traditional` subset 缺全形標點（（）：／＋等），
直接使用會讓 PDF 掉字，故這裡把繁中 subset 與所有含
U+2000–206F / U+3000–303F / U+FF00–FFEF / U+2010–2027 的 subset 合併成單一 TTF。

用法：python3 scripts/build-pdf-fonts.py
"""
import glob
from fontTools.ttLib import TTFont
from fontTools.merge import Merger

RANGES = [(0x2000, 0x206F), (0x3000, 0x303F), (0xFF00, 0xFFEF), (0x2010, 0x2027)]
SRC = "node_modules/@fontsource/noto-sans-tc/files"


def needed(cmap):
    return any(any(a <= c <= b for a, b in RANGES) for c in cmap)


for weight, out in (("400", "Regular"), ("700", "Bold")):
    files = [f"{SRC}/noto-sans-tc-chinese-traditional-{weight}-normal.woff",
             f"{SRC}/noto-sans-tc-latin-{weight}-normal.woff"]
    for p in sorted(glob.glob(f"{SRC}/noto-sans-tc-*-{weight}-normal.woff")):
        if "chinese-traditional" in p or "latin" in p:
            continue
        if needed(TTFont(p).getBestCmap()):
            files.append(p)
    tmp = []
    for i, p in enumerate(files):
        f = TTFont(p)
        f.flavor = None
        t = f"/tmp/pdffont-{weight}-{i}.ttf"
        f.save(t)
        tmp.append(t)
    merged = Merger().merge(tmp)
    merged.save(f"public/fonts/NotoSansTC-{out}.ttf")
    print(out, len(merged.getGlyphOrder()), "glyphs from", len(tmp), "subsets")
