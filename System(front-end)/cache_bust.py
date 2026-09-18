import os

DIR = r"c:\Users\john leo\Desktop\FINAL_PROJECT_SYSTEM\System(front-end)\html"

for filename in os.listdir(DIR):
    if filename.endswith('.html'):
        path = os.path.join(DIR, filename)
        with open(path, 'r', encoding='utf-8') as f:
            content = f.read()
        
        # Replace un-versioned or old-versioned css links with v=4
        content = content.replace('.css"', '.css?v=4"')
        content = content.replace('.css?v=3"', '.css?v=4"')
        
        with open(path, 'w', encoding='utf-8') as f:
            f.write(content)
print("Updated all CSS links to v=4")
