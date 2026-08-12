# Limits

These are design targets from the PicoMeet specification, not guarantees. Load-test your
actual hardware, browsers, networks and TURN/SFU usage before selling capacity.

| Room size | Mode | Guidance |
|---|---|---|
| 2 | Seminar | Flawless target |
| 4 | Seminar | Excellent target |
| 6 | Seminar | Recommended maximum for seminars |
| 8 | Seminar | Practical maximum on modern laptops |
| 10–12 | Seminar | Low-resolution / high client CPU |
| 13+ | Lecture | Automatically prefer Lecture Mode |

Default 1 GB / 1 vCPU server caps:

- 8 concurrent meetings
- 60 total live participants
- 12 participants per room
- Lecture threshold: 9
- Maximum stage publishers: 4

Mesh shifts cost from the server to participant CPU and uplink. TURN and SFU change the
bandwidth economics substantially because media is then relayed through infrastructure.

Treat all capacity numbers as starting points and load-test before production use.
