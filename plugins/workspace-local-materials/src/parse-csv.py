"""Bounded UTF-8 CSV decoding through Python's mature standard library only."""
import csv
import io
import json
import sys

try:
    text = json.load(sys.stdin)
    if not isinstance(text, str) or len(text.encode('utf-8')) > 65536:
        raise ValueError()
    reader = csv.reader(io.StringIO(text, newline=''), strict=True)
    rows = list(reader)
    if not rows or len(rows) > 1001 or not 1 <= len(rows[0]) <= 50:
        raise ValueError()
    headers = rows[0]
    if any(not key.strip() for key in headers) or len(set(headers)) != len(headers):
        raise ValueError()
    if any(len(row) != len(headers) for row in rows[1:]):
        raise ValueError()
    json.dump({'headers': headers, 'rows': rows[1:], 'parser': 'python-stdlib-csv',
               'version': sys.version.split()[0]}, sys.stdout, ensure_ascii=False)
except Exception:
    sys.stdout.write('{"error":"CSV_FORMAT_OR_LIMIT_UNSUPPORTED"}')
    sys.exit(2)
