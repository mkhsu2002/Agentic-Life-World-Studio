#!/usr/bin/env python3
"""Run scoped deployment commands with secrets injected from macOS Keychain."""
import json, os, subprocess, sys, urllib.request, urllib.error
ACCOUNT='82af99e90d342a30d2386efaa8ef4966'
def secret(service,account):
 r=subprocess.run(['security','find-generic-password','-s',service,'-a',account,'-w'],capture_output=True,text=True,timeout=60)
 if r.returncode:raise RuntimeError(f'Keychain entry unavailable: {service}/{account}')
 return r.stdout.strip()
def cf(path,method='GET',data=None):
 token=secret('codex.cloudflare.api_token','mkhsu')
 req=urllib.request.Request('https://api.cloudflare.com/client/v4'+path,data=json.dumps(data).encode() if data is not None else None,method=method,headers={'Authorization':'Bearer '+token,'Content-Type':'application/json'})
 try:
  with urllib.request.urlopen(req,timeout=60) as response:body=json.load(response)
 except urllib.error.HTTPError as e:
  body=json.load(e);raise RuntimeError(f'Cloudflare {e.code}: {body.get("errors")}') from None
 if not body.get('success'):raise RuntimeError(str(body.get('errors')))
 return body['result']
def wrangler(args,stdin=None):
 env=os.environ.copy();env['CLOUDFLARE_API_TOKEN']=secret('codex.cloudflare.api_token','mkhsu');env['CLOUDFLARE_ACCOUNT_ID']=ACCOUNT
 return subprocess.run(['npx','wrangler',*args],env=env,input=stdin,text=True,check=True)
if __name__=='__main__':
 if len(sys.argv)<2:raise SystemExit('Usage: cloudflare.py wrangler <args> | api <path>')
 if sys.argv[1]=='wrangler':wrangler(sys.argv[2:])
 elif sys.argv[1]=='api':print(json.dumps(cf(sys.argv[2]),ensure_ascii=False,indent=2))
 else:raise SystemExit('Unknown command')
