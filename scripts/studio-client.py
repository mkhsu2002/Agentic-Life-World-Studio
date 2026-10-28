#!/usr/bin/env python3
"""Owner-only development client; reads credentials only from Keychain."""
import http.cookiejar,json,pathlib,sys,urllib.request,urllib.error
from keychain import read
class Studio:
 def __init__(self,base):
  self.base=base.rstrip('/');cookies=http.cookiejar.CookieJar();self.opener=urllib.request.build_opener(urllib.request.HTTPCookieProcessor(cookies))
  self.call('/api/login',{'password':read('agentic.world.studio','owner-password')})
 def call(self,path,data=None,method=None):
  req=urllib.request.Request(self.base+path,data=json.dumps(data).encode() if data is not None else None,method=method,headers={'Content-Type':'application/json','User-Agent':'WorldStudio/0.04'})
  try:
   with self.opener.open(req,timeout=240) as response:return json.load(response)
  except urllib.error.HTTPError as error:
   body=error.read().decode();raise RuntimeError(f'{path}: HTTP {error.code} {body[:600]}') from None
if __name__=='__main__':
 base=sys.argv[1];action=sys.argv[2];client=Studio(base)
 if action=='import':
  source=json.loads(pathlib.Path(sys.argv[3]).read_text());text='\n\n'.join('=== '+t['title']+' ===\n'+t['text'] for t in source['tabs']);result=client.call('/api/sources',{'title':source['title'],'kind':'google-doc','url':source['sourceUrl'],'text':text});pathlib.Path('.private/import-result.json').write_text(json.dumps(result));print(json.dumps(result))
 elif action=='status':
  result=json.loads(pathlib.Path('.private/import-result.json').read_text());d=client.call('/api/worlds/'+result['worldId']);pathlib.Path('.private/world-latest.json').write_text(json.dumps(d,ensure_ascii=False));print(json.dumps({'worldId':d['world']['id'],'status':d['world']['status'],'source':d['source'],'jobs':d['jobs'],'elementCount':len(d['world']['elements']),'questions':d['world']['questions'],'styles':d['world']['styles']},ensure_ascii=False,indent=2))
 else:print(json.dumps(client.call(action),ensure_ascii=False,indent=2))
