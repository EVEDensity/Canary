# `@canary/isolation`

H-01 isolation supervisor. Userspace preload is a verifiable Windows control, not an OS sandbox. Missing OS isolation fail-closes automatic hard writes.

R1 adds a process-tree adapter (`taskkill /T` on Windows, process-group signals on POSIX). That adapter terminates descendants and reclaims orphans; it is still not file/network/credential confinement.
