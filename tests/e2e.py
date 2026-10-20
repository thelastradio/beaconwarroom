"""End-to-end test against the local stack (scripts/localstack). Uses real email-code sign-in via the SMTP sink.
Run: python3 tests/e2e.py   (app on :5173, gateway on :54321)"""
import email, glob, os, quopri, re, subprocess, sys, time
from playwright.sync_api import sync_playwright, expect

APP = os.environ.get("APP", "http://127.0.0.1:5173")
MAIL = "/opt/bwr/mail"
SHOTS = os.environ.get("SHOTS", "/tmp/claude-0/bwr-shots")
os.makedirs(SHOTS, exist_ok=True)
RUN = str(int(time.time()))[-6:]
OWNER = "owner@beacon.test"
POC = f"food{RUN}@beacon.test"
CTRL = f"ctrl{RUN}@beacon.test"
VIEW = f"view{RUN}@beacon.test"
results = []


def ok(name, cond, detail=""):
    results.append((name, bool(cond)))
    print(("PASS " if cond else "FAIL ") + name + ("" if cond else f"  -> {detail}"))


def code_for(addr, since):
    for _ in range(40):
        files = sorted(glob.glob(f"{MAIL}/*_{addr.replace('@', '_at_')}.eml"))
        files = [f for f in files if int(os.path.basename(f).split("_")[0]) >= since]
        if files:
            raw = open(files[-1], "rb").read()
            msg = email.message_from_bytes(raw)
            body = ""
            for part in msg.walk():
                if part.get_content_type() in ("text/plain", "text/html"):
                    body += part.get_payload(decode=True).decode("utf8", "ignore")
            m = re.search(r"code:\s*(\d{6})", body) or re.search(r"\b(\d{6})\b", body)
            if m:
                return m.group(1)
        time.sleep(0.25)
    raise RuntimeError(f"no code email for {addr}")


def login(page, addr):
    since = int(time.time() * 1000) - 1000
    page.goto(APP)
    page.get_by_label("Email", exact=True).fill(addr)
    page.get_by_role("button", name="Email me a sign-in code").click()
    page.get_by_label("Code").wait_for()
    page.get_by_label("Code").fill(code_for(addr, since))
    page.get_by_role("button", name="Sign in").click()


def psql(sql):
    return subprocess.run(["psql", "-h", "localhost", "-p", "54322", "-U", "postgres", "-Atc", sql], capture_output=True, text=True).stdout.strip()


psql("delete from events where name like 'Demo Comedy Night %' or name like 'Second show %'; delete from auth.users where email ~ '^(food|ctrl|view)[0-9]+@beacon.test$'")

with sync_playwright() as p:
    browser = p.chromium.launch()

    def ctx(width, height, mobile=False):
        c = browser.new_context(viewport={"width": width, "height": height}, is_mobile=mobile, has_touch=mobile)
        c.route(re.compile(r"fonts\.(googleapis|gstatic)\.com"), lambda r: r.abort())
        return c

    errors = []
    owner_ctx = ctx(1600, 1000)
    owner = owner_ctx.new_page()
    owner.on("pageerror", lambda e: errors.append(f"owner: {e}"))

    # 1. unknown email is refused
    owner.goto(APP)
    owner.get_by_label("Email", exact=True).fill("stranger@beacon.test")
    owner.get_by_role("button", name="Email me a sign-in code").click()
    ok("unknown email refused with clear message", owner.get_by_text("This email has no access").is_visible() or owner.wait_for_selector("text=This email has no access", timeout=5000))

    # 2. owner signs in with emailed code
    login(owner, OWNER)
    owner.get_by_role("heading", name="Events").wait_for()
    ok("owner signed in with email code", owner.get_by_role("link", name="New event").is_visible())

    # 3. create event 2h from now in Asia/Kolkata
    owner.get_by_role("link", name="New event").click()
    ev_name = f"Demo Comedy Night {RUN}"
    owner.get_by_label("Event name").fill(ev_name)
    owner.get_by_label("Country", exact=True).fill("India")
    owner.get_by_label("City", exact=True).fill("Delhi")
    owner.get_by_label("Venue", exact=True).fill("Test Grounds")
    owner.get_by_label("Venue type").select_option("open_ground")
    owner.get_by_label("Time zone of the venue").fill("Asia/Kolkata")
    import datetime as dt
    ist = dt.datetime.now(dt.timezone(dt.timedelta(hours=5, minutes=30)))
    doors = ist + dt.timedelta(hours=2)
    end = doors + dt.timedelta(hours=4)
    owner.get_by_label("Show date").fill(doors.strftime("%Y-%m-%d"))
    owner.get_by_label("Doors", exact=True).fill(doors.strftime("%H:%M"))
    owner.get_by_label("End date (if after midnight)").fill(end.strftime("%Y-%m-%d"))
    owner.get_by_label("Show ends").fill(end.strftime("%H:%M"))
    owner.get_by_label("Capacity", exact=True).fill("4000")
    owner.get_by_label("Alcohol served", exact=True).check()
    owner.get_by_label("Food stalls", exact=True).check()
    owner.get_by_label("Artists' nationalities, comma separated").fill("India, United Kingdom")
    owner.get_by_role("button", name="Create event and start compliance research").click()
    owner.wait_for_url(re.compile(r"/e/[0-9a-f-]+/compliance"))
    eid = re.search(r"/e/([0-9a-f-]+)/", owner.url).group(1)
    ok("event created from template (154 items)", psql(f"select count(*) from items where event_id='{eid}'") == "154")
    ok("merch auto-switched off? (merch stays on, bar/food on)", psql(f"select enabled from event_departments where event_id='{eid}' and dept_key='bar'") == "t")

    # 4. compliance research runs automatically (mock research service)
    owner.wait_for_selector("text=Research finished", timeout=60000)
    owner.wait_for_selector("text=Apply for a public performance licence")
    ok("research found official permit finding", owner.get_by_text("Official source").first.is_visible())
    ok("finding with a link not seen in search is marked unverified", owner.get_by_text("Unverified — check").count() >= 1)
    ok("unseen link was stripped", owner.get_by_text("made-up.example.com").count() == 0)
    owner.screenshot(path=f"{SHOTS}/compliance.png", full_page=True)
    card = owner.locator(".card", has_text="Apply for a public performance licence")
    ok("30-day requirement flagged as inside lead time", card.get_by_text("Inside lead time").is_visible())
    card.get_by_role("button", name="Approve: add as task").click()
    owner.wait_for_selector("text=Approved: task added")
    ok("approved finding became a licensing task", psql(f"select count(*) from items where event_id='{eid}' and source='compliance' and dept_key='licensing'") == "1")
    owner.once("dialog", lambda d: d.accept("Not needed for this venue"))
    owner.locator(".card", has_text="Unsourced claim").get_by_role("button", name="Not needed").click()
    owner.wait_for_selector("text=Rejected: Not needed for this venue")
    ok("rejection stored with reason", psql(f"select reject_reason from compliance_findings where event_id='{eid}' and status='rejected'") == "Not needed for this venue")
    runs = psql(f"select searches from compliance_runs where event_id='{eid}'")
    ok("research usage recorded", runs not in ("", "0"), runs)

    # 5. people: invite controller, viewer, food POC
    owner.get_by_role("link", name="People").first.click()
    owner.get_by_role("heading", name="People").wait_for()
    first = owner.locator("section.card").first
    first.get_by_label("Email", exact=True).fill(CTRL); first.get_by_label("Name").fill("Riya Controller")
    first.get_by_role("button", name="Add person").click()
    owner.wait_for_selector(f"text=Invite emailed to {CTRL}")
    first.get_by_label("Email", exact=True).fill(VIEW); first.get_by_label("Name").fill("Promoter View"); first.get_by_label("Role").select_option("viewer")
    first.get_by_role("button", name="Add person").click()
    owner.wait_for_selector(f"text=Invite emailed to {VIEW}")
    row = owner.locator("tr", has_text="Food Stalls & Vendors")
    row.get_by_label("Email", exact=True).fill(POC); row.get_by_label("Name").fill("Sam Food")
    row.get_by_role("button", name="Add POC").click()
    owner.wait_for_selector(f"text=Invite emailed to {POC}")
    owner.wait_for_selector("text=Sam Food")
    ok("three people invited", psql(f"select count(*) from event_members where event_id='{eid}'") == "3")
    row2 = owner.locator("tr", has_text="Food Stalls & Vendors")
    ok("food POC shown in table", row2.get_by_text("Sam Food").is_visible())

    # 6. POC on a phone
    poc_ctx = ctx(390, 844, mobile=True)
    poc = poc_ctx.new_page()
    poc.on("pageerror", lambda e: errors.append(f"poc: {e}"))
    login(poc, POC)
    poc.get_by_role("link", name=ev_name).click()
    poc.wait_for_url(re.compile(r"/mine$"))
    ok("POC lands on My items", poc.get_by_role("heading", name="Food Stalls & Vendors").is_visible())
    poc.screenshot(path=f"{SHOTS}/poc-mine.png", full_page=True)
    ok("POC sees no People/Setup tabs", poc.get_by_role("link", name="People").count() == 0 and poc.get_by_role("link", name="Setup").count() == 0)

    poc.get_by_role("button", name=re.compile("Stall layout approved")).click()
    poc.get_by_role("button", name="In progress", exact=True).click()
    poc.get_by_role("button", name="Save update").click()
    poc.wait_for_selector("text=Saved: In progress")
    ok("POC status update saved", psql(f"select status from items where event_id='{eid}' and title like 'Stall layout%'") == "in_progress")

    poc.get_by_role("button", name=re.compile("Hygiene check done")).click()
    poc.get_by_role("button", name="Done", exact=True).click()
    poc.get_by_role("button", name="Save update").click()
    ok("photo required enforced in app", poc.get_by_text("needs a photo").is_visible())
    img = "/tmp/claude-0/bwr-proof.jpg"
    from PIL import Image
    Image.new("RGB", (800, 600), "#2fbf71").save(img)
    poc.locator("input[type=file]").set_input_files(img)
    poc.get_by_role("button", name="Save update").click()
    poc.wait_for_selector("text=Saved: Done")
    path = psql(f"select last_photo_path from items where event_id='{eid}' and title like 'Hygiene check%'")
    ok("photo uploaded and linked", path.startswith(eid + "/"), path)
    ok("photo stored in event folder", os.path.exists(f"/opt/bwr/storage/proofs/{path}"))

    # blocked needs a note
    poc.get_by_role("button", name=re.compile("Water and waste points")).click()
    poc.get_by_role("button", name="Blocked", exact=True).click()
    poc.get_by_role("button", name="Save update").click()
    ok("blocked requires a note", poc.get_by_text("Say what is blocking it").is_visible())
    poc.get_by_label(re.compile("Note")).fill("Water tanker stuck at gate 2")
    poc.get_by_role("button", name="Save update").click()
    poc.wait_for_selector("text=Saved: Blocked")

    # offline update queues and syncs
    poc_ctx.set_offline(True)
    poc.get_by_role("button", name=re.compile("All stalls open with price boards")).click()
    poc.get_by_role("button", name="In progress", exact=True).click()
    poc.get_by_role("button", name="Save update").click()
    poc.wait_for_selector("text=No signal. Saved on this phone")
    ok("offline update queued on phone", poc.get_by_text("1 waiting to send").is_visible())
    ok("not yet in database while offline", psql(f"select status from items where event_id='{eid}' and title like 'All stalls open%'") == "not_started")
    poc_ctx.set_offline(False)
    poc.evaluate("window.dispatchEvent(new Event('online'))")
    for _ in range(40):
        if psql(f"select status from items where event_id='{eid}' and title like 'All stalls open%'") == "in_progress":
            break
        time.sleep(0.5)
    ok("queued update synced when signal returned", psql(f"select status from items where event_id='{eid}' and title like 'All stalls open%'") == "in_progress")

    # app reopens with no signal (production build only: needs the service worker)
    if "4173" in APP:
        poc.wait_for_timeout(1500)
        poc_ctx.set_offline(True)
        poc.reload()
        poc.wait_for_selector("text=Stall layout approved", timeout=15000)
        ok("app reopens offline with last saved data", poc.get_by_text("Offline").first.is_visible())
        poc_ctx.set_offline(False)
        poc.reload()
        poc.wait_for_selector("text=Stall layout approved")

    # 7. POC raises L1, cannot close it
    poc.get_by_role("button", name="Raise incident").click()
    poc.get_by_label(re.compile("L1 Critical")).check()
    poc.get_by_label("What happened").fill("Gas smell at stall 4")
    poc.get_by_label(re.compile("Where")).fill("Food court, stall 4")
    poc.get_by_role("button", name="Raise L1 Critical").click()
    poc.wait_for_selector("text=L1 Critical raised")
    ok("L1 incident stored", psql(f"select level from incidents where event_id='{eid}' and title='Gas smell at stall 4'") == "1")
    poc.get_by_role("link", name="Incidents").last.click()
    poc.get_by_role("button", name=re.compile("Gas smell at stall 4")).click()
    ok("POC cannot close L1", poc.get_by_role("button", name="Close incident").count() == 0 and poc.get_by_text("Only the Event Controller can close an L1").is_visible())
    poc.get_by_label(re.compile("Add an update")).fill("Stall evacuated, gas off")
    poc.get_by_role("button", name="Add update").click()
    poc.wait_for_selector("text=Stall evacuated, gas off")
    poc.get_by_role("button", name="Close", exact=True).click()

    # 8. war room wall (owner) reflects POC changes
    owner.goto(f"{APP}/e/{eid}/wall")
    owner.wait_for_selector(".strip")
    food = owner.locator(".strip", has_text="Food Stalls & Vendors")
    ok("food strip is red (blocked + L1)", "red" in (food.get_attribute("class") or ""))
    ok("food strip shows reason", "blocked" in food.inner_text())
    ok("wall lists the L1 incident", owner.locator(".inc", has_text="Gas smell at stall 4").count() >= 1)
    ok("26 department strips minus switched-off ones", owner.locator(".strip").count() == int(psql(f"select count(*) from event_departments where event_id='{eid}' and enabled")))
    owner.screenshot(path=f"{SHOTS}/wall.png", full_page=True)

    # 9. controller closes the L1 and broadcasts
    ctrl_ctx = ctx(1280, 900)
    ctrl = ctrl_ctx.new_page()
    ctrl.on("pageerror", lambda e: errors.append(f"ctrl: {e}"))
    login(ctrl, CTRL)
    ctrl.get_by_role("link", name=ev_name).click()
    ctrl.wait_for_url(re.compile(r"/wall$"))
    ctrl.locator(".inc", has_text="Gas smell at stall 4").first.click()
    ctrl.get_by_label(re.compile("Add an update")).fill("Gas board confirmed safe")
    ctrl.get_by_role("button", name="Close incident").click()
    ctrl.wait_for_selector("text=Incident closed")
    ok("controller closed L1", psql(f"select status from incidents where event_id='{eid}' and title='Gas smell at stall 4'") == "closed")
    ctrl.get_by_role("button", name="Close", exact=True).click()
    ctrl.get_by_placeholder("Message to the team").fill("Doors in 15. All POCs to positions.")
    ctrl.get_by_label("Urgent").check()
    ctrl.get_by_role("button", name="Send broadcast").click()
    ctrl.wait_for_selector("text=Broadcast sent")
    ok("controller cannot see People tab", ctrl.get_by_role("link", name="People").count() == 0)

    # broadcast reaches POC (poll within 20s; no realtime locally)
    poc.get_by_role("link", name="My items").last.click()
    poc.wait_for_selector("text=Doors in 15. All POCs to positions.", timeout=30000)
    ok("broadcast shown to POC", True)
    poc.screenshot(path=f"{SHOTS}/poc-broadcast.png", full_page=False)

    # 10. viewer is read-only
    view_ctx = ctx(1280, 900)
    view = view_ctx.new_page()
    view.on("pageerror", lambda e: errors.append(f"viewer: {e}"))
    login(view, VIEW)
    view.get_by_role("link", name=ev_name).click()
    view.wait_for_url(re.compile(r"/wall$"))
    ok("viewer has no Raise incident button", view.get_by_role("button", name="Raise incident").count() == 0)
    view.locator(".strip", has_text="Security & Crowd Management").click()
    view.locator("button.item").first.click()
    ok("viewer sees no status buttons", view.get_by_role("button", name="Save update").count() == 0)

    # 11. owner removes viewer -> access gone
    owner.goto(f"{APP}/e/{eid}/people")
    owner.once("dialog", lambda d: d.accept())
    owner.locator(".row", has_text="Promoter View").get_by_role("button", name="Remove").click()
    owner.wait_for_selector("text=Access removed")
    view.goto(f"{APP}/e/{eid}/wall")
    view.wait_for_selector("text=Event not available")
    ok("removed viewer loses access", view.get_by_text("Event not available").is_visible())

    # 12. second event in same city reuses research
    owner.goto(f"{APP}/new")
    owner.get_by_label("Event name").fill(f"Second show {RUN}")
    owner.get_by_label("Country", exact=True).fill("India"); owner.get_by_label("City", exact=True).fill("Delhi")
    owner.get_by_label("Venue type").select_option("open_ground")
    owner.get_by_label("Time zone of the venue").fill("Asia/Kolkata")
    owner.get_by_label("Show date").fill((doors + dt.timedelta(days=60)).strftime("%Y-%m-%d"))
    owner.get_by_label("Alcohol served", exact=True).check(); owner.get_by_label("Food stalls", exact=True).check()
    owner.get_by_label("Artists' nationalities, comma separated").fill("United Kingdom, India")
    owner.get_by_role("button", name="Create event and start compliance research").click()
    owner.wait_for_selector("text=Reused research from another event", timeout=30000)
    ok("research reused for same city and facts", True)

    ok("no JavaScript errors", not errors, errors[:3])
    browser.close()

failed = [n for n, c in results if not c]
print(f"\n{len(results) - len(failed)}/{len(results)} passed")
sys.exit(1 if failed else 0)
