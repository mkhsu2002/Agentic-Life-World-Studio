#!/usr/bin/env python3
"""Register a repository-scoped GitHub App; keys stay in Keychain and Worker secrets."""
import http.server,json,secrets,subprocess,threading,urllib.parse,urllib.request,urllib.error
from keychain import read,update
from cloudflare import wrangler
SERVICE='agentic.world.studio'
state=secrets.token_urlsafe(32)
finished=threading.Event()
configuration={}

def manifest_for(origin,state):
 return {'name':'World Studio '+secrets.token_hex(3),'url':'https://github.com/mkhsu2002/Agentic-Life-World-Studio','public':False,'hook_attributes':{'url':'https://agentic-world-studio-production.mkhsu2002.workers.dev/api/studio/deployments','active':False},'redirect_url':origin+'/callback','setup_url':origin+'/installed?state='+state,'default_permissions':{'contents':'write','pull_requests':'write','actions':'write','checks':'read'},'default_events':[]}

def provision(installation):
 app_id=read(SERVICE,'github-app-id'); key=read(SERVICE,'github-app-private-key')
 if not app_id or not key: raise RuntimeError('請先完成此視窗的 App 建立步驟。')
 result=subprocess.run(['node','scripts/verify-github-app.mjs'],input=json.dumps({'appId':app_id,'key':key,'installationId':installation}),text=True,capture_output=True)
 if result.returncode:raise RuntimeError('App 權限驗證未通過。請僅安裝至 mkhsu2002/Agentic-Life-World-Studio，並使用畫面列出的最低必要權限。')
 values={'GITHUB_APP_ID':app_id,'GITHUB_APP_PRIVATE_KEY':key,'GITHUB_INSTALLATION_ID':installation}
 for environment in ['dev','production']:wrangler(['secret','bulk','--env',environment],json.dumps(values))
 update(SERVICE,'github-installation-id',installation)
 configuration['complete']=True
 print('GitHub App 已驗證僅授權本 repository，並安全套用 dev / production。',flush=True)

class Handler(http.server.BaseHTTPRequestHandler):
 def log_message(self,*args):pass
 def page(self,text,status=200):
  body=('<!doctype html><meta charset="utf-8"><title>World Studio GitHub setup</title><style>body{font:18px system-ui;max-width:720px;margin:10vh auto;padding:24px;line-height:1.7}button{padding:16px;font:inherit}</style>'+text).encode()
  self.send_response(status);self.send_header('Content-Type','text/html; charset=utf-8');self.send_header('Cache-Control','no-store');self.send_header('Referrer-Policy','no-referrer');self.send_header('Content-Security-Policy',"default-src 'none'; style-src 'unsafe-inline'; form-action https://github.com 'self'; base-uri 'none'");self.end_headers();self.wfile.write(body)
 def do_GET(self):
  url=urllib.parse.urlparse(self.path);q=urllib.parse.parse_qs(url.query)
  try:
   if url.path=='/':
    manifest=manifest_for(origin,state)
    import html
    self.page('<h1>連接 World Studio 發布權限</h1><p>請在 GitHub 親自確認建立私人 App，安裝時只勾選 <b>Agentic-Life-World-Studio</b>。不需要提供個人 token。</p><form method="post" action="https://github.com/settings/apps/new?state='+state+'"><input type="hidden" name="manifest" value="'+html.escape(json.dumps(manifest),quote=True)+'"><button>前往 GitHub 建立 App</button></form>')
   elif url.path=='/callback':
    if q.get('state',[''])[0]!=state or not q.get('code'):raise RuntimeError('授權狀態不相符，請重新開啟設定首頁。')
    code=q['code'][0]
    req=urllib.request.Request('https://api.github.com/app-manifests/'+urllib.parse.quote(code,safe='')+'/conversions',data=b'',method='POST',headers={'Accept':'application/vnd.github+json','User-Agent':'WorldStudio-Setup','X-GitHub-Api-Version':'2026-03-10'})
    with urllib.request.urlopen(req,timeout=30) as response: app=json.load(response)
    converted=subprocess.run(['openssl','pkcs8','-topk8','-nocrypt'],input=app['pem'],text=True,capture_output=True,check=True).stdout
    update(SERVICE,'github-app-id',str(app['id']));update(SERVICE,'github-app-private-key',converted)
    install=app['html_url']+'/installations/new'
    self.page('<h1>App 已安全保存</h1><p>最後請安裝到指定 repository。</p><a href="'+install+'">安裝至 Agentic-Life-World-Studio</a>')
   elif url.path=='/installed':
    if q.get('state',[''])[0]!=state or not q.get('installation_id'):raise RuntimeError('授權狀態不相符，請從設定首頁完成安裝。')
    provision(q['installation_id'][0]);self.page('<h1>連接完成</h1><p>dev 與正式環境都已驗證，可以返回 Studio 繼續網站預覽與發布。</p>');finished.set()
   else:self.page('Not found',404)
  except Exception as error:
   # Never echo request codes, PEMs, provider response bodies, or subprocess stderr.
   print('設定未完成：'+type(error).__name__+'；已保存進度，可重新執行此指令。',flush=True)
   self.page('<h1>尚未完成</h1><p>請確認 GitHub 帳號、單一 repository 安裝範圍及網路連線後，再從設定首頁重試。原有網站未變更。</p>',400)

if __name__=='__main__':
 existing=read(SERVICE,'github-installation-id')
 if existing:
  provision(existing)
 else:
  server=http.server.HTTPServer(('127.0.0.1',0),Handler);origin='http://127.0.0.1:'+str(server.server_port)
  print('請在你選擇的瀏覽器開啟 '+origin+' ，親自完成 GitHub App 建立與單一 repository 安裝。此本機視窗會安全接收結果。',flush=True)
  threading.Thread(target=server.serve_forever,daemon=True).start()
  finished.wait(3600);server.shutdown()
  if not configuration.get('complete'):raise SystemExit('尚未完成連接；已保存的 App 金鑰仍留在 Keychain，未公開任何網站。')
