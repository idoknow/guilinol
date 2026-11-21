"""Convert ip2region IPv4 text ranges to PostgreSQL CIDRs. Input stays outside git."""
import argparse
import csv
import ipaddress
import sys


def addresses(source):
    for number, line in enumerate(source, 1):
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        try:
            start, end, *parts = line.split("|")
            if len(parts) == 5:
                country, region, city, isp, iso = parts
            elif len(parts) == 4:
                country, region, city, isp = parts
                iso = ""
            else:
                raise ValueError("expected country, province, city, carrier and optional ISO code")
            code = "CN" if country in {"中国", "China", "CN"} else iso.upper()
            low, high = [ipaddress.IPv4Address(int(s) if s.isdecimal() else s) for s in (start, end)]
            if low > high:
                raise ValueError("reversed address range")
            yield low, high, tuple("" if s in {"0", "--"} else s for s in (code, region, city, isp))
        except ValueError as error:
            raise ValueError(f"invalid IPv4 source at line {number}: {error}") from error


def networks(source, samples=()):
    selected = [ipaddress.IPv4Address(value) for value in samples]
    for low, high, region in addresses(source):
        if selected and not any(low <= ip <= high for ip in selected):
            continue
        for prefix in ipaddress.summarize_address_range(low, high):
            yield [str(prefix), *region]


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source")
    args = parser.parse_args()
    with open(args.source, encoding="utf-8-sig") as source:
        writer = csv.writer(sys.stdout)
        writer.writerow(["prefix", "country", "region", "city", "isp"])
        writer.writerows(networks(source))
