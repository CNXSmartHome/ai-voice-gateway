# AI Voice Gateway MVP Product Specification

## Product goal
A cloud-first smart-home voice gateway with a mobile app that connects third-party smart-home platforms and lets users control devices naturally by voice.

## MVP deadline
30 days from project start.

## MVP success criteria
1. User can add a VG-100 gateway from the mobile app.
2. App provisions Wi-Fi to the gateway over BLE.
3. Gateway authenticates to cloud and remains online with heartbeat/reconnect.
4. User can connect a Tuya account.
5. Tuya devices can be imported and assigned to rooms.
6. Universal device model supports Light, AC/Climate, Curtain, Switch, Scene.
7. Voice command flows end-to-end: Gateway -> Cloud AI -> Smart Home Orchestrator -> Tuya -> Device.
8. Gateway receives and plays voice responses.
9. AI resolves current-room context from gateway assignment.
10. Basic OTA firmware update and rollback mechanism exists.
11. Monitoring, audit logs, automated tests, and staging deployment are operational.

## Explicitly out of scope for MVP
- SmartThings
- Google Home
- Matter
- Hotel PMS
- Billing
- Custom wake-word training
- 4-mic beamforming production design
- Production PCB/enclosure
- Voice biometrics
- Door/lock/gate control
- Advanced long-term AI memory

## Primary users
- Smart-home integrator
- Villa/home owner
- Guest using a room-local gateway

## Product principles
- Cloud-first control
- Platform-neutral internal device model
- Room-aware voice context
- Minimal setup steps
- Secure-by-default
- No production direct access for AI agents
