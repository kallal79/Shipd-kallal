
import zipfile

with zipfile.ZipFile("FIXED_agent-runs-KALI-MONSHA.zip", "r") as z:
    entries = z.namelist()
    print(f"Total entries: {len(entries)}")
    has_backslash = any('\\' in e for e in entries)
    print(f"Any backslashes: {has_backslash}")
    for a in [
        "Nova_Nova_1", "Nova_Nova_2", "Nova_Nova_3", "Nova_Nova_4",
        "Nova_Nova_5", "Nova_Nova_6", "Nova_Nova_7", "Nova_Nova_8",
        "Nova_Nova_9", "Nova_Nova_10", "Orion_Nova"
    ]:
        prefix = f"{a}/"
        agent_entries = [e for e in entries if e.startswith(prefix)]
        print(f"  {a:15}: {len(agent_entries)} files")
