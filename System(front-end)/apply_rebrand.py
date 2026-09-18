import os
import re

DIR = r"c:\Users\john leo\Desktop\FINAL_PROJECT_SYSTEM\System(front-end)"

# Rebranding mapping
REPLACEMENTS = {
    "QuickBite": "Hi Te!",
    "QB": "HT",
}

# Emojis to remove (a rough list based on the provided code)
EMOJIS = [
    "🍔", "🍕", "🍜", "👤", "🔒", "👁", "🍽️", "📋", "🛒", "📝", "💵", "🏃", "💳", "📱", "💜", "🎉", "⭐", "🖨️"
]

def replace_emojis(text):
    for emoji in EMOJIS:
        text = text.replace(emoji + " ", "")
        text = text.replace(" " + emoji, "")
        text = text.replace(emoji, "")
    return text

def apply_rebranding():
    for root, dirs, files in os.walk(DIR):
        for file in files:
            if file.endswith('.html') or file.endswith('.js'):
                path = os.path.join(root, file)
                with open(path, 'r', encoding='utf-8') as f:
                    content = f.read()

                new_content = content
                for old, new in REPLACEMENTS.items():
                    # only replace QuickBite outside of html tags if possible, but actually QuickBite is the brand
                    new_content = new_content.replace(old, new)

                new_content = replace_emojis(new_content)

                if new_content != content:
                    with open(path, 'w', encoding='utf-8') as f:
                        f.write(new_content)
                    print(f"Updated {file}")

def apply_css_changes():
    # Update shared.css
    shared_path = os.path.join(DIR, 'css', 'shared.css')
    if os.path.exists(shared_path):
        with open(shared_path, 'r', encoding='utf-8') as f:
            content = f.read()
        
        # Replace root variables
        old_root = """:root {
  --orange:    #FF6B2B;
  --orange-dk: #E85A1A;
  --dark:      #0F0F0F;
  --dark2:     #1A1A1A;
  --dark3:     #2A2A2A;
  --cream:     #FAFAF7;
  --white:     #FFFFFF;
  --gray:      #888888;
  --gray-lt:   #E8E8E4;
  --gray-md:   #CCCCCC;
  --green:     #2ECC71;
  --green-dk:  #27AE60;
  --red:       #E74C3C;
  --blue:      #3498DB;
  --purple:    #9B59B6;
  --yellow:    #F39C12;

  --font-head: 'Syne', sans-serif;
  --font-body: 'DM Sans', sans-serif;

  --radius-sm: 10px;
  --radius:    16px;
  --radius-lg: 24px;
  --shadow-sm: 0 4px 16px rgba(0,0,0,0.06);
  --shadow:    0 8px 30px rgba(0,0,0,0.09);
  --shadow-lg: 0 20px 60px rgba(0,0,0,0.13);
}"""
        new_root = """:root {
  --orange:    #E65100;
  --orange-dk: #BF360C;
  --dark:      #3E2723;
  --dark2:     #4E342E;
  --dark3:     #5D4037;
  --cream:     #FFF8F0;
  --white:     #FFFFFF;
  --gray:      #8D6E63;
  --gray-lt:   #EFEBE9;
  --gray-md:   #BCAAA4;
  --green:     #2E7D32;
  --green-dk:  #1B5E20;
  --red:       #C62828;
  --blue:      #1565C0;
  --purple:    #6A1B9A;
  --yellow:    #F57F17;

  --font-head: 'Syne', sans-serif;
  --font-body: 'DM Sans', sans-serif;

  --radius-sm: 12px;
  --radius:    18px;
  --radius-lg: 24px;
  --shadow-sm: 0 4px 12px rgba(62, 39, 35, 0.05);
  --shadow:    0 8px 24px rgba(62, 39, 35, 0.08);
  --shadow-lg: 0 16px 40px rgba(62, 39, 35, 0.12);
}"""
        content = content.replace(old_root, new_root)
        
        # Replace rgba values that used old colors
        content = content.replace('rgba(255,107,43,', 'rgba(230,81,0,')
        content = content.replace('rgba(250,250,247,', 'rgba(255,248,240,')
        content = content.replace('rgba(46,204,113,', 'rgba(46,125,50,')
        content = content.replace('rgba(231,76,60,', 'rgba(198,40,40,')
        
        # Make buttons bounce more nicely
        content = content.replace('transform: translateY(-2px);', 'transform: translateY(-2px) scale(1.01);')
        
        with open(shared_path, 'w', encoding='utf-8') as f:
            f.write(content)
        print("Updated shared.css")

    # Update style.css
    style_path = os.path.join(DIR, 'css', 'style.css')
    if os.path.exists(style_path):
        with open(style_path, 'r', encoding='utf-8') as f:
            content = f.read()
        content = content.replace('rgba(255,107,43,', 'rgba(230,81,0,')
        with open(style_path, 'w', encoding='utf-8') as f:
            f.write(content)
        print("Updated style.css")

if __name__ == "__main__":
    apply_rebranding()
    apply_css_changes()
