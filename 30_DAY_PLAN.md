# 30-Day MVP Delivery Plan

## Week 1 — Foundation
- VG-001 Initialize monorepo
- VG-002 CI baseline
- VG-003 Database schema: org/property/room/gateway/device
- VG-004 Auth baseline
- VG-005 Gateway registration and claim
- VG-006 Gateway WebSocket heartbeat
- VG-007 BLE Wi-Fi provisioning skeleton
- VG-008 Mobile add-gateway flow

Milestone Day 7: App can add gateway and gateway is online via cloud.

## Week 2 — Tuya and Device Model
- VG-009 SmartHomeAdapter interface
- VG-010 Tuya OAuth/connect flow
- VG-011 Tuya device discovery
- VG-012 Universal capability normalization
- VG-013 Room assignment
- VG-014 Manual light control
- VG-015 Climate control
- VG-016 Curtain control
- VG-017 Scene execution

Milestone Day 14: Real Tuya devices controllable from app/API with room mapping.

## Week 3 — Voice AI
- VG-018 Gateway audio capture/stream
- VG-019 Cloud realtime AI session
- VG-020 AI tool schemas
- VG-021 Gateway room context injection
- VG-022 Voice -> light E2E
- VG-023 Voice -> climate E2E
- VG-024 Voice -> curtain E2E
- VG-025 Conversation follow-up context
- VG-026 Ambiguity/fallback handling
- VG-027 Voice response playback

Milestone Day 21: Voice -> AI -> Tuya -> device + spoken response works end-to-end.

## Week 4 — Hardening and Release
- VG-028 Gateway device credentials
- VG-029 Rate limiting/audit logs
- VG-030 OTA baseline
- VG-031 OTA rollback
- VG-032 Metrics and health dashboard
- VG-033 AI/tool observability
- VG-034 E2E command corpus
- VG-035 Failure/chaos tests
- VG-036 App UI cleanup
- VG-037 Release candidate pipeline
- VG-038 Final acceptance checklist

Milestone Day 30: MVP 1.0.0 release candidate passes acceptance tests.
