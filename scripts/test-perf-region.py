import csv
import io
import ipaddress
from pathlib import Path
import runpy
import struct
import unittest

convert = runpy.run_path(str(Path(__file__).resolve().parents[1] / "deploy/postgres/ip2region_csv.py"))["convert"]


class RegionTests(unittest.TestCase):
    def test_province_and_carrier_survive_range_conversion(self):
        samples = [("202.96.128.86", "广东", "广州", "电信"), ("202.106.0.20", "北京", "北京", "联通"),
                   ("211.136.192.6", "广东", "广州", "移动")]
        data = bytearray(256 + 256 * 256 * 8)
        struct.pack_into("<H", data, 0, 2)
        segments = []
        for address, province, city, isp in samples:
            ip = int(ipaddress.ip_address(address))
            label = f"中国|0|{province}|{city}|{isp}".encode()
            segments.append(struct.pack("<IIHI", ip - 2, ip + 3, len(label), len(data)))
            data.extend(label)
        first = len(data)
        data.extend(b"".join(segments))
        struct.pack_into("<II", data, 8, first, len(data) - 14)
        out = io.StringIO()
        convert(data, out)
        rows = list(csv.DictReader(io.StringIO(out.getvalue())))
        for address, province, city, isp in samples:
            match, = [row for row in rows if ipaddress.ip_address(address) in ipaddress.ip_network(row["prefix"])]
            self.assertEqual([match[k] for k in ["country", "region", "city", "isp"]], ["CN", province, city, isp])


if __name__ == "__main__":
    unittest.main()
