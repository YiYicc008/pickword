#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""本地/局域网启动器：起一个静态文件服务，打印手机与平板可用的地址，并打开浏览器。

用法：
    python serve.py            # 默认 8080 端口
    python serve.py 9000       # 指定端口
"""

import mimetypes
import os
import socket
import sys
import threading
import webbrowser
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

mimetypes.add_type("application/manifest+json", ".webmanifest")
mimetypes.add_type("text/javascript", ".js")
mimetypes.add_type("image/svg+xml", ".svg")

ROOT = os.path.dirname(os.path.abspath(__file__))


def lan_ips():
    ips = []
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.settimeout(0.4)
        s.connect(("8.8.8.8", 80))
        ips.append(s.getsockname()[0])
        s.close()
    except OSError:
        pass
    try:
        for info in socket.getaddrinfo(socket.gethostname(), None, socket.AF_INET):
            ip = info[4][0]
            if ip not in ips and not ip.startswith("127."):
                ips.append(ip)
    except OSError:
        pass
    return ips


def pick_port(preferred):
    for port in [preferred, preferred + 1, preferred + 2, 8090, 8765, 9000]:
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
            s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
            try:
                s.bind(("0.0.0.0", port))
                return port
            except OSError:
                continue
    return 0


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=ROOT, **kwargs)

    def end_headers(self):
        # 开发期禁缓存，避免改了文件看不到效果；正式环境由 sw.js 负责缓存
        self.send_header("Cache-Control", "no-store, max-age=0")
        super().end_headers()

    def log_message(self, fmt, *args):
        sys.stdout.write("  · " + (fmt % args) + "\n")


def main():
    preferred = 8080
    if len(sys.argv) > 1:
        try:
            preferred = int(sys.argv[1])
        except ValueError:
            pass

    port = pick_port(preferred)
    if not port:
        print("找不到可用端口，请关掉占用端口的程序后重试。")
        return 1

    local = f"http://127.0.0.1:{port}/index.html"
    ips = lan_ips()

    print("=" * 62)
    print("  词汇 · 电子英语单词本")
    print("=" * 62)
    print("")
    print(f"  本机访问（这台电脑）：{local}")
    if ips:
        print("  同一 WiFi 下的手机 / 平板访问：")
        for ip in ips:
            print(f"      http://{ip}:{port}/index.html")
    else:
        print("  没检测到局域网 IP，手机请确认与电脑在同一 WiFi。")
    print("")
    print("  · iPad：Safari 打开上面的地址 → 分享 → 添加到主屏幕")
    print("  · 鸿蒙 / 安卓：浏览器打开 → 菜单 → 添加到桌面")
    print("  · 示例数据：在上面地址后面加 ?demo")
    print("")
    print("  按 Ctrl+C 停止服务。")
    print("=" * 62)

    threading.Timer(0.8, lambda: webbrowser.open(local)).start()

    httpd = ThreadingHTTPServer(("0.0.0.0", port), Handler)
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\n已停止。")
    finally:
        httpd.server_close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
