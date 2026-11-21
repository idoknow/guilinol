import ipaddress
import json
import os
from pathlib import Path
import runpy
import sys

networks = runpy.run_path(str(Path(__file__).resolve().parents[1] / "deploy/postgres/ip2region_csv.py"))["networks"]
samples = [
    ("202.103.225.68", "广西", "电信"),
    ("210.21.196.6", "广东", "联通"),
    ("221.130.33.60", "北京", "移动"),
]

if __name__ == "__main__":
    path = os.environ.get("IP2REGION_SOURCE")
    if not path:
        sys.exit("Set IP2REGION_SOURCE to the local IPv4 source text to test real province/carrier lookups")
    with open(path, encoding="utf-8-sig") as source:
        ranges = list(networks(source, [ip for ip, _, _ in samples]))
    cases = []
    for ip, province, carrier in samples:
        record, = [row for row in ranges if ipaddress.ip_address(ip) in ipaddress.ip_network(row[0])]
        prefix, country, region, city, isp = record
        if country != "CN" or province not in region or carrier not in isp:
            sys.exit(f"Unexpected region for {ip}: {record}")
        cases.append(dict(ip=ip, prefix=prefix, country=country, region=region, city=city, isp=isp))
    print(json.dumps(cases, ensure_ascii=False))
