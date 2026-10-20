"""Access-rule tests against a local Postgres that has the migrations applied.
Run: python3 tests/rls_test.py   (env PGPORT, default 54322)"""
import json, os, subprocess, sys, uuid

PORT = os.environ.get("PGPORT", "54322")
U = {k: str(uuid.uuid4()) for k in ["owner", "ctrl", "food", "lic", "sec", "viewer", "outsider"]}
fails = []


def psql(sql, as_user=None):
    pre = ""
    if as_user:
        claims = json.dumps({"sub": U[as_user], "role": "authenticated"})
        pre = f"set local role authenticated; select set_config('request.jwt.claims', '{claims}', true);"
    full = f"begin; {pre} {sql}; commit;"
    r = subprocess.run(["psql", "-h", "localhost", "-p", PORT, "-U", "postgres", "-At", "-q", "-v", "ON_ERROR_STOP=1", "-c", full],
                       capture_output=True, text=True)
    out = [l for l in r.stdout.strip().splitlines() if l and not l.startswith('{"sub"')]
    return r.returncode == 0, (out[-1] if out else ""), r.stderr.strip()


def check(name, ok, detail=""):
    print(("PASS " if ok else "FAIL ") + name + ("" if ok else f"  -> {detail}"))
    if not ok:
        fails.append(name)


def expect_ok(name, sql, user, want=None):
    ok, out, err = psql(sql, user)
    check(name, ok and (want is None or out == str(want)), f"ok={ok} out={out!r} err={err[:200]}")
    return out


def expect_err(name, sql, user, contains=""):
    ok, out, err = psql(sql, user)
    check(name, (not ok) and contains in err, f"ok={ok} out={out!r} err={err[:200]}")


# --- users (clean previous test run first) ---
psql("delete from public.events where name in ('Demo Fest','X'); delete from auth.users where email like '%@test.local'")
for k, uid in U.items():
    psql(f"insert into auth.users (id, email, aud, role, instance_id, confirmation_token, recovery_token, email_change_token_new, email_change) values ('{uid}', '{k}@test.local', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000', '', '', '', '')")
psql(f"update public.profiles set is_owner = true where id = '{U['owner']}'")

# --- event creation ---
expect_err("non-owner cannot create event",
           "select public.create_event('X','India','Delhi','','open_ground','Asia/Kolkata', now()+interval '40 days', now()+interval '40 days 6 hours', 1000, true, true, true, false, '{}')",
           "ctrl", "only the owner")
EID = expect_ok("owner creates event",
                "select public.create_event('Demo Fest','India','Delhi','Test Ground','open_ground','Asia/Kolkata', now()+interval '40 days', now()+interval '40 days 6 hours', 5000, true, true, true, false, '{IN,GB}', '{merch}')",
                "owner")
expect_ok("template copied into 154 items", f"select count(*) from public.items where event_id='{EID}'", "owner", 154)
expect_ok("merch department disabled", f"select enabled from public.event_departments where event_id='{EID}' and dept_key='merch'", "owner", "f")

# --- members (normally added by the invite server function with the service role) ---
psql(f"""insert into public.event_members (event_id,user_id,role,dept_key) values
 ('{EID}','{U['ctrl']}','controller',null), ('{EID}','{U['food']}','poc','food'),
 ('{EID}','{U['lic']}','poc','licensing'), ('{EID}','{U['sec']}','poc','security'), ('{EID}','{U['viewer']}','viewer',null)""")
expect_err("second POC for same department refused",
           f"insert into public.event_members (event_id,user_id,role,dept_key) values ('{EID}','{U['outsider']}','poc','food')", None, "event_members_one_poc")
expect_err("member cannot add members directly",
           f"insert into public.event_members (event_id,user_id,role,dept_key) values ('{EID}','{U['outsider']}','viewer',null)", "ctrl", "row-level security")

FOOD_ITEM = psql(f"select id from public.items where event_id='{EID}' and dept_key='food' and not photo_required order by sort limit 1")[1]
FOOD_PHOTO = psql(f"select id from public.items where event_id='{EID}' and dept_key='food' and photo_required limit 1")[1]
SEC_ITEM = psql(f"select id from public.items where event_id='{EID}' and dept_key='security' limit 1")[1]

# --- visibility ---
expect_ok("outsider sees no events", "select count(*) from public.events", "outsider", 0)
expect_ok("outsider sees no items", "select count(*) from public.items", "outsider", 0)
expect_ok("viewer sees all items", f"select count(*) from public.items where event_id='{EID}'", "viewer", 154)
expect_ok("POC sees all items (overview)", f"select count(*) from public.items where event_id='{EID}'", "food", 154)

# --- status updates ---
expect_ok("food POC updates own item", f"insert into public.item_updates (item_id,event_id,status,note) values ('{FOOD_ITEM}','{EID}','in_progress','started') returning status", "food", "in_progress")
expect_ok("item status changed by trigger", f"select status from public.items where id='{FOOD_ITEM}'", "owner", "in_progress")
expect_err("food POC cannot update security item", f"insert into public.item_updates (item_id,event_id,status) values ('{SEC_ITEM}','{EID}','done')", "food", "row-level security")
expect_err("viewer cannot update any item", f"insert into public.item_updates (item_id,event_id,status) values ('{FOOD_ITEM}','{EID}','done')", "viewer", "row-level security")
expect_err("POC cannot set status column directly", f"update public.items set status='done' where id='{FOOD_ITEM}'", "food", "permission denied")
expect_ok("POC cannot edit item title (0 rows)", f"with u as (update public.items set title='x' where id='{FOOD_ITEM}' returning 1) select count(*) from u", "food", 0)
expect_err("cannot spoof created_by", f"insert into public.item_updates (item_id,event_id,status,created_by) values ('{FOOD_ITEM}','{EID}','done','{U['ctrl']}')", "food", "row-level security")
expect_err("photo required before done", f"insert into public.item_updates (item_id,event_id,status) values ('{FOOD_PHOTO}','{EID}','done')", "food", "photo_required")
expect_ok("done with photo accepted", f"insert into public.item_updates (item_id,event_id,status,photo_path) values ('{FOOD_PHOTO}','{EID}','done','{EID}/x.jpg') returning status", "food", "done")
expect_ok("controller updates any department", f"insert into public.item_updates (item_id,event_id,status) values ('{SEC_ITEM}','{EID}','blocked') returning status", "ctrl", "blocked")
expect_ok("stale offline update is recorded but not applied",
          f"insert into public.item_updates (item_id,event_id,status,client_at) values ('{FOOD_ITEM}','{EID}','done', now() - interval '1 hour') returning applied", "food", "f")
expect_ok("item kept newer status", f"select status from public.items where id='{FOOD_ITEM}'", "owner", "in_progress")
expect_ok("history cannot be edited (0 rows)", f"with u as (update public.item_updates set note='edited' where item_id='{FOOD_ITEM}' returning 1) select count(*) from u", "ctrl", 0)
expect_ok("history rows unchanged after update attempt", f"select count(*) from public.item_updates where note='edited'", "owner", 0)
expect_ok("history cannot be deleted (0 rows)", f"with d as (delete from public.item_updates where item_id='{FOOD_ITEM}' returning 1) select count(*) from d", "ctrl", 0)

# --- incidents ---
INC1 = expect_ok("POC raises L1 incident", f"insert into public.incidents (event_id,level,dept_key,title) values ('{EID}',1,'food','Gas leak at stall 4') returning id", "food")
expect_err("viewer cannot raise incident", f"insert into public.incidents (event_id,level,dept_key,title) values ('{EID}',3,'food','x')", "viewer", "row-level security")
expect_err("POC cannot close L1", f"select public.close_incident('{INC1}','fixed')", "food", "only the Event Controller")
expect_ok("controller closes L1", f"select public.close_incident('{INC1}','gas shut, stall closed'); select status from public.incidents where id='{INC1}'", "ctrl", "closed")
INC2 = expect_ok("POC raises L2 in own dept", f"insert into public.incidents (event_id,level,dept_key,title) values ('{EID}',2,'food','Water out') returning id", "food")
expect_ok("POC closes own L2", f"select public.close_incident('{INC2}','refilled'); select status from public.incidents where id='{INC2}'", "food", "closed")
INC3 = expect_ok("security raises L3", f"insert into public.incidents (event_id,level,dept_key,title) values ('{EID}',3,'security','Scanner down gate 2') returning id", "sec")
expect_err("food POC cannot close security incident", f"select public.close_incident('{INC3}','x')", "food", "only the Event Controller or this department")
expect_err("POC cannot raise incident as someone else", f"insert into public.incidents (event_id,level,dept_key,title,raised_by) values ('{EID}',3,'food','x','{U['ctrl']}')", "food", "row-level security")

# --- broadcasts ---
expect_ok("controller sends broadcast to all", f"insert into public.broadcasts (event_id,message) values ('{EID}','Doors in 10') returning message", "ctrl", "Doors in 10")
expect_ok("controller sends to security only", f"insert into public.broadcasts (event_id,dept_key,message) values ('{EID}','security','Gate 3 surge') returning message", "ctrl", "Gate 3 surge")
expect_err("POC cannot broadcast", f"insert into public.broadcasts (event_id,message) values ('{EID}','hi')", "food", "row-level security")
expect_ok("food POC sees only all-hands broadcast", f"select count(*) from public.broadcasts where event_id='{EID}'", "food", 1)
expect_ok("security POC sees both", f"select count(*) from public.broadcasts where event_id='{EID}'", "sec", 2)

# --- compliance ---
RUN = psql(f"insert into public.compliance_runs (event_id,cache_key,status) values ('{EID}','IN|delhi|open_ground','done') returning id")[1]
F1 = psql(f"insert into public.compliance_findings (run_id,event_id,category,requirement,authority,lead_time_days,source_url,official) values ('{RUN}','{EID}','permit','Performance licence','Delhi Police Licensing',30,'https://licensing.delhipolice.gov.in/home/performance',true) returning id")[1]
F2 = psql(f"insert into public.compliance_findings (run_id,event_id,category,requirement,official) values ('{RUN}','{EID}','alcohol','Liquor permit',false) returning id")[1]
expect_ok("food POC cannot see findings", f"select count(*) from public.compliance_findings where event_id='{EID}'", "food", 0)
expect_ok("licensing POC sees findings", f"select count(*) from public.compliance_findings where event_id='{EID}'", "lic", 2)
expect_err("food POC cannot review", f"select public.review_finding('{F1}', true)", "food", "not allowed")
expect_ok("licensing POC approves -> task created", f"select public.review_finding('{F1}', true); select i.dept_key from public.items i where i.finding_id = '{F1}'", "lic", "licensing")
expect_ok("task due 30 days before start", f"select (select e.starts_at - i.due_at from public.items i join public.events e on e.id=i.event_id where i.finding_id='{F1}')", "owner", "30 days")
expect_err("reject needs reason", f"select public.review_finding('{F2}', false, '')", "lic", "reason is required")
expect_ok("reject with reason", f"select public.review_finding('{F2}', false, 'No alcohol at this show'); select status from public.compliance_findings where id='{F2}'", "lic", "rejected")
expect_err("findings not writable by users", f"insert into public.compliance_findings (run_id,event_id,category,requirement) values ('{RUN}','{EID}','x','y')", "ctrl", "row-level security")

# --- profiles ---
OWNERS = int(psql("select count(*) from public.profiles where is_owner")[1])
expect_ok("outsider sees only own + owner profiles", "select count(*) from public.profiles", "outsider", 1 + OWNERS)
expect_ok("POC sees teammates + owners", "select count(*) from public.profiles", "food", 5 + OWNERS)
expect_err("cannot make self owner", f"update public.profiles set is_owner=true where id='{U['food']}'", "food", "permission denied")
expect_ok("can set own name", f"update public.profiles set full_name='Food Lead' where id='{U['food']}' returning full_name", "food", "Food Lead")

# --- membership removal ---
expect_ok("controller cannot remove members (0 rows)", f"with d as (delete from public.event_members where event_id='{EID}' and user_id='{U['viewer']}' returning 1) select count(*) from d", "ctrl", 0)
expect_ok("owner removes viewer", f"with d as (delete from public.event_members where event_id='{EID}' and user_id='{U['viewer']}' returning 1) select count(*) from d", "owner", 1)
expect_ok("removed viewer loses access immediately", "select count(*) from public.items", "viewer", 0)

print(f"\n{len(fails)} failed" if fails else "\nALL PASSED")
sys.exit(1 if fails else 0)
