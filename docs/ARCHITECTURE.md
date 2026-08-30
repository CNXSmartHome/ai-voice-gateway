# System Architecture

## High-level flow

Voice Gateway -> Secure WebSocket -> Cloud Session Gateway -> Realtime AI -> Smart Home Orchestrator -> Platform Adapter -> Tuya Cloud -> Device

Mobile App -> API -> Auth/Properties/Rooms/Gateways/Integrations/Devices

## Core services

### 1. Gateway Service
Responsibilities:
- device authentication
- WebSocket lifecycle
- heartbeat/reconnect
- gateway-room context
- firmware version reporting
- OTA signaling

### 2. AI Session Service
Responsibilities:
- realtime audio session
- conversation context
- tool invocation
- response audio routing
- timeout/error handling

### 3. Smart Home Orchestrator
Responsibilities:
- universal tool interface
- room/device resolution
- capability validation
- command authorization
- platform adapter dispatch

### 4. Integration Service
MVP adapter: Tuya.

Adapter interface:
- discoverDevices()
- getDeviceState()
- executeCommand()
- getScenes()
- executeScene()

### 5. App/API Service
Responsibilities:
- accounts
- organizations
- properties
- rooms
- gateways
- integrations
- device mapping
- basic manual control

## Recommended stack
- Backend: FastAPI or NestJS
- Database: PostgreSQL
- Cache/session: Redis
- Mobile: React Native
- Firmware: ESP32-S3 / ESP-IDF
- Infra: Docker + managed cloud VM/container runtime
- CI/CD: GitHub Actions

## Non-negotiable boundaries
- AI never calls Tuya-specific APIs directly.
- Tuya credentials never reach the gateway.
- Gateway does not contain the smart-home device database.
- Production deployment occurs through CI/CD only.
