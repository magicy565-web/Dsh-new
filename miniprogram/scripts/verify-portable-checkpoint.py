#!/usr/bin/env python3
"""Offline integrity verification before any optional safe extraction.

Requires an independently pinned full source commit SHA and the expected Git-tree
manifest. Rejects unlisted/missing files, path traversal, symlinks, collisions,
unsafe modes, altered source blobs and incorrect exclusions. The source tree is
intentionally incomplete; this never claims to reconstruct its excluded data.
"""
import argparse
import json
from pathlib import Path
import zipfile

from portable_delivery import DeliveryError, encode, ensure_new_directory, verify


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', type=Path, required=True)
    parser.add_argument('--client', type=Path, required=True)
    parser.add_argument('--expected-tree', type=Path, required=True)
    parser.add_argument('--commit', required=True, help='Full commit SHA verified separately against GitHub')
    parser.add_argument('--client-sha256', required=True, help='Trusted client ZIP SHA-256 recorded at packaging')
    parser.add_argument('--destination', type=Path, help='Optional new clean extraction directory')
    parser.add_argument('--record', type=Path, help='Optional new JSON verification report; never overwritten')
    args = parser.parse_args()
    try:
        if args.record is not None:
            ensure_new_directory(args.record)
        result = verify(args.source, args.client, args.expected_tree, args.commit, args.client_sha256, args.destination)
        if args.record is not None:
            args.record.parent.mkdir(parents=True, exist_ok=True)
            with args.record.open('xb') as handle:
                handle.write(encode(result))
        print(json.dumps(result, ensure_ascii=False))
    except (DeliveryError, OSError, ValueError, KeyError, TypeError, zipfile.BadZipFile) as exc:
        parser.exit(1, f'Portable verification failed: {exc}\n')


if __name__ == '__main__':
    main()
