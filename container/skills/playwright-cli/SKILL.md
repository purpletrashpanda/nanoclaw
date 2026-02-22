---
name: playwright-cli
description: Browse the web for any task — research topics, read articles, interact with web apps, fill forms, take screenshots, extract data, and test web pages. Use whenever a browser would be useful, not just when the user explicitly asks.
allowed-tools: Bash(playwright-cli:*)
---

# Browser Automation with playwright-cli

## Quick start

```bash
playwright-cli open <url>        # Navigate to page
playwright-cli snapshot          # Get page elements with refs
playwright-cli click <ref>       # Click element by ref
playwright-cli fill <ref> "text" # Fill input by ref
playwright-cli close             # Close browser
```

## Artifacts

Save screenshots, PDFs, and other artifacts to `/tmp` by default. Only save to `/workspace/group/` if the user explicitly needs the file to persist.

## Core workflow

1. Navigate: `playwright-cli open <url>`
2. Snapshot: `playwright-cli snapshot` (returns elements with refs like `e1`, `e2`)
3. Interact using refs from the snapshot
4. Re-snapshot after navigation or significant DOM changes

## Commands

### Navigation

```bash
playwright-cli open [url]        # Open browser, optionally navigate to URL
playwright-cli goto <url>        # Navigate to URL
playwright-cli go-back           # Go back
playwright-cli go-forward        # Go forward
playwright-cli reload            # Reload page
playwright-cli close             # Close browser
```

### Snapshot (page analysis)

```bash
playwright-cli snapshot                   # Page snapshot with element refs
playwright-cli snapshot --filename=f.txt  # Save snapshot to file
```

### Interactions (use refs from snapshot)

```bash
playwright-cli click <ref>           # Click
playwright-cli dblclick <ref>        # Double-click
playwright-cli fill <ref> "text"     # Clear and type
playwright-cli type "text"           # Type text
playwright-cli press Enter           # Press key
playwright-cli hover <ref>           # Hover
playwright-cli check <ref>           # Check checkbox
playwright-cli uncheck <ref>         # Uncheck checkbox
playwright-cli select <ref> "value"  # Select dropdown option
playwright-cli drag <from> <to>      # Drag and drop
playwright-cli upload <ref> file.pdf # Upload files
```

### Keyboard & Mouse

```bash
playwright-cli press Enter
playwright-cli keydown Shift
playwright-cli keyup Shift
playwright-cli mousemove 150 300
playwright-cli mousedown
playwright-cli mouseup
playwright-cli mousewheel 0 100
```

### Tab Management

```bash
playwright-cli tab-list              # List open tabs
playwright-cli tab-new [url]         # Open new tab
playwright-cli tab-close [index]     # Close tab
playwright-cli tab-select 0          # Switch to tab
```

### Screenshots & PDF

```bash
playwright-cli screenshot                   # Save screenshot
playwright-cli screenshot --filename=page.png
playwright-cli pdf --filename=page.pdf
```

### Cookies & Storage

```bash
playwright-cli cookie-list                  # Get all cookies
playwright-cli cookie-get session_id        # Get specific cookie
playwright-cli cookie-set session_id abc123 # Set cookie
playwright-cli cookie-delete session_id     # Delete cookie
playwright-cli localstorage-get theme       # Get localStorage value
playwright-cli localstorage-set theme dark  # Set localStorage value
playwright-cli sessionstorage-list          # List session storage
```

### State Management

```bash
playwright-cli state-save auth.json        # Save browser state
playwright-cli state-load auth.json        # Load saved state
```

### Network & Debugging

```bash
playwright-cli route "**.jpg" --status=404                          # Mock requests
playwright-cli route "https://api.example.com/**" --body='{"mock": true}'
playwright-cli console              # View console output
playwright-cli network              # View network requests
```

### JavaScript

```bash
playwright-cli eval "document.title"   # Run JavaScript
```

## Example: Form submission

```bash
playwright-cli open https://example.com/form
playwright-cli snapshot
# Output shows: textbox "Email" [ref=e1], textbox "Password" [ref=e2], button "Submit" [ref=e3]

playwright-cli fill e1 "user@example.com"
playwright-cli fill e2 "password123"
playwright-cli click e3
playwright-cli snapshot  # Check result
```

## Example: Data extraction

```bash
playwright-cli open https://example.com/products
playwright-cli snapshot
playwright-cli screenshot --filename=products.png
```
