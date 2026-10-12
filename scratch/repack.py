
import os
import zipfile

src_dir = '/mnt/c/Users/USER/OneDrive/Desktop/JAGAN/extracted_monsha'
zip_path = '/mnt/c/Users/USER/OneDrive/Desktop/JAGAN/FIXED_agent-runs-KALI-MONSHA.zip'

if not os.path.exists(src_dir):
    # fallback to local Windows path if running via native python
    src_dir = r'C:\Users\USER\OneDrive\Desktop\JAGAN\extracted_monsha'
    zip_path = r'C:\Users\USER\OneDrive\Desktop\JAGAN\FIXED_agent-runs-KALI-MONSHA.zip'

print(f"Creating zip from {src_dir} to {zip_path}...")

with zipfile.ZipFile(zip_path, 'w', compression=zipfile.ZIP_DEFLATED) as zipf:
    for foldername, subfolders, filenames in os.walk(src_dir):
        subfolders.sort()
        filenames.sort()
        for filename in filenames:
            file_path = os.path.join(foldername, filename)
            arcname = os.path.relpath(file_path, src_dir).replace('\\', '/')
            zipf.write(file_path, arcname)

print(f"Successfully created {zip_path} (size: {os.path.getsize(zip_path)} bytes)")

with zipfile.ZipFile(zip_path, 'r') as z:
    entries = z.namelist()
    print(f"Verified Zip: {len(entries)} entries total")
    has_backslash = any('\\' in e for e in entries)
    print(f"Contains backslashes: {has_backslash}")
    agents = [
        "Nova_Nova_1", "Nova_Nova_2", "Nova_Nova_3", "Nova_Nova_4",
        "Nova_Nova_5", "Nova_Nova_6", "Nova_Nova_7", "Nova_Nova_8",
        "Nova_Nova_9", "Nova_Nova_10", "Orion_Nova"
    ]
    for a in agents:
        count = len([e for e in entries if e.startswith(f"{a}/")])
        print(f"  {a:16}: {count} files")
