# -*- coding: utf-8 -*-
"""상담 붙이기 — GFA 성과 + 상담·계약 기록 → 소재별 상담당·계약당 비용 대시보드 (1·2단계 탭)

사용법
  python 상담붙이기.py                                  # 샘플로 실행 (sample/ 폴더)
  python 상담붙이기.py <GFA보고서.csv> <상담기록.csv>     # 실제 파일 (private/ 폴더에 두기)
결과: out/대시보드.html (+ 화면에 요약)

입력 모양 (열 이름은 '뜻'으로 찾음 — 조금 달라도 됨)
  GFA 보고서: 날짜 · 캠페인 · 소재 · 노출 · 클릭 · 비용
  상담 기록 : 날짜 · 채널 · 상태 · (소재)   ← 이름·전화번호 같은 개인정보 칸은 읽지 않음
              채널이 '네이버'/'GFA'인 줄만 셈 · 상태에 '계약'이 들어가면 계약
              소재 칸이 없으면 소재별 상담은 '날짜별 클릭 비율'로 나눠 추정(표에 '추정' 표시)
표준 라이브러리만 씀 · 읽기만 하고 광고를 바꾸지 않음.
"""
import csv, html, io, sys, collections, datetime, re
from pathlib import Path

HERE = Path(__file__).resolve().parent
채널값 = ("네이버", "GFA", "gfa")
뜻 = {
    "날짜": ["일자", "날짜", "date"], "캠페인": ["캠페인"], "소재": ["소재", "광고 이름", "광고명"],
    "노출": ["노출"], "클릭": ["클릭"], "비용": ["비용", "광고비", "소진"],
    "채널": ["채널", "유입", "매체"], "상태": ["상태", "결과", "진행"],
}


def 읽기(path):
    raw = Path(path).read_bytes()
    for enc in ("utf-8-sig", "cp949"):
        try:
            rows = list(csv.reader(io.StringIO(raw.decode(enc))))
            break
        except UnicodeDecodeError:
            continue
    head = [h.strip() for h in rows[0]]
    m = {}
    for k, ws in 뜻.items():
        for w in ws:
            hit = [i for i, h in enumerate(head) if w in h and not any(x in h for x in ("률", "%", "당", "평균"))]
            if hit:
                m[k] = hit[0]
                break
    return [{k: (r[i].strip() if i < len(r) else "") for k, i in m.items()} for r in rows[1:] if any(r)]


def 날(s):
    t = re.search(r"(20\d\d)\D+(\d{1,2})\D+(\d{1,2})", s or "")
    return datetime.date(*map(int, t.groups())) if t else None


def 수(s):
    s = re.sub(r"[^\d.\-]", "", s or "")
    return float(s) if s not in ("", "-", ".") else 0.0


def 원(x):
    return f"{round(x):,}" if x else "—"


def 계산(gfa_rows, 상담_rows):
    성과 = collections.defaultdict(collections.Counter)     # (날짜, 소재) → 노출·클릭·비용
    for r in gfa_rows:
        d = 날(r.get("날짜"))
        if not d:
            continue
        이름 = " / ".join(x for x in (r.get("캠페인"), r.get("소재")) if x) or "전체"
        for k in ("노출", "클릭", "비용"):
            성과[(d, 이름)][k] += 수(r.get(k))
    상담 = collections.defaultdict(collections.Counter)     # (날짜, 소재 or None) → 상담·계약
    소재있음 = False
    for r in 상담_rows:
        if not any(v in r.get("채널", "") for v in 채널값):
            continue
        d = 날(r.get("날짜"))
        if not d:
            continue
        s = r.get("소재") or None
        소재있음 |= bool(s)
        상담[(d, s)]["상담"] += 1
        상담[(d, s)]["계약"] += "계약" in r.get("상태", "")
    소재표 = collections.defaultdict(collections.Counter)
    추정 = False
    for (d, 이름), c in 성과.items():
        소재표[이름].update(c)
        짧은 = 이름.split(" / ")[-1]
        if (d, 짧은) in 상담 or (d, 이름) in 상담:
            소재표[이름].update(상담.get((d, 짧은)) or 상담[(d, 이름)])
        elif (d, None) in 상담:                              # 소재 칸 없음 → 그날 클릭 비율로 나눔
            그날클릭 = sum(v["클릭"] for (dd, _), v in 성과.items() if dd == d) or 1
            몫 = c["클릭"] / 그날클릭
            소재표[이름]["상담"] += 상담[(d, None)]["상담"] * 몫
            소재표[이름]["계약"] += 상담[(d, None)]["계약"] * 몫
            추정 = True
    일별 = collections.defaultdict(collections.Counter)
    for (d, _), c in 성과.items():
        일별[d].update(c)
    for (d, _), c in 상담.items():
        일별[d].update(c)
    return 소재표, 일별, 추정 and not 소재있음


def 판정(c, 평균ctr):
    if c["상담"] < 2:
        return "판단 보류", "상담이 2건 미만"
    ctr = c["클릭"] / c["노출"] if c["노출"] else 0
    cvr = c["상담"] / c["클릭"] if c["클릭"] else 0
    if 평균ctr and ctr < 평균ctr * 0.6:
        return "소재", f"CTR {ctr*100:.2f}% (평균의 {ctr/평균ctr:.1f}배)"
    if cvr < 0.02:
        return "랜딩", f"클릭 중 상담 {cvr*100:.1f}%"
    return "—", f"CTR {ctr*100:.2f}% · 상담 비율 {cvr*100:.1f}%"


def 대시보드(소재표, 일별, 추정, 샘플):
    합 = collections.Counter()
    for c in 소재표.values():
        합.update(c)
    평균ctr = 합["클릭"] / 합["노출"] if 합["노출"] else 0
    줄 = []
    for 이름, c in sorted(소재표.items(), key=lambda x: (x[1]["비용"] / x[1]["계약"]) if x[1]["계약"] >= 0.5 else 9e12):
        막힌, 근거 = 판정(c, 평균ctr)
        줄.append(f"<tr><td>{html.escape(이름)}</td><td>{원(c['노출'])}</td><td>{원(c['클릭'])}</td>"
                 f"<td>{c['클릭']/c['노출']*100 if c['노출'] else 0:.2f}%</td><td>{원(c['비용'])}</td>"
                 f"<td>{c['상담']:.1f}</td><td>{c['계약']:.1f}</td>".replace(".0<", "<")
                 f"<td>{원(c['비용']/c['상담'] if c['상담'] else 0)}</td><td>{원(c['비용']/c['계약'] if c['계약'] >= 0.5 else 0)}</td>"
                 f"<td>{막힌}</td><td>{html.escape(근거)}</td></tr>")
    일 = "".join(f"<tr><td>{d}</td><td>{원(c['비용'])}</td><td>{원(c['클릭'])}</td><td>{int(c['상담'])}</td><td>{int(c['계약'])}</td>"
                f"<td>{원(c['비용']/c['상담'] if c['상담'] else 0)}</td></tr>" for d, c in sorted(일별.items()))
    표시 = "<p class=warn>샘플 데이터입니다. 실제 숫자가 아닙니다.</p>" if 샘플 else ""
    추정글 = "<p class=note>상담 기록에 소재 칸이 없어 소재별 상담·계약은 그날 클릭 비율로 나눈 <b>추정</b>입니다(소수점). UTM으로 소재를 남기면 정확해집니다.</p>" if 추정 else ""
    return f"""<!doctype html><html lang=ko><meta charset=utf-8><meta name=viewport content="width=device-width,initial-scale=1">
<title>상담 붙이기</title><style>
:root{{--bg:#fff;--fg:#1d2433;--line:#dde3ea;--soft:#f4f6f9;--warn:#b54708}}
@media(prefers-color-scheme:dark){{:root{{--bg:#14171c;--fg:#e6e9ef;--line:#2c323b;--soft:#1c2027;--warn:#f79009}}}}
body{{margin:0;padding:16px;background:var(--bg);color:var(--fg);font:15px/1.5 system-ui,sans-serif}}
h1{{font-size:20px}} .wrap{{overflow-x:auto}} table{{border-collapse:collapse;min-width:720px;width:100%}}
th,td{{border-bottom:1px solid var(--line);padding:6px 8px;text-align:right;white-space:nowrap}} th:first-child,td:first-child{{text-align:left}}
th{{background:var(--soft)}} .warn{{color:var(--warn);font-weight:600}} .note{{opacity:.8}} .kpi{{display:flex;gap:12px;flex-wrap:wrap}}
.kpi div{{background:var(--soft);padding:10px 14px;border-radius:8px}} .kpi b{{display:block;font-size:20px}}
</style><h1>상담 붙이기 — 소재별 상담·계약 비용</h1>{표시}
<div class=kpi><div>비용<b>{원(합['비용'])}</b></div><div>클릭<b>{원(합['클릭'])}</b></div><div>상담<b>{합['상담']:.0f}</b></div>
<div>계약<b>{합['계약']:.0f}</b></div><div>상담당<b>{원(합['비용']/합['상담'] if 합['상담'] else 0)}</b></div><div>계약당<b>{원(합['비용']/합['계약'] if 합['계약'] else 0)}</b></div></div>
<h2>소재별 (계약당 비용 낮은 순)</h2>{추정글}<div class=wrap><table><tr><th>캠페인 / 소재</th><th>노출</th><th>클릭</th><th>CTR</th><th>비용</th><th>상담</th><th>계약</th><th>상담당</th><th>계약당</th><th>막힌 곳</th><th>근거</th></tr>{''.join(줄)}</table></div>
<h2>날짜별</h2><div class=wrap><table><tr><th>날짜</th><th>비용</th><th>클릭</th><th>상담</th><th>계약</th><th>상담당</th></tr>{일}</table></div>
<p class=note>막힌 곳: 소재 = CTR이 평균의 0.6배 미만 · 랜딩 = 클릭 중 상담 2% 미만 · 상담 2건 미만은 판단 보류. 기준 숫자는 각자 바꿔 쓰세요.</p></html>"""


def main(argv):
    샘플 = len(argv) < 2
    g, s = (HERE / "sample" / "gfa_sample.csv", HERE / "sample" / "consult_sample.csv") if 샘플 else map(Path, argv[:2])
    소재표, 일별, 추정 = 계산(읽기(g), 읽기(s))
    out = HERE / "out"
    out.mkdir(exist_ok=True)
    (out / "대시보드.html").write_text(대시보드(소재표, 일별, 추정, 샘플), encoding="utf-8")
    합 = collections.Counter()
    for c in 소재표.values():
        합.update(c)
    print(f"{'샘플' if 샘플 else '실제'} · 소재 {len(소재표)}개 · 비용 {원(합['비용'])} · 상담 {합['상담']:.0f} · 계약 {합['계약']:.0f} → {out / '대시보드.html'}")


if __name__ == "__main__":
    main(sys.argv[1:])
