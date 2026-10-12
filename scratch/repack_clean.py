
import os
import zipfile

root = r"C:\\Users\\USER\\OneDrive\\Desktop\\JAGAN"
src_dir = os.path.join(root, "extracted_monsha")
zip_path = os.path.join(root, "FIXED_agent-runs-KALI-MONSHA.zip")

print(f"Creating zip from {src_dir} to {zip_path}...")

with zipfile.ZipFile(zip_path, 'w', compression=zipfile.ZIP_DEFLATED) as zipf:
    for foldername, subfolders, filenames in os.walk(src_dir):
        # Sort for determinism
        subfolders.sort()
        filenames.sort()
        for filename in filenames:
            file_path = os.path.join(foldername, filename)
            arcname = os.path.relpath(file_path, src_dir).replace('\\', '/')
            zipf.write(file_path, arcname)

print(f"Successfully created {zip_path} (size: {os.path.getsize(zip_path)} bytes)")
