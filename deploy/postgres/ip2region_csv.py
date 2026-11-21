"""Convert the legacy IPv4 ip2region v2 XDB (country|0|province|city|ISP) for psql."""
import csv
import ipaddress
import mmap
import struct
import sys


def convert(data, output):
    if len(data) < 256 or struct.unpack_from("<H", data)[0] != 2:
        raise ValueError("Expected a v2 IPv4 XDB")
    first, last = struct.unpack_from("<II", data, 8)
    record = struct.Struct("<IIHI")
    if first < 256 or last < first or last + record.size > len(data) or (last - first) % record.size:
        raise ValueError("Invalid segment index")
    writer = csv.writer(output)
    writer.writerow(["prefix", "country", "region", "city", "isp"])
    for pos in range(first, last + 1, record.size):
        low, high, length, offset = record.unpack_from(data, pos)
        if low > high or offset + length > len(data):
            raise ValueError("Invalid segment")
        parts = data[offset:offset + length].decode("utf-8").split("|")
        if len(parts) != 5:
            raise ValueError("Expected five legacy region fields")
        country, _, region, city, isp = (s if s != "0" else "" for s in parts)
        # Country headers supply ISO codes outside China when the legacy catalog uses local names.
        code = "CN" if country in {"CN", "中国", "China"} else country if len(country) == 2 and country.isascii() else ""
        for prefix in ipaddress.summarize_address_range(ipaddress.IPv4Address(low), ipaddress.IPv4Address(high)):
            writer.writerow([str(prefix), code, region, city, isp])


if __name__ == "__main__":
    with open(sys.argv[1], "rb") as source, mmap.mmap(source.fileno(), 0, access=mmap.ACCESS_READ) as data:
        convert(data, sys.stdout)
