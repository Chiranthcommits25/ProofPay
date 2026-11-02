#!/usr/bin/env python3
"""Assemble the ProofPay Master Guide, auto-generate the TOC, render, verify."""
import html as htmllib
import json
import pathlib
import re
import subprocess
import sys

import pymupdf

ROOT = pathlib.Path.home() / "Desktop/Minor_2"
A = ROOT / "docs" / "guide_assets"
OUT = ROOT / "PROOFPAY_MASTER_GUIDE.pdf"
PARTS = [f"g{i}.html" for i in range(1, 11)]
WORK = pathlib.Path("/tmp/guide")
WORK.mkdir(exist_ok=True)

css = (A / "style.css").read_text()
body = "\n".join((A / p).read_text() for p in PARTS if (A / p).exists())

# ---- collect headings for the table of contents ----
def squash(text: str) -> str:
    """Lowercase alphanumerics only, so letterspacing, line breaks and
    punctuation in the rendered PDF cannot break heading lookup."""
    text = htmllib.unescape(re.sub(r"<[^>]+>", " ", text))
    return re.sub(r"[^a-z0-9]", "", text.lower())


# The cover title and the CONTENTS heading are not sections of the book, so they
# must not appear in the table of contents (the cover's own title listed as a
# numbered entry, and the contents page listing itself, are both nonsense).
scan_body = re.sub(r'<section class="cover">.*?</section>', "", body, flags=re.S)
scan_body = re.sub(r'<div class="toc-page">.*?</div>', "", scan_body, flags=re.S)

heads = []
for m in re.finditer(r"<(h1|h2)([^>]*)>(.*?)</\1>", scan_body, flags=re.S):
    txt = re.sub(r"<[^>]+>", " ", m.group(3))
    txt = htmllib.unescape(txt)
    txt = re.sub(r"\s+", " ", txt).strip()
    if not txt:
        continue
    heads.append((m.group(1), "lvl2" if m.group(1) == "h2" else "lvl1", txt))
print(f"headings: {len(heads)}", file=sys.stderr)

toc_rows = "\n".join(
    f'<tr class="{lvl}"><td>{t}</td><td class="p">{{{{P:h{i}}}}}</td></tr>'
    for i, (_, lvl, t) in enumerate(heads)
)
toc_table = (
    '<table class="toc"><thead><tr><th>Contents</th><th class="p">Page</th></tr></thead>'
    f"<tbody>{toc_rows}</tbody></table>"
)
body = body.replace("<!--TOC-->", toc_table)


def assemble(nums: dict) -> str:
    html = (
        '<!doctype html><html lang="en"><head><meta charset="utf-8">'
        "<title>ProofPay Master Guide</title>"
        f"<style>{css}</style></head><body>{body}</body></html>"
    )
    for key, page in nums.items():
        html = html.replace("{{P:%s}}" % key, str(page).rjust(2, "0"))
    html = re.sub(r"\{\{P:[^}]*\}\}", "00", html)
    target = A / "guide.html"
    target.write_text(html)
    return str(target)


def render(html_path: str, pdf_path: pathlib.Path) -> None:
    res = subprocess.run(["node", str(A / "render.mjs"), html_path, str(pdf_path)],
                         capture_output=True, text=True)
    if res.returncode != 0:
        raise SystemExit(f"render failed:\n{res.stdout}\n{res.stderr}")
    print(res.stdout.strip(), file=sys.stderr)


def page_texts(pdf_path):
    doc = pymupdf.open(pdf_path)
    return doc, [re.sub(r"\s+", " ", p.get_text()) for p in doc]


def locate(texts, start):
    flat = [squash(t) for t in texts]
    # Every heading is repeated inside the table of contents, so TOC pages must be
    # excluded: otherwise a front-matter heading ("How to use this book") matches
    # its own TOC row and is numbered with the page the TOC sits on.
    toc_pages = {pno for pno, t in enumerate(flat) if "contentspage" in t}
    found = {}
    for i, (_, _, title) in enumerate(heads):
        needle = squash(title)[:70]
        if not needle:
            continue
        # Front matter precedes the first module, so fall back to the whole book.
        for pno in list(range(start, len(flat))) + list(range(0, start)):
            if pno in toc_pages:
                continue
            if needle in flat[pno]:
                found[f"h{i}"] = pno + 1
                break
    return found


tmp = WORK / "pass.pdf"
render(assemble({}), tmp)
doc, texts = page_texts(tmp)

start = 0
for i, t in enumerate(texts):
    if squash(t).startswith("module1"):
        start = i
        break
if start == 0:
    raise SystemExit("could not find the first module page")

nums = locate(texts, start)
missing = [k for k in (f"h{i}" for i in range(len(heads))) if k not in nums]
print(f"located {len(nums)}/{len(heads)}; missing={missing[:6]}", file=sys.stderr)

for attempt in range(3):
    render(assemble(nums), tmp)
    doc, texts = page_texts(tmp)
    start = next(i for i, t in enumerate(texts) if squash(t).startswith("module1"))
    fresh = locate(texts, start)
    if fresh == nums:
        print(f"TOC stable after {attempt + 1} pass(es)", file=sys.stderr)
        break
    nums = {**nums, **fresh}
else:
    raise SystemExit("TOC did not stabilise")

render(assemble(nums), OUT)
doc, texts = page_texts(OUT)
full = " ".join(texts)

problems = []
placeholders = full.count("{{P:")
sparse = [i + 1 for i, t in enumerate(texts) if i > 1 and len(t.strip()) < 220]
toc_bad = {k: (v, locate(texts, start).get(k)) for k, v in nums.items() if locate(texts, start).get(k) != v}

if placeholders:
    problems.append(f"{placeholders} unresolved placeholders")
if sparse:
    problems.append(f"near-empty pages: {sparse}")
if toc_bad:
    problems.append(f"TOC mismatches: {list(toc_bad)[:5]}")
if doc.page_count < 40:
    problems.append(f"too short: {doc.page_count} pages")

flat_full = squash(full)
modules = [n for n in range(1, 18) if f"module{n}" in flat_full]
summary = {
    "pdf": str(OUT),
    "pages": doc.page_count,
    "bytes": OUT.stat().st_size,
    "text_chars": len(full),
    "modules_found": modules,
    "modules_missing": [n for n in range(1, 18) if n not in modules],
    "code_blocks": body.count("<pre"),
    "tables": body.count("<table"),
    "figures": 0,
    "qa_pairs": len(re.findall(r"Q\d{1,3}\.", full)),
    "toc_entries": len(nums),
    "problems": problems,
}
print(json.dumps(summary, indent=2))
if problems:
    sys.exit(1)
