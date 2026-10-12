test_path = 'superagent/test/node/size_limits_compliance_b5e2d.js'

with open(test_path, 'r', encoding='utf-8') as f:
    content = f.read()

# 1. Update T74 to use \uFEFF + 'b'.repeat(50)
old_t74 = "this.responseText = 'b'.repeat(50);"
new_t74 = "this.responseText = '\\uFEFF' + 'b'.repeat(50);"
if old_t74 in content:
    content = content.replace(old_t74, new_t74, 1)
    print("Updated T74 with UTF-16 BOM")
else:
    print("T74 already updated")

# 2. Update T85 to use \uFEFFa
old_t85 = "this.responseText = 'a';"
new_t85 = "this.responseText = '\\uFEFFa';"
# Notice 'a' might appear multiple times, so find T85 section
t85_marker = "Browser decompressed UTF-8 response with BOM byte accounting"
pos = content.find(t85_marker)
if pos != -1:
    idx = content.find("this.responseText = 'a';", pos)
    if idx != -1:
        content = content[:idx] + "this.responseText = '\\uFEFFa';" + content[idx + len("this.responseText = 'a';"):]
        print("Updated T85 with UTF-8 BOM")
    else:
        print("T85 responseText already updated")
else:
    print("T85 marker not found")

with open(test_path, 'w', encoding='utf-8') as f:
    f.write(content)

print("Saved test file.")
