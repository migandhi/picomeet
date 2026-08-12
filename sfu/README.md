# PicoMeet optional Pion SFU

This directory contains the optional SFU upgrade path for larger lecture rooms.

Build:

```bash
cd sfu
go build -ldflags="-s -w" -o picosfu .
```

The reference implementation is intentionally small and is **not production-ready**.
Before exposing it publicly, add authentication, per-room authorization, origin checks,
cleanup, proper RTCP/PLI handling, bandwidth budgets, and resource limits.

The default PicoMeet architecture remains peer-to-peer mesh; the SFU is an upgrade path
when teacher/client uplink or mesh fan-out becomes the limiting factor.
