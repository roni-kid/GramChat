import time, json, os, sys
from playwright.sync_api import sync_playwright

BASE = os.environ.get("BASE", "http://localhost:5001")
OUT = os.environ.get("SHOTS", os.path.join(os.path.dirname(os.path.abspath(__file__)), "shots"))
os.makedirs(OUT, exist_ok=True)
s = int(time.time())
findings = []

def note(ok, name, detail=""):
    findings.append({"pass": bool(ok), "name": name, "detail": detail})
    print(("PASS " if ok else "FAIL ") + name + (" — " + detail if detail else ""), flush=True)

def signup(pg, name):
    pg.goto(BASE + "/signup")
    pg.get_by_placeholder("John Doe").fill(name)
    pg.get_by_placeholder("you@example.com").fill(f"{name.lower().replace(' ','')}{s}@t.com")
    pg.get_by_placeholder("••••••••").fill("secret123")
    pg.locator("button[type=submit]").click()
    pg.wait_for_url(BASE + "/", timeout=8000)

def pane(pg):
    return pg.locator("div.overflow-y-auto.space-y-4")

def open_chat(pg, name):
    pg.locator("aside button", has_text="Chats").click()
    pg.locator("aside button", has_text=name).first.click()
    pg.wait_for_timeout(500)

def theme_vars(pg):
    return pg.evaluate("""() => {
      const cs = getComputedStyle(document.documentElement);
      return cs.getPropertyValue('--color-base-100').trim() + ' | primary ' + cs.getPropertyValue('--color-primary').trim();
    }""")

with sync_playwright() as p:
    args = ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"]
    br = p.chromium.launch(args=args)
    mk = lambda **k: br.new_context(viewport={"width": 1280, "height": 800}, permissions=["camera", "microphone"], **k)
    A, B = mk().new_page(), mk().new_page()
    errsA = []
    A.on("console", lambda m: errsA.append(m.text) if m.type in ("error", "warning") else None)

    BOB=f"Bobby{s}"; ALI=f"Alicia{s}"; LATE=f"Latecomer{s}"
    signup(B, BOB); signup(A, ALI)
    A.wait_for_timeout(800)
    A.screenshot(path=f"{OUT}/02_home_empty.png")

    # new user appears in an already-open session?
    C = mk().new_page(); signup(C, LATE); A.wait_for_timeout(1200)
    note(LATE in A.locator("aside").inner_text(), "newly registered user appears in an already-open sidebar without reload",
         "user list is fetched once on mount and never refreshed")
    A.reload(); A.wait_for_timeout(1000)

    # ── THEMES
    default_theme = A.evaluate("document.documentElement.getAttribute('data-theme')")
    base_default = theme_vars(A)
    A.goto(BASE + "/settings"); A.wait_for_timeout(500)
    seen = {}
    for t in ["Light", "Dark", "Cupcake", "Dracula", "Nord", "Sunset", "Coffee"]:
        A.get_by_role("button", name=t, exact=True).click(); A.wait_for_timeout(200)
        seen[t] = theme_vars(A)
    distinct = len(set(seen.values()))
    bases = len(set(v.split("|")[0] for v in seen.values()))
    note(bases >= 5, "Settings page: 7 different themes give visibly different palettes", f"only {bases} distinct base colours across Light/Dark/Cupcake/Dracula/Nord/Sunset/Coffee")
    A.screenshot(path=f"{OUT}/03_settings.png")
    A.evaluate("localStorage.setItem('chat-theme','light')"); A.goto(BASE + "/"); A.wait_for_timeout(600)

    # ── DM basics
    open_chat(A, BOB)
    box = A.get_by_placeholder("Type a message...")
    box.fill("hello from alice"); box.press("Enter"); A.wait_for_timeout(600)
    B.reload(); B.wait_for_timeout(900); open_chat(B, ALI)
    note(pane(B).get_by_text("hello from alice").count() == 1, "DM delivered and visible to recipient")
    B.get_by_placeholder("Type a message...").fill("hi alice"); B.get_by_placeholder("Type a message...").press("Enter")
    A.wait_for_timeout(700)
    note(pane(A).get_by_text("hi alice").count() == 1, "live DM arrives in open chat")
    A.screenshot(path=f"{OUT}/04_dm_alice.png")

    # ── RACE: message arrives while own send is in flight
    A.evaluate("""() => {
      const open = XMLHttpRequest.prototype.open, send = XMLHttpRequest.prototype.send;
      XMLHttpRequest.prototype.open = function(m,u,...r){ this.__u = u; return open.call(this,m,u,...r); };
      XMLHttpRequest.prototype.send = function(...a){
        if (String(this.__u).includes('/messages/send/')) { setTimeout(() => send.apply(this,a), 1500); }
        else send.apply(this,a);
      };
    }""")
    box = A.get_by_placeholder("Type a message...")
    box.fill("my slow message"); box.press("Enter")           # request held in-page for 1.5 s
    A.wait_for_timeout(300)
    B.get_by_placeholder("Type a message...").fill("INTERLEAVED from bob"); B.get_by_placeholder("Type a message...").press("Enter")
    A.wait_for_timeout(600)
    mid_inter = pane(A).get_by_text("INTERLEAVED from bob").count()   # should already be visible via socket
    A.wait_for_timeout(2200)
    got_slow = pane(A).get_by_text("my slow message").count()
    got_inter = pane(A).get_by_text("INTERLEAVED from bob").count()
    note(got_inter == 1 and got_slow == 1, "message that arrives while you're sending is not lost from the screen",
         f"interleaved msg visible via socket before send finished: {mid_inter}x; after send finished: {got_inter}x (0 = wiped by stale-state overwrite); own msg {got_slow}x")
    A.screenshot(path=f"{OUT}/05_race.png")

    # ── unread indicators
    A.locator("button.hidden.lg\\:flex").first.click(); A.wait_for_timeout(300)
    B.get_by_placeholder("Type a message...").fill("are you there?"); B.get_by_placeholder("Type a message...").press("Enter")
    A.wait_for_timeout(900)
    side = A.locator("aside").inner_text()
    note("are you there" in side or A.locator("aside .badge").count() > 0 or A.locator("aside [class*=unread]").count() > 0,
         "chat list shows unread count / last-message preview for a closed chat",
         "sidebar shows only Online/Offline; there is no unread badge, preview, or timestamp")
    A.screenshot(path=f"{OUT}/06_sidebar_no_unread.png")

    # ── Group
    A.locator("aside button", has_text="Groups").click()
    A.get_by_role("button", name="New Group").click()
    A.get_by_placeholder("e.g. Study Squad").fill("UI Group")
    A.get_by_text(BOB).last.click()
    A.get_by_role("button", name="Create Group").click(); A.wait_for_timeout(900)
    A.locator("aside button", has_text="UI Group").click(); A.wait_for_timeout(700)
    A.get_by_placeholder("Type a message...").fill("group hello"); A.get_by_placeholder("Type a message...").press("Enter")
    A.wait_for_timeout(1000)
    note(pane(A).get_by_text("group hello", exact=True).count() == 1, "group message appears once for its sender")
    B.reload(); B.wait_for_timeout(900)
    B.locator("aside button", has_text="Groups").click(); B.locator("aside button", has_text="UI Group").click(); B.wait_for_timeout(700)
    note(pane(B).get_by_text("group hello").count() == 1, "group message visible to other member")
    # message to a group you are NOT currently viewing
    B.locator("button.hidden.lg\\:flex").first.click(); B.wait_for_timeout(300)
    A.get_by_placeholder("Type a message...").fill("while you were away"); A.get_by_placeholder("Type a message...").press("Enter"); A.wait_for_timeout(800)
    B.locator("aside button", has_text="UI Group").click(); B.wait_for_timeout(800)
    note(pane(B).get_by_text("while you were away").count() == 1, "group message sent while recipient wasn't viewing that group is there when opened (history reload)")
    A.screenshot(path=f"{OUT}/07_group.png")
    note(not any("same key" in e for e in errsA), "no React duplicate-key warnings in console")

    # ── Status
    A.goto(BASE + "/status"); A.wait_for_timeout(600)
    A.get_by_role("button", name="Add Status").click()
    A.get_by_placeholder("What's on your mind?").fill("status from alice")
    A.get_by_role("button", name="Post Status").click(); A.wait_for_timeout(800)
    note("1 update" in A.inner_text("body"), "status posts and appears under My status")
    A.screenshot(path=f"{OUT}/08_status.png")
    C.goto(BASE + "/status"); C.wait_for_timeout(900)
    note(ALI not in C.inner_text("body"), "a user who never chatted with Alice cannot see Alice's status",
         "'Latecomer' has no relationship with Alice but sees her status")

    # ── Voice call via real WebRTC
    A.goto(BASE + "/"); A.wait_for_timeout(900); open_chat(A, BOB)
    B.goto(BASE + "/"); B.wait_for_timeout(900); open_chat(B, ALI)
    A.locator("button[title='Voice call']").click()
    try:
        B.get_by_text("Incoming voice call").wait_for(timeout=5000)
        note(True, "callee gets the incoming-call screen")
        B.screenshot(path=f"{OUT}/09_incoming_call.png")
        B.locator("button.bg-green-500").click(); A.wait_for_timeout(4000)
        tA = A.locator(".font-mono").count() > 0; tB = B.locator(".font-mono").count() > 0
        note(tA and tB, "WebRTC voice call connects between two browsers (same machine / host candidates)")
        A.screenshot(path=f"{OUT}/10_call_active.png")
        A.locator("button.bg-red-500.size-16").click(); B.wait_for_timeout(900)
        note(A.locator(".font-mono").count() == 0 and B.locator(".font-mono").count() == 0, "hang-up ends the call on both sides")
    except Exception as e:
        note(False, "voice call flow", str(e).split("\n")[0][:200])

    # ── Mobile
    M = br.new_context(viewport={"width": 390, "height": 780}, device_scale_factor=2, is_mobile=True, has_touch=True).new_page()
    M.goto(BASE + "/login")
    M.get_by_placeholder("you@example.com").fill(f"{ALI.lower()}{s}@t.com"); M.get_by_placeholder("••••••••").fill("secret123")
    M.locator("button[type=submit]").click(); M.wait_for_timeout(1500)
    M.screenshot(path=f"{OUT}/11_mobile_home.png")
    M.locator("aside button", has_text=BOB).first.click(); M.wait_for_timeout(700)
    M.screenshot(path=f"{OUT}/12_mobile_chat.png")
    note(not M.evaluate("document.documentElement.scrollWidth > document.documentElement.clientWidth"), "mobile: no horizontal overflow")

    note(A.evaluate("fetch('/manifest.webmanifest').then(r=>r.status)") == 200 and A.evaluate("navigator.serviceWorker.getRegistrations().then(r=>r.length)") >= 1,
         "PWA: manifest served and service worker registered")
    br.close()

json.dump(findings, open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "last-ui-results.json"), "w"), indent=2)
print(f"\n{sum(f['pass'] for f in findings)}/{len(findings)} UI checks passed")
