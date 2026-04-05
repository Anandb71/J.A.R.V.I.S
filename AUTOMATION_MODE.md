# JARVIS Automation Mode (Windows)

This file lists what JARVIS can automate right now in the current build.

## What it can do now

- Open apps (e.g., Notepad, Chrome, VS Code)
- Open URLs and websites
- Search web and fetch webpage content
- Check system info (CPU/RAM/basic system stats)
- Get date/time
- Get weather by city
- Control brightness (Windows API path)
- Control volume (set/mute/unmute/up/down)
- Run shell commands
- Manage files in workspace:
  - list
  - read
  - write
  - append
  - delete
  - mkdir
  - copy
  - move
- Generate code into `src/` using `ai_write_code`
- Set reminders (`remind me to ... in X minutes`)

## Example prompts

- "Open Notepad"
- "Open website github.com"
- "Search web for latest Python release"
- "Fetch webpage https://fastapi.tiangolo.com"
- "What's my CPU and memory usage?"
- "Set brightness to 60"
- "Mute volume"
- "Increase volume by 15"
- "Create file notes/today.txt with buy milk"
- "Append to file notes/today.txt with and call Alex"
- "Copy file notes/today.txt to notes/archive/today.txt"
- "Move file notes/today.txt to notes/done/today.txt"
- "Run command ipconfig"
- "Close app notepad"
- "Remind me to stretch in 25 minutes"

## Safety model

Tool execution is policy-based:

- SAFE tools: run directly
- VISUAL / KEYBOARD tools: require confirmation unless auto-approve is enabled

Current env switch:

- `JARVIS_AUTO_APPROVE_TOOLS=true` enables high automation mode
- `JARVIS_AUTO_APPROVE_TOOLS=false` asks for confirmation on sensitive actions

## Notes

- Some operations depend on OS support and app availability.
- Internet tools require `JARVIS_INTERNET_ENABLED=true`.
- For production/general users, confirmation mode is safer.
