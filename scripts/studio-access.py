#!/usr/bin/env python3
"""Copy the Studio owner password to the macOS clipboard without printing it."""
import subprocess
from keychain import read
password=read('agentic.world.studio','owner-password')
if not password:raise SystemExit('此 Mac 尚未建立 Studio 存取密碼。')
subprocess.run(['pbcopy'],input=password,text=True,check=True)
print('Studio 存取密碼已複製到剪貼簿，請貼至登入頁；不會顯示於終端機。')
