---
"ccv-computer-use": minor
---

Add sandbox mode (`CCV_SANDBOX_MODE=1`): an explicit operator opt-in for sandboxed/containerized environments that elevates all permission gates — app tiers become full, the system-key blocklist is disabled, clipboard/systemKeyCombos grant flags are granted implicitly, the kill-switch and the cross-process lock are bypassed. OS-level permissions (TCC), the `request_access` first step, stale-screenshot pixel validation, and HTTP loopback binding remain enforced. See README "Sandbox mode" for details.
