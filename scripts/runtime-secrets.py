#!/usr/bin/env python3
import json,os,secrets,subprocess,sys
from keychain import read,write
from cloudflare import wrangler

def values():
 meta=json.loads(read('ai.meta.dev.credentials','meta') or '{}')
 key=read('agentic.world.studio','meta-api-key') or meta.get('api_key')
 if not key:raise RuntimeError('Meta API key missing from secure storage')
 result={'MODEL_API_KEY':key}
 for name,account in [('STUDIO_PASSWORD','owner-password'),('SESSION_SECRET','session-secret')]:
  value=read('agentic.world.studio',account)
  if not value:
   value=secrets.token_urlsafe(32);write('agentic.world.studio',account,value)
  result[name]=value
 return result
if __name__=='__main__':
 if sys.argv[1]=='deploy':
  for target in sys.argv[2:]:wrangler(['secret','bulk','--env',target],json.dumps(values()))
 elif sys.argv[1]=='local':
  env=os.environ.copy();env.update(values());env['CLOUDFLARE_INCLUDE_PROCESS_ENV']='true'
  subprocess.run(['npx','wrangler','dev','--env','dev','--port','8787'],env=env,check=True)
 else:raise SystemExit('Use deploy <environment> or local')
