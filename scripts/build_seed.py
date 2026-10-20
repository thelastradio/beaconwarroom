"""Generates supabase/migrations/0003_seed.sql (departments + checklist templates).
Edit the lists below, then run: python3 scripts/build_seed.py
offset = minutes from the anchor ('start' = doors/show start, 'end' = show end). Negative = before.
Flags: C = critical, P = photo required."""
from pathlib import Path

D = 1440  # minutes per day

DEPTS = [
    ("control", "Event Control & Contingency", "War room, decision log, weather, show-stop calls"),
    ("licensing", "Licensing & Compliance", "Every permit and licence for the event"),
    ("site", "Venue & Site", "Layout, barriers, signage, temporary structures"),
    ("stage", "Stage & Rigging", "Stages, trusses, working at height"),
    ("tech", "Sound, Light & AV", "PA, lights, LED, recording"),
    ("power", "Power & Generators", "Mains, generators, distribution"),
    ("show", "Show & Stage Management", "Run of show per stage, cues, delays"),
    ("artist", "Artist Relations", "Calls, travel, riders, check-in"),
    ("hospitality", "Hospitality & Green Room", "Artist and VIP lounges, talent and crew F&B"),
    ("ticketing", "Ticketing, Box Office & Accreditation", "Sales, scanning, guest list, passes"),
    ("security", "Security & Crowd Management", "Gates, frisking, stewards, capacity"),
    ("medical", "Medical & First Aid", "First-aid posts, ambulances, hospital tie-up"),
    ("fire", "Fire Safety", "Extinguishers, fire-retardant materials, fire sign-off"),
    ("food", "Food Stalls & Vendors", "Every food and drink stall"),
    ("bar", "Bar & Alcohol", "Bars, age checks, last call"),
    ("sanitation", "Sanitation, Water & Waste", "Toilets, drinking water, housekeeping, waste"),
    ("transport", "Transport, Parking & Traffic", "Parking, drop-off, emergency access"),
    ("logistics", "Logistics, Deliveries & Inventory", "Load-in schedule, storage, returns"),
    ("comms", "Radio, PA & Connectivity", "Radios, channels, PA announcements, Wi-Fi, POS network"),
    ("sponsorship", "Sponsorship & Brand Activations", "Sponsor deliverables, booths"),
    ("marketing", "Marketing, Social & Content", "On-site content, live posts"),
    ("media", "Media & PR", "Press, media passes, crisis statements"),
    ("merch", "Merchandise", "Merch stock, stalls, sales"),
    ("finance", "Finance & Cash", "Floats, vendor payments, settlements"),
    ("staffing", "Staffing, Volunteers & Worker Welfare", "Rosters, briefings, crew food and rest"),
    ("guest", "Guest Services & Accessibility", "Info desk, lost and found, lost children, accessibility"),
]

# (dept, phase, anchor, offset_minutes, flags, title)
T = [
    ("control", "planning", "start", -14 * D, "C", "Emergency and evacuation plan written and shared"),
    ("control", "planning", "start", -7 * D, "C", "Contacts sheet shared: agencies, hospital, venue, all POCs"),
    ("control", "planning", "start", -3 * D, "", "Site grid map marked with security, medical, fire points and exits"),
    ("control", "planning", "start", -1 * D, "C", "Weather forecast checked; delay and cancel triggers agreed"),
    ("control", "live", "start", -240, "C", "All-department briefing done"),
    ("control", "live", "start", -120, "", "Weather re-checked"),
    ("control", "live", "start", -60, "C", "Go / no-go call for doors"),
    ("control", "live", "end", 0, "C", "Show-end call made; egress plan active"),
    ("control", "debrief", "end", 2 * D, "", "Debrief meeting held; logs exported"),

    ("licensing", "planning", "start", -30 * D, "C", "Compliance research reviewed: every finding approved or rejected"),
    ("licensing", "planning", "start", -7 * D, "", "Copies of all permits collected in one folder"),
    ("licensing", "live", "start", -180, "CP", "All permits and licences on site (photo of folder)"),

    ("site", "planning", "start", -14 * D, "C", "Site layout with exits signed off"),
    ("site", "build", "start", -1 * D, "P", "Barriers installed per plan"),
    ("site", "build", "start", -1 * D, "P", "Signage up: exits, toilets, first aid, info"),
    ("site", "build", "start", -720, "C", "Temporary structures certified or signed off"),
    ("site", "live", "start", -90, "CP", "All exits and escape routes clear"),
    ("site", "live", "start", -60, "", "Accessible route open and marked"),
    ("site", "breakdown", "end", 240, "P", "Site cleared and handed back to venue"),

    ("stage", "planning", "start", -7 * D, "", "Rigging plan and load calculations received"),
    ("stage", "build", "start", -1 * D, "CP", "Rigging signed off by a certified rigger"),
    ("stage", "build", "start", -1 * D, "", "Working-at-height permits issued"),
    ("stage", "build", "start", -720, "", "Stage edges, steps and handrails checked"),
    ("stage", "live", "start", -120, "C", "Stages cleared of crew and kit before doors"),
    ("stage", "breakdown", "end", 60, "", "De-rig started with exclusion zone set"),
    ("stage", "breakdown", "end", 360, "", "De-rig complete"),

    ("tech", "planning", "start", -7 * D, "", "Tech riders received for all acts"),
    ("tech", "build", "start", -720, "", "Line check done on every stage"),
    ("tech", "build", "start", -360, "", "Lighting focused and show files loaded"),
    ("tech", "live", "start", -180, "", "LED and screens tested with all content"),
    ("tech", "live", "start", -120, "C", "Mic check on every stage; backup mics ready"),
    ("tech", "live", "start", -90, "", "Backup playback ready"),
    ("tech", "live", "start", -60, "", "Sound levels set within the noise limit"),
    ("tech", "breakdown", "end", 180, "", "Kit packed and counted"),

    ("power", "planning", "start", -7 * D, "", "Load plan for every stage and stall"),
    ("power", "build", "start", -1 * D, "C", "Generators on site with full fuel"),
    ("power", "build", "start", -1 * D, "C", "Earthing tested"),
    ("power", "build", "start", -720, "C", "Electrical inspection done; certificate on file"),
    ("power", "live", "start", -120, "C", "Standby generator tested"),
    ("power", "live", "start", 120, "", "Fuel levels checked mid-show"),
    ("power", "breakdown", "end", 120, "", "Power safely isolated"),

    ("show", "planning", "start", -3 * D, "", "Running order locked for every stage"),
    ("show", "planning", "start", -1 * D, "", "Call sheets issued with Artist Relations"),
    ("show", "live", "start", -180, "", "Stage clocks synced to the war room"),
    ("show", "live", "start", -60, "C", "Stage managers on radio on every stage"),
    ("show", "live", "start", -15, "C", "First act standing by"),
    ("show", "live", "end", 0, "", "Final slot finished; stages closed"),

    ("artist", "planning", "start", -7 * D, "", "Riders confirmed for all artists"),
    ("artist", "planning", "start", -3 * D, "C", "Travel and hotels confirmed"),
    ("artist", "planning", "start", -1 * D, "C", "Call sheets sent and acknowledged"),
    ("artist", "planning", "start", -1 * D, "", "Pickups scheduled"),
    ("artist", "live", "start", -240, "", "Green room ready with passes"),
    ("artist", "live", "start", -180, "C", "Early-call artists arrived"),
    ("artist", "live", "end", 60, "", "All artists departed; drops done"),

    ("hospitality", "planning", "start", -3 * D, "", "Rider food and drink ordered"),
    ("hospitality", "live", "start", -300, "P", "Green rooms stocked to rider"),
    ("hospitality", "live", "start", -240, "", "Crew meals ready"),
    ("hospitality", "live", "start", -180, "", "VIP lounge ready"),
    ("hospitality", "live", "end", 0, "", "Green rooms cleared"),

    ("ticketing", "planning", "start", -1 * D, "C", "Guest list final"),
    ("ticketing", "planning", "start", -1 * D, "", "Accreditation passes printed by zone"),
    ("ticketing", "build", "start", -720, "C", "Scanners tested on the venue network"),
    ("ticketing", "live", "start", -120, "", "Box office open with float issued"),
    ("ticketing", "live", "start", -60, "C", "Every entry gate staffed with scanners"),
    ("ticketing", "live", "end", 0, "", "Final attendance count logged"),

    ("security", "planning", "start", -14 * D, "C", "Security agency licence verified"),
    ("security", "planning", "start", -3 * D, "", "Deployment plan by gate and zone"),
    ("security", "live", "start", -240, "C", "Anti-sabotage sweep done"),
    ("security", "live", "start", -180, "", "Metal detectors working at every gate"),
    ("security", "live", "start", -120, "C", "Steward briefing done"),
    ("security", "live", "start", -60, "C", "Restricted areas secured: backstage, tech, cash"),
    ("security", "live", "end", 0, "C", "Egress staffed and all exits open"),

    ("medical", "planning", "start", -7 * D, "C", "Medical provider confirmed"),
    ("medical", "planning", "start", -1 * D, "C", "Nearest hospital told about the event"),
    ("medical", "live", "start", -180, "CP", "First-aid posts staffed and stocked"),
    ("medical", "live", "start", -180, "C", "Ambulance on site with a clear route out"),
    ("medical", "live", "start", -120, "", "Medical team on the radio channel"),
    ("medical", "live", "end", 60, "", "Patient log submitted"),

    ("fire", "planning", "start", -7 * D, "", "Fire-retardant certificates collected for fabric and drapes"),
    ("fire", "build", "start", -720, "C", "Fire inspection done; certificate on file"),
    ("fire", "build", "start", -360, "P", "Extinguishers placed per map"),
    ("fire", "live", "start", -120, "C", "Fire marshals briefed and in position"),
    ("fire", "live", "start", -60, "", "Fire exits unlocked and clear"),
    ("fire", "live", "end", 0, "", "Final fire check after close"),

    ("food", "planning", "start", -7 * D, "C", "Food-safety registration collected from every stall"),
    ("food", "planning", "start", -3 * D, "", "Stall layout approved and clear of exits"),
    ("food", "build", "start", -720, "C", "Only commercial gas cylinders at every stall"),
    ("food", "live", "start", -180, "P", "Hygiene check done at every stall"),
    ("food", "live", "start", -120, "", "Water and waste points at the food court"),
    ("food", "live", "start", -60, "", "All stalls open with price boards"),
    ("food", "live", "end", 30, "", "Stalls closed, gas off, waste handed over"),

    ("bar", "planning", "start", -3 * D, "C", "Liquor permit on file"),
    ("bar", "live", "start", -180, "P", "Permit displayed at every bar"),
    ("bar", "live", "start", -120, "C", "Age-check process briefed to bar staff"),
    ("bar", "live", "start", -60, "", "Bars stocked and POS working"),
    ("bar", "live", "end", -30, "", "Last call announced"),
    ("bar", "live", "end", 0, "", "Bars closed and stock counted"),

    ("sanitation", "planning", "start", -3 * D, "", "Toilet count and cleaning schedule set"),
    ("sanitation", "planning", "start", -3 * D, "C", "Waste collector booked; local body notified if required"),
    ("sanitation", "build", "start", -360, "", "Segregated waste bins placed"),
    ("sanitation", "live", "start", -120, "P", "Toilets clean and stocked"),
    ("sanitation", "live", "start", -120, "", "Drinking water points full"),
    ("sanitation", "live", "start", 120, "", "Mid-show toilet cleaning round done"),
    ("sanitation", "breakdown", "end", 240, "P", "Segregated waste handed to authorised collector"),

    ("transport", "planning", "start", -7 * D, "C", "Traffic and police approval in place"),
    ("transport", "planning", "start", -1 * D, "", "Parking plan and marshals assigned"),
    ("transport", "live", "start", -180, "C", "Emergency vehicle lane clear"),
    ("transport", "live", "start", -120, "", "Drop-off zone and signage set"),
    ("transport", "live", "end", -15, "", "Exit traffic plan active"),
    ("transport", "live", "end", 60, "", "Parking cleared"),

    ("logistics", "planning", "start", -3 * D, "", "Delivery slots confirmed with all vendors"),
    ("logistics", "build", "start", -1 * D, "", "Inventory received and checked in"),
    ("logistics", "build", "start", -720, "", "Storage areas locked"),
    ("logistics", "breakdown", "end", 360, "", "Inventory checked out and signed"),
    ("logistics", "breakdown", "end", 1 * D, "", "Rentals returned"),

    ("comms", "planning", "start", -1 * D, "", "Radio channel plan and call signs issued"),
    ("comms", "build", "start", -720, "", "Wi-Fi and POS network tested"),
    ("comms", "live", "start", -240, "C", "Radios charged and issued with sign-out log"),
    ("comms", "live", "start", -120, "C", "Emergency PA scripts loaded and tested"),
    ("comms", "live", "start", -60, "", "Radio check on all channels"),
    ("comms", "live", "end", 60, "", "Radios returned and counted"),

    ("sponsorship", "planning", "start", -3 * D, "", "Deliverables list confirmed per sponsor"),
    ("sponsorship", "build", "start", -720, "P", "Logo placements installed"),
    ("sponsorship", "live", "start", -60, "", "Activations staffed and open"),
    ("sponsorship", "live", "start", 60, "P", "Proof-of-delivery photos captured"),
    ("sponsorship", "debrief", "end", 3 * D, "", "Sponsor report sent"),

    ("marketing", "planning", "start", -1 * D, "", "On-site content plan and shot list shared"),
    ("marketing", "live", "start", -180, "", "Content team briefed with access passes"),
    ("marketing", "live", "start", -60, "", "Filming-consent signs at entrances"),
    ("marketing", "live", "start", 0, "", "Live posts going out"),
    ("marketing", "debrief", "end", 1 * D, "", "Highlights posted"),

    ("media", "planning", "start", -1 * D, "", "Press list and accreditation final"),
    ("media", "planning", "start", -1 * D, "C", "Holding statement ready for incidents"),
    ("media", "live", "start", -120, "", "Media desk open"),
    ("media", "live", "start", 60, "", "Interview slots running on time"),
    ("media", "debrief", "end", 2 * D, "", "Press coverage logged"),

    ("merch", "planning", "start", -1 * D, "", "Stock counted in"),
    ("merch", "live", "start", -120, "", "Merch stall set and POS tested"),
    ("merch", "live", "end", 30, "", "Stock and cash counted out"),

    ("finance", "planning", "start", -3 * D, "", "Vendor advances paid"),
    ("finance", "live", "start", -180, "C", "Cash floats issued and signed for"),
    ("finance", "live", "end", 60, "C", "Cash counted and secured"),
    ("finance", "debrief", "end", 7 * D, "", "Vendor settlements closed"),

    ("staffing", "planning", "start", -3 * D, "", "Rosters published"),
    ("staffing", "live", "start", -300, "C", "Staff signed in with IDs issued"),
    ("staffing", "live", "start", -240, "C", "Staff briefing done"),
    ("staffing", "live", "start", -240, "", "Crew welfare area with water ready"),
    ("staffing", "live", "start", 120, "", "Break rotation running"),
    ("staffing", "live", "end", 120, "", "All staff signed out"),

    ("guest", "planning", "start", -1 * D, "", "Accessibility plan confirmed: routes, seating, toilets"),
    ("guest", "live", "start", -120, "", "Info desk open"),
    ("guest", "live", "start", -120, "C", "Lost-child point staffed"),
    ("guest", "live", "start", -60, "", "Lost and found log open"),
    ("guest", "live", "end", 60, "", "Lost property logged and handed to venue"),
]


def q(s):
    return "'" + s.replace("'", "''") + "'"


def main():
    keys = {k for k, _, _ in DEPTS}
    assert all(t[0] in keys for t in T), "unknown dept in templates"
    out = ["-- Generated by scripts/build_seed.py. Departments and default checklist templates.",
           "insert into public.departments (key, name, owns, sort) values"]
    out.append(",\n".join(f"  ({q(k)}, {q(n)}, {q(o)}, {i + 1})" for i, (k, n, o) in enumerate(DEPTS)))
    out.append("on conflict (key) do update set name = excluded.name, owns = excluded.owns, sort = excluded.sort;\n")
    out.append("insert into public.template_items (dept_key, title, phase, anchor, offset_minutes, critical, photo_required, sort) values")
    rows = []
    for i, (d, ph, an, off, fl, title) in enumerate(T):
        rows.append(f"  ({q(d)}, {q(title)}, {q(ph)}, {q(an)}, {off}, {'true' if 'C' in fl else 'false'}, {'true' if 'P' in fl else 'false'}, {i + 1})")
    out.append(",\n".join(rows) + ";")
    p = Path(__file__).resolve().parent.parent / "supabase/migrations/0003_seed.sql"
    p.write_text("\n".join(out) + "\n")
    print(f"{len(DEPTS)} departments, {len(T)} template items -> {p}")


if __name__ == "__main__":
    main()
