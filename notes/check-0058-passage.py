import subprocess, sys, urllib.request
REDIRECT = "read `application_resources` for what the app actually requested"
PATH = "public/skills/bioengine/SKILL.md"
def blob(ref):
    return subprocess.run(["git","show",f"{ref}:{PATH}"],capture_output=True,text=True,check=True).stdout.splitlines()
def scan(lines):
    off  = [i for i,l in enumerate(lines,1) if REDIRECT in l.lower() and "max_ongoing_requests" in l]
    keep = [i for i,l in enumerate(lines,1) if REDIRECT in l.lower() and "max_ongoing_requests" not in l
            and "memory" in l and "gpu_enabled" in l]
    proxy = sum("proxy admission limit" in l for l in lines)
    return off, keep, proxy
fail = 0
base_off, base_keep, base_proxy = scan(blob("eccc667^"))
fix_off,  fix_keep,  fix_proxy  = scan(blob("eccc667"))
print(f"CONTROL  base eccc667^ : offenders={len(base_off)} (want 1)  clean={len(base_keep)} (want 0)  'proxy admission limit'={base_proxy} (want 0)")
if (len(base_off),len(base_keep),base_proxy) != (1,0,0):
    print("  -> CONTROL DID NOT FIRE: this check is inert, ignore its verdict"); fail = 2
print(f"CLAUSE 1 fix  eccc667  : offenders={len(fix_off)} (want 0)")
if fix_off: print("  -> FAIL"); fail = fail or 1
print(f"CLAUSE 1 fix  eccc667  : 'proxy admission limit'={fix_proxy} (want >=1)")
if fix_proxy < 1: print("  -> FAIL"); fail = fail or 1
print(f"CLAUSE 3 fix  eccc667  : clean memory+gpu_enabled redirects={len(fix_keep)} (want >=1) at {fix_keep}")
if not fix_keep: print("  -> FAIL"); fail = fail or 1
url = "https://bioimage.io/skills/bioengine/SKILL.md"
body = urllib.request.urlopen(url, timeout=30).read().decode("utf-8","replace")
served = body.splitlines()
spa = ("<!doctype html" in body.lower()) or ('id="root"' in body)
s_off, s_keep, s_proxy = scan(served)
print(f"CLAUSE 4 served        : lines={len(served)} spa_fallback={spa} offenders={len(s_off)} 'proxy admission limit'={s_proxy}")
if spa: print("  -> SPA fallback, body is not the doc: inert"); fail = 2
elif s_off: print("  -> NOT YET DEPLOYED: production still carries the defect (expected until PR #133 merges)")
else: print("  -> deployed")
print("VERDICT:", {0:"PASS",1:"FAIL",2:"INERT"}[fail])
sys.exit(fail)
