#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
RaptorQR · 局域网 HTTPS 本地服务（托管 apps/web/dist）
===================================================
在 PC 上运行，手机连同一 Wi-Fi 即可打开 RaptorQR 网页端用摄像头接收。
使用自签名证书，手机首次访问需手动信任一次。全程不经过公网。

用法：
    python serve_web.py                  # 默认 0.0.0.0:8443，自动生成自签名证书
    python serve_web.py --port 9000      # 换端口
    python serve_web.py --host 192.168.x.x
    python serve_web.py --cert a.crt --key a.key

说明：
    - 防火墙需放行该端口（Windows 首次会弹窗，勾选“专用网络”允许）。
    - 手机浏览器打开 https://<本机内网IP>:<端口>/ ，先信任证书再使用。
    - 证书自签名，浏览器会报“不安全 / 您的连接不是私密连接”，属正常，
      点「高级」→「继续访问（不安全）」即可。
    - 正式使用建议部署到 Cloudflare Pages / Vercel，拿到合法证书、零警告。
"""

import argparse
import os
import socket
import ssl
import subprocess
import sys
from http.server import HTTPServer, SimpleHTTPRequestHandler

ROOT = os.path.dirname(os.path.abspath(__file__))
DIST = os.path.join(ROOT, "apps", "web", "dist")
CERT_DIR = os.path.join(ROOT, "certs")
CERT = os.path.join(CERT_DIR, "server.crt")
KEY = os.path.join(CERT_DIR, "server.key")

MIME = {
    ".html": "text/html; charset=utf-8",
    ".js": "application/javascript",
    ".mjs": "application/javascript",
    ".css": "text/css",
    ".json": "application/json",
    ".wasm": "application/wasm",
    ".svg": "image/svg+xml",
    ".ico": "image/x-icon",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
    ".webmanifest": "application/manifest+json",
}


def lan_ips():
    ips = []
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        s.connect(("8.8.8.8", 80))
        ips.append(s.getsockname()[0])
    except OSError:
        pass
    finally:
        s.close()
    try:
        for info in socket.getaddrinfo(socket.gethostname(), None, socket.AF_INET):
            ip = info[4][0]
            if ip != "127.0.0.1" and ip not in ips:
                ips.append(ip)
    except OSError:
        pass
    return ips


def san_entries():
    entries = ["DNS:localhost", "IP:127.0.0.1"]
    for ip in lan_ips():
        if ip != "127.0.0.1":
            entries.append("IP:" + ip)
    return entries


def cert_covers_lan():
    if not (os.path.exists(CERT) and os.path.exists(KEY)):
        return False
    try:
        out = subprocess.run(
            ["openssl", "x509", "-in", CERT, "-noout", "-text"],
            stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
        )
        text = out.stdout.decode("utf-8", "ignore")
        for ip in lan_ips():
            if ip not in text:
                return False
        return True
    except (subprocess.CalledProcessError, FileNotFoundError):
        return False


def make_cert():
    os.makedirs(CERT_DIR, exist_ok=True)
    try:
        from cryptography import x509
        from cryptography.x509.oid import NameOID
        from cryptography.hazmat.primitives import hashes, serialization
        from cryptography.hazmat.primitives.asymmetric import rsa
        import datetime
        import ipaddress

        key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
        name = x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, "raptorqr")])
        san = [x509.DNSName("localhost")]
        for ip in lan_ips():
            try:
                san.append(x509.IPAddress(ipaddress.ip_address(ip)))
            except ValueError:
                pass
        cert = (
            x509.CertificateBuilder()
            .subject_name(name)
            .issuer_name(name)
            .public_key(key.public_key())
            .serial_number(x509.random_serial_number())
            .not_valid_before(datetime.datetime.utcnow() - datetime.timedelta(minutes=1))
            .not_valid_after(datetime.datetime.utcnow() + datetime.timedelta(days=3650))
            .add_extension(x509.SubjectAlternativeName(san), critical=False)
            .sign(key, hashes.SHA256())
        )
        with open(KEY, "wb") as f:
            f.write(
                key.private_bytes(
                    serialization.Encoding.PEM,
                    serialization.PrivateFormat.TraditionalOpenSSL,
                    serialization.NoEncryption(),
                )
            )
        with open(CERT, "wb") as f:
            f.write(cert.public_bytes(serialization.Encoding.PEM))
        print("[证书] 已用 cryptography 生成自签名证书（含本机 IP 的 SAN）")
        return
    except ImportError:
        print("[证书] 未安装 cryptography，尝试 openssl ...")

    try:
        san = ",".join(san_entries())
        subprocess.run(
            [
                "openssl", "req", "-x509", "-newkey", "rsa:2048", "-nodes",
                "-keyout", KEY, "-out", CERT, "-days", "3650",
                "-subj", "/CN=raptorqr",
                "-addext", "subjectAltName=" + san,
            ],
            check=True,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
        print("[证书] 已用 openssl 生成自签名证书（SAN: " + san + "）")
        return
    except (subprocess.CalledProcessError, FileNotFoundError):
        print("[证书] 生成失败：openssl 不可用。请 pip install cryptography 或手动生成。")
        sys.exit(1)


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *a, **kw):
        super().__init__(*a, directory=DIST, **kw)

    def guess_type(self, path):
        ext = os.path.splitext(path)[1].lower()
        return MIME.get(ext, super().guess_type(path))

    def send_head(self):
        # SPA 兜底：无扩展名且文件不存在时回退 index.html（hash 路由其实只用到 /）
        if not os.path.exists(self.translate_path(self.path)):
            base, _ = os.path.splitext(self.path.split("?")[0])
            if "." not in os.path.basename(base):
                self.path = "/index.html"
        return super().send_head()

    def log_message(self, fmt, *args):
        sys.stderr.write("[访问] " + (fmt % args) + "\n")


def main():
    if not os.path.exists(os.path.join(DIST, "index.html")):
        print("[错误] 未找到 apps/web/dist/index.html —— 请先运行 `pnpm build`。")
        sys.exit(1)

    p = argparse.ArgumentParser(description="RaptorQR 局域网 HTTPS 服务")
    p.add_argument("--host", default="0.0.0.0", help="监听地址（默认 0.0.0.0）")
    p.add_argument("--port", type=int, default=9443, help="端口（默认 8443）")
    p.add_argument("--cert", default=None, help="使用已有的证书文件")
    p.add_argument("--key", default=None, help="使用已有的私钥文件")
    p.add_argument("--no-print-ips", action="store_true", help="不打印局域网地址")
    args = p.parse_args()

    if args.cert and args.key:
        global CERT, KEY
        CERT, KEY = args.cert, args.key
        if not (os.path.exists(CERT) and os.path.exists(KEY)):
            print("[错误] 指定的证书或私钥不存在，请检查路径。")
            sys.exit(1)
    else:
        if not cert_covers_lan():
            make_cert()

    try:
        httpd = HTTPServer((args.host, args.port), Handler)
        ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
        ctx.load_cert_chain(CERT, KEY)
        httpd.socket = ctx.wrap_socket(httpd.socket, server_side=True)
    except OSError as e:
        print(f"[错误] 无法绑定 {args.host}:{args.port} —— {e}")
        print("  可能端口被占用或 0.0.0.0 受限；可换 --port 或指定 --host 为本机 IP。")
        sys.exit(1)

    print("\n=== RaptorQR · 局域网服务已启动 ===")
    print(f"  本机访问 : https://localhost:{args.port}/")
    if not args.no_print_ips:
        for ip in lan_ips():
            print(f"  手机访问 : https://{ip}:{args.port}/   （手机需连同一 Wi-Fi / 局域网）")
    print("\n  手机首次打开会提示“连接不是私密连接” → 点「高级」→「继续访问」即可。")
    print("  按 Ctrl+C 停止服务。\n")

    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\n[已停止] 服务关闭。")


if __name__ == "__main__":
    main()
