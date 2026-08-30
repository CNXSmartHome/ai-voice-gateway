export { DatabaseModule } from './database.module';
export { PrismaService } from './prisma.service';
export {
  assertCapabilitiesSupported,
  findUnsupportedCapabilities,
  toDbCapability,
  toDbDeviceType,
  toDbPlatform,
  toDomainCapability,
  toDomainDevice,
  toDomainDeviceType,
  toDomainPlatform,
} from './domain-mapping';
