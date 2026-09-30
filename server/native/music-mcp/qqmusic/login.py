"""QQ音乐登录脚本 — 扫码获取 credential 并保存到文件."""

import asyncio
import json
import os

from qqmusic_api import Client
from qqmusic_api.models.login import QRLoginType
from qqmusic_api.modules.login_utils import QRCodeLoginSession

CRED_PATH = os.path.join(os.path.dirname(__file__), "credential.json")


async def main():
    print("=== QQ音乐扫码登录 ===\n")
    print("选择登录方式:")
    print("  1. QQ 扫码")
    print("  2. 微信扫码")
    print("  3. QQ音乐APP 扫码")
    choice = input("\n请选择 (1/2/3，默认1): ").strip() or "1"

    login_map = {"1": QRLoginType.QQ, "2": QRLoginType.WX, "3": QRLoginType.MOBILE}
    login_type = login_map.get(choice, QRLoginType.QQ)

    async with Client() as client:
        session = QRCodeLoginSession(
            client.login,
            login_type,
            interval=1.5,
            timeout_seconds=180.0,
        )
        qr = await session.get_qrcode()
        qr_path = os.path.join(os.path.dirname(__file__), "qrcode.png")
        qr.save(qr_path)
        print(f"\n二维码已保存到: {qr_path}")
        print("请用手机扫描二维码登录...\n")

        credential = await session.wait_qrcode_login()

        print(f"登录成功!")
        print(f"  musicid: {credential.musicid}")
        print(f"  login_type: {credential.login_type}")

        with open(CRED_PATH, "w", encoding="utf-8") as f:
            json.dump(credential.model_dump(), f, indent=2, ensure_ascii=False)
        print(f"\n凭证已保存到: {CRED_PATH}")


if __name__ == "__main__":
    asyncio.run(main())
