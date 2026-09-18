import os
import re

DIR = r"c:\Users\john leo\Desktop\FINAL_PROJECT_SYSTEM\System(front-end)\html"

# CDN link
CDN = '  <script src="https://unpkg.com/@phosphor-icons/web"></script>\n</head>'

def process_file(filepath):
    with open(filepath, 'r', encoding='utf-8') as f:
        content = f.read()

    # Add CDN if not present
    if '@phosphor-icons' not in content:
        content = content.replace('</head>', CDN)

    # General replacements
    replacements = {
        # Nav tabs
        '>Menu</button>': '><i class="ph ph-fork-knife" style="margin-right:4px;"></i> Menu</button>',
        '>My Menu</button>': '><i class="ph ph-list-dashes" style="margin-right:4px;"></i> My Menu</button>',
        '>Orders</button>': '><i class="ph ph-receipt" style="margin-right:4px;"></i> Orders</button>',
        '>My Orders</button>': '><i class="ph ph-receipt" style="margin-right:4px;"></i> My Orders</button>',
        '>Profile</button>': '><i class="ph ph-user" style="margin-right:4px;"></i> Profile</button>',
        '>➕ Add Item</button>': '><i class="ph ph-plus-circle" style="margin-right:4px;"></i> Add Item</button>',
        '>📊 My Sales</button>': '><i class="ph ph-chart-line-up" style="margin-right:4px;"></i> My Sales</button>',
        
        # Forms / inputs
        '<span class="input-icon"></span>': '<span class="input-icon"><i class="ph ph-user"></i></span>', # Default to user, fix password later if needed
        '<span class="input-icon">✉️</span>': '<span class="input-icon"><i class="ph ph-envelope"></i></span>',
        '<span class="input-icon">📍</span>': '<span class="input-icon"><i class="ph ph-map-pin"></i></span>',
        
        # Search
        '<span class="search-icon">🔍</span>': '<span class="search-icon"><i class="ph ph-magnifying-glass"></i></span>',
        '<span class="search-icon"></span>': '<span class="search-icon"><i class="ph ph-magnifying-glass"></i></span>',
        
        # Buttons / General
        '>Sign Out</button>': '><i class="ph ph-sign-out" style="margin-right:4px;"></i> Sign Out</button>',
        '>Print</button>': '><i class="ph ph-printer" style="margin-right:4px;"></i> Print</button>',
        '>Done</button>': '><i class="ph ph-check-circle" style="margin-right:4px;"></i> Done</button>',
        '📝 Add a note': '<i class="ph ph-pencil-simple" style="margin-right:4px;"></i> Add a note',
    }

    for old, new in replacements.items():
        content = content.replace(old, new)
        
    # Fix password icons in index.html and register.html
    # This is a bit hacky but works for the known structure
    if "password" in content.lower():
        content = re.sub(
            r'(<input type="password".*?>)',
            r'\1',
            content
        )
        # Fix specific instances where we know it's a password field
        content = re.sub(r'(<label>Password</label>\s*<div.*?>\s*)<span class="input-icon"><i class="ph ph-user"></i></span>',
                         r'\1<span class="input-icon"><i class="ph ph-lock"></i></span>', content)
        content = re.sub(r'(<label>Current Password</label>\s*<input)',
                         r'\1', content) # not an input-wrap
        content = re.sub(r'(<label>New Password</label>\s*<input)',
                         r'\1', content) # not an input-wrap

    with open(filepath, 'w', encoding='utf-8') as f:
        f.write(content)

for filename in os.listdir(DIR):
    if filename.endswith('.html'):
        process_file(os.path.join(DIR, filename))
print("Added Phosphor Icons successfully.")
