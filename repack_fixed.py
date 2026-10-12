
import os
import zipfile

root = r"C:\\Users\\USER\\OneDrive\\Desktop\\JAGAN"
src_dir = os.path.join(root, "extracted_monsha")
zip_path = os.path.join(root, "FIXED_agent-runs-KALI-MONSHA.zip")

print(f"Creating zip from {src_dir} to {zip_path}...")

with zipfile.ZipFile(zip_path, 'w', compression=zipfile.ZIP_DEFLATED) as zipf:
    for foldername, subfolders, filenames in os.walk(src_dir):
        subfolders.sort()
        filenames.sort()
        for filename in filenames:
            file_path = os.path.join(foldername, filename)
            arcname = os.path.relpath(file_path, src_dir).replace('\\', '/')
            zipf.write(file_path, arcname)

size = os.path.getsize(zip_path)
print(f"Successfully created {zip_path} (size: {size} bytes, {size / (1024*1024):.2f} MB)")

with zipfile.ZipFile(zip_path, 'r') as z:
    entries = z.namelist()
    print(f"Total entries in zip: {len(entries)}")
    has_backslash = any('\\' in e for e in entries)
    print(f"Contains backslash: {has_backslash}")
    agents = [
        "Nova_Nova_1", "Nova_Nova_2", "Nova_Nova_3", "Nova_Nova_4",
        "Nova_Nova_5", "Nova_Nova_6", "Nova_Nova_7", "Nova_Nova_8",
        "Nova_Nova_9", "Nova_Nova_10", "Orion_Nova"
    ]
    for a in agents:
        count = len([e for e in entries if e.startswith(f"{a}/")])
        print(f"  {a:16}: {count} files")
