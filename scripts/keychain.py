"""macOS secure storage; values never appear in process arguments or output."""
import ctypes,subprocess

def native_read(service,account):
 cf=ctypes.CDLL('/System/Library/Frameworks/CoreFoundation.framework/CoreFoundation')
 sec=ctypes.CDLL('/System/Library/Frameworks/Security.framework/Security')
 ptr=ctypes.c_void_p
 cf.CFStringCreateWithCString.argtypes=[ptr,ctypes.c_char_p,ctypes.c_uint32];cf.CFStringCreateWithCString.restype=ptr
 cf.CFDictionaryCreateMutable.argtypes=[ptr,ctypes.c_long,ptr,ptr];cf.CFDictionaryCreateMutable.restype=ptr
 cf.CFDictionarySetValue.argtypes=[ptr,ptr,ptr]
 cf.CFDataGetLength.argtypes=[ptr];cf.CFDataGetLength.restype=ctypes.c_long
 cf.CFDataGetBytePtr.argtypes=[ptr];cf.CFDataGetBytePtr.restype=ptr
 sec.SecItemCopyMatching.argtypes=[ptr,ctypes.POINTER(ptr)];sec.SecItemCopyMatching.restype=ctypes.c_int32
 constant=lambda name:ptr.in_dll(sec,name)
 string=lambda value:cf.CFStringCreateWithCString(None,value.encode(),0x08000100)
 query=cf.CFDictionaryCreateMutable(None,0,None,None)
 pairs=[('kSecClass',constant('kSecClassGenericPassword')),('kSecAttrService',string(service)),('kSecAttrAccount',string(account)),('kSecReturnData',ptr.in_dll(cf,'kCFBooleanTrue'))]
 for key,value in pairs:cf.CFDictionarySetValue(query,constant(key),value)
 result=ptr();status=sec.SecItemCopyMatching(query,ctypes.byref(result))
 if status==-25300:return None
 if status!=0:raise RuntimeError(f'Keychain read failed: {status}')
 return ctypes.string_at(cf.CFDataGetBytePtr(result),cf.CFDataGetLength(result)).decode()

def read(service,account):
 if service=='agentic.world.studio':return native_read(service,account)
 r=subprocess.run(['security','find-generic-password','-s',service,'-a',account,'-w'],capture_output=True,text=True,timeout=60)
 return r.stdout.strip() if r.returncode==0 else None

def write(service,account,value):
 cf=ctypes.CDLL('/System/Library/Frameworks/CoreFoundation.framework/CoreFoundation')
 sec=ctypes.CDLL('/System/Library/Frameworks/Security.framework/Security')
 ptr=ctypes.c_void_p
 cf.CFStringCreateWithCString.argtypes=[ptr,ctypes.c_char_p,ctypes.c_uint32];cf.CFStringCreateWithCString.restype=ptr
 cf.CFDataCreate.argtypes=[ptr,ptr,ctypes.c_long];cf.CFDataCreate.restype=ptr
 cf.CFDictionaryCreateMutable.argtypes=[ptr,ctypes.c_long,ptr,ptr];cf.CFDictionaryCreateMutable.restype=ptr
 cf.CFDictionarySetValue.argtypes=[ptr,ptr,ptr]
 sec.SecItemAdd.argtypes=[ptr,ptr];sec.SecItemAdd.restype=ctypes.c_int32
 def constant(name):return ptr.in_dll(sec,name)
 def string(s):return cf.CFStringCreateWithCString(None,s.encode(),0x08000100)
 query=cf.CFDictionaryCreateMutable(None,0,None,None)
 for k,v in [('kSecClass',constant('kSecClassGenericPassword')),('kSecAttrService',string(service)),('kSecAttrAccount',string(account))]:cf.CFDictionarySetValue(query,constant(k),v)
 data=value.encode();buffer=ctypes.create_string_buffer(data);cf.CFDictionarySetValue(query,constant('kSecValueData'),cf.CFDataCreate(None,ctypes.cast(buffer,ptr),len(data)))
 result=sec.SecItemAdd(query,None)
 if result!=0:raise RuntimeError(f'Keychain storage failed: {result}')

def update(service,account,value):
 if read(service,account) is None:
  write(service,account,value);return
 cf=ctypes.CDLL('/System/Library/Frameworks/CoreFoundation.framework/CoreFoundation')
 sec=ctypes.CDLL('/System/Library/Frameworks/Security.framework/Security')
 ptr=ctypes.c_void_p
 cf.CFStringCreateWithCString.argtypes=[ptr,ctypes.c_char_p,ctypes.c_uint32];cf.CFStringCreateWithCString.restype=ptr
 cf.CFDataCreate.argtypes=[ptr,ptr,ctypes.c_long];cf.CFDataCreate.restype=ptr
 cf.CFDictionaryCreateMutable.argtypes=[ptr,ctypes.c_long,ptr,ptr];cf.CFDictionaryCreateMutable.restype=ptr
 cf.CFDictionarySetValue.argtypes=[ptr,ptr,ptr]
 sec.SecItemUpdate.argtypes=[ptr,ptr];sec.SecItemUpdate.restype=ctypes.c_int32
 constant=lambda name:ptr.in_dll(sec,name)
 string=lambda text:cf.CFStringCreateWithCString(None,text.encode(),0x08000100)
 query=cf.CFDictionaryCreateMutable(None,0,None,None)
 for key,item in [('kSecClass',constant('kSecClassGenericPassword')),('kSecAttrService',string(service)),('kSecAttrAccount',string(account))]:cf.CFDictionarySetValue(query,constant(key),item)
 attributes=cf.CFDictionaryCreateMutable(None,0,None,None)
 raw=value.encode();buffer=ctypes.create_string_buffer(raw)
 cf.CFDictionarySetValue(attributes,constant('kSecValueData'),cf.CFDataCreate(None,ctypes.cast(buffer,ptr),len(raw)))
 status=sec.SecItemUpdate(query,attributes)
 if status:raise RuntimeError(f'Keychain update failed: {status}')
