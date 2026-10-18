#!/usr/bin/env python3
"""Turns the legal documents (.docx) into the JSON the site renders: frontend/src/legal/data/<key>.json.

    python3 -I scripts/legal_docx_to_json.py <key>=<file.docx> [<key>=<file.docx> ...]

Keys: terms, coach-offer, service-terms, privacy, consent-player, consent-coach, consent-coach-dissemination.
Each file gets {key, title, version (YYYY-MM-DD, from "Редакция от dd.mm.yyyy"), blocks}. After replacing a document,
also bump its version in backend/app/services/legal.py and frontend/src/legal/documents.ts (a test compares them).
Document text is never evaluated as HTML: the site renders blocks as plain text runs.
"""
import zipfile, sys, json, re
import xml.etree.ElementTree as ET
W = '{http://schemas.openxmlformats.org/wordprocessingml/2006/main}'
R = '{http://schemas.openxmlformats.org/officeDocument/2006/relationships}'

def load(path):
    z = zipfile.ZipFile(path)
    root = ET.fromstring(z.read('word/document.xml'))
    rels = ET.fromstring(z.read('word/_rels/document.xml.rels'))
    links = {r.get('Id'): r.get('Target') for r in rels if r.get('TargetMode') == 'External'}
    num = ET.fromstring(z.read('word/numbering.xml'))
    absn = {}
    for a in num.findall(W + 'abstractNum'):
        l = a.find(W + 'lvl')
        absn[a.get(W + 'abstractNumId')] = l.find(W + 'numFmt').get(W + 'val')
    fmt = {n.get(W + 'numId'): absn[n.find(W + 'abstractNumId').get(W + 'val')] for n in num.findall(W + 'num')}
    return root, links, fmt

def runs_of(p, links):
    out = []
    def add(text, b, i, href=None):
        if not text:
            return
        if out and bool(out[-1].get('b')) == bool(b) and bool(out[-1].get('i')) == bool(i) and out[-1].get('href') == href:
            out[-1]['t'] += text
        else:
            d = {'t': text}
            if b: d['b'] = True
            if i: d['i'] = True
            if href: d['href'] = href
            out.append(d)
    def walk(el, href=None):
        for ch in el:
            if ch.tag == W + 'r':
                rpr = ch.find(W + 'rPr')
                b = i = False
                if rpr is not None:
                    be = rpr.find(W + 'b'); ie = rpr.find(W + 'i')
                    b = be is not None and be.get(W + 'val') not in ('0', 'false')
                    i = ie is not None and ie.get(W + 'val') not in ('0', 'false')
                for c in ch:
                    if c.tag == W + 't': add(c.text or '', b, i, href)
                    elif c.tag == W + 'tab': add(' ', b, i, href)
                    elif c.tag == W + 'br': add('\n', b, i, href)
            elif ch.tag == W + 'hyperlink':
                walk(ch, links.get(ch.get(R + 'id')))
            elif ch.tag in (W + 'ins', W + 'smartTag', W + 'sdt', W + 'sdtContent'):
                walk(ch, href)
    walk(p)
    if out:
        out[0]['t'] = out[0]['t'].lstrip()
        out[-1]['t'] = out[-1]['t'].rstrip()
        out = [r for r in out if r['t']]
    return out

def convert(path):
    root, links, fmt = load(path)
    blocks = []
    body = root.find(W + 'body')
    for ch in body:
        if ch.tag == W + 'p':
            ppr = ch.find(W + 'pPr')
            style = ''; numid = None; jc = ''
            if ppr is not None:
                s = ppr.find(W + 'pStyle'); style = s.get(W + 'val') if s is not None else ''
                n = ppr.find(W + 'numPr')
                if n is not None and n.find(W + 'numId') is not None:
                    numid = n.find(W + 'numId').get(W + 'val')
                j = ppr.find(W + 'jc'); jc = j.get(W + 'val') if j is not None else ''
            runs = runs_of(ch, links)
            if not runs:
                continue
            if numid and numid != '0' and style == 'Compact':
                kind = 'ol' if fmt.get(numid) == 'decimal' else 'ul'
                if blocks and blocks[-1]['type'] == kind and blocks[-1].get('_num') == numid:
                    blocks[-1]['items'].append(runs)
                else:
                    blocks.append({'type': kind, '_num': numid, 'items': [runs]})
                continue
            if style == '1': blocks.append({'type': 'h1', 'runs': runs})
            elif style == '2': blocks.append({'type': 'h2', 'runs': runs, **({'center': True} if jc == 'center' else {})})
            else:
                d = {'type': 'p', 'runs': runs}
                if jc == 'center': d['align'] = 'center'
                blocks.append(d)
        elif ch.tag == W + 'tbl':
            rows = []
            for tr in ch.findall(W + 'tr'):
                row = []
                for tc in tr.findall(W + 'tc'):
                    paras = [runs_of(p, links) for p in tc.findall(W + 'p')]
                    row.append([p for p in paras if p])
                rows.append(row)
            blocks.append({'type': 'table', 'rows': rows})
    for b in blocks: b.pop('_num', None)
    # merge consecutive h1 into a single title (the documents split titles over two lines)
    merged = []
    for b in blocks:
        if b['type'] == 'h1' and merged and merged[-1]['type'] == 'h1':
            merged[-1]['runs'] = merged[-1]['runs'] + [{'t': ' '}] + b['runs']
        else:
            merged.append(b)
    return merged


def title_of(blocks):
    for b in blocks:
        if b['type'] == 'h1':
            return ''.join(r['t'] for r in b['runs']).strip()
    raise SystemExit('no title (h1) found')


def version_of(blocks):
    for b in blocks:
        runs = b.get('runs') or []
        text = ''.join(r['t'] for r in runs)
        m = re.search(r'Редакция от (\d{2})\.(\d{2})\.(\d{4})', text)
        if m:
            return f'{m.group(3)}-{m.group(2)}-{m.group(1)}'
    raise SystemExit('no "Редакция от dd.mm.yyyy" line found')


if __name__ == '__main__':
    import os
    out_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'frontend', 'src', 'legal', 'data')
    for arg in sys.argv[1:]:
        key, _, path = arg.partition('=')
        blocks = convert(path)
        doc = {'key': key, 'title': title_of(blocks), 'version': version_of(blocks), 'blocks': blocks}
        with open(os.path.join(out_dir, key + '.json'), 'w', encoding='utf8') as f:
            json.dump(doc, f, ensure_ascii=False, indent=1)
            f.write('\n')
        print(key, doc['version'], '-', doc['title'])
