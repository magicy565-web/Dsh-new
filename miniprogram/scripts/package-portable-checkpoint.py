#!/usr/bin/env python3
"""Package selected Git source minus explicitly listed historical prefixes.

Requires a full commit SHA and already-clean-built release/miniprogram. Does not
fetch, build, access accounts, deploy or recover excluded historical blob data.
The output directory must not exist. See PORTABLE-DELIVERY.md beside this script.
"""
import argparse
import json
from pathlib import Path
import subprocess
import zipfile

from portable_delivery import DeliveryError, package


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--repository', type=Path, required=True)
    parser.add_argument('--commit', required=True, help='Immutable full 40-character source commit SHA')
    parser.add_argument('--compiled', type=Path, required=True, help='Existing clean release/miniprogram directory')
    parser.add_argument('--output', type=Path, required=True, help='New output directory')
    args = parser.parse_args()
    try:
        print(json.dumps(package(args.repository, args.commit, args.compiled, args.output), ensure_ascii=False))
    except (DeliveryError, OSError, ValueError, KeyError, TypeError, subprocess.CalledProcessError, zipfile.BadZipFile) as exc:
        parser.exit(1, f'Portable packaging failed: {exc}\n')


if __name__ == '__main__':
    main()
