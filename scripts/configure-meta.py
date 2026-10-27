#!/usr/bin/env python3
"""Interactively provision this project's Meta key without echo or disk storage."""
import getpass,json,sys,urllib.request,urllib.error
from keychain import write,update
from cloudflare import wrangler

def main():
 key=getpass.getpass('Meta Model API key（隱藏輸入）: ').strip()
 if not key:raise SystemExit('未輸入內容，沒有變更任何設定。')
 request=urllib.request.Request('https://api.meta.ai/v1/models',headers={'Authorization':'Bearer '+key})
 try:
  with urllib.request.urlopen(request,timeout=30) as response:models=json.load(response)
 except urllib.error.HTTPError as error:
  data=json.load(error);raise SystemExit(f'Meta 回應 HTTP {error.code}: '+str(data.get('error',{}).get('code','request_failed')))
 available={m['id'] for m in models.get('data',[])}
 if not {'muse-spark-1.3','muse-image-1.0'}<=available:raise SystemExit('此帳號模型清單尚未包含所需模型；未變更部署設定。')
 update('agentic.world.studio','meta-api-key',key)
 for environment in ['dev','production']:
  wrangler(['secret','put','MODEL_API_KEY','--env',environment],key)
 print('Meta API key 已安全儲存並套用 dev / production；未寫入 repo 或 GitHub Actions。')
if __name__=='__main__':main()
