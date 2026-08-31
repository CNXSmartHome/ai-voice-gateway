#include "vg_identity.h"

#include <string.h>

/** Bounded length: returns SIZE_MAX-free result, capped at `limit`. */
static size_t bounded_length(const char *value, size_t limit) {
  size_t length = 0;
  while (length <= limit && value[length] != '\0') {
    length++;
  }
  return length;
}

static bool is_serial_character(char c) {
  return (c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z') || (c >= '0' && c <= '9') || c == '-';
}

/** Printable ASCII, excluding the two characters JSON would need escaped. */
static bool is_version_character(char c) {
  return c >= 0x20 && c <= 0x7E && c != '"' && c != '\\';
}

bool vg_identity_serial_is_valid(const char *serial) {
  if (serial == NULL) {
    return false;
  }

  size_t length = bounded_length(serial, VG_IDENTITY_SERIAL_MAX_LENGTH);
  if (length < VG_IDENTITY_SERIAL_MIN_LENGTH || length > VG_IDENTITY_SERIAL_MAX_LENGTH) {
    return false;
  }

  for (size_t i = 0; i < length; i++) {
    if (!is_serial_character(serial[i])) {
      return false;
    }
  }
  return true;
}

bool vg_identity_firmware_version_is_valid(const char *firmware_version) {
  if (firmware_version == NULL) {
    return false;
  }

  size_t length = bounded_length(firmware_version, VG_IDENTITY_FIRMWARE_VERSION_MAX_LENGTH);
  if (length == 0 || length > VG_IDENTITY_FIRMWARE_VERSION_MAX_LENGTH) {
    return false;
  }

  for (size_t i = 0; i < length; i++) {
    if (!is_version_character(firmware_version[i])) {
      return false;
    }
  }
  return true;
}

bool vg_identity_service_name(char *out, size_t out_size, const char *serial) {
  if (out == NULL || out_size < VG_IDENTITY_SERVICE_NAME_BUFFER_SIZE) {
    return false;
  }
  if (!vg_identity_serial_is_valid(serial)) {
    return false;
  }

  const size_t prefix_length = strlen(VG_IDENTITY_SERVICE_NAME_PREFIX);
  const size_t serial_length = strlen(serial);
  size_t suffix_length = VG_IDENTITY_SERVICE_NAME_SUFFIX_LENGTH;
  if (serial_length < suffix_length) {
    suffix_length = serial_length;
  }

  memcpy(out, VG_IDENTITY_SERVICE_NAME_PREFIX, prefix_length);
  memcpy(out + prefix_length, serial + (serial_length - suffix_length), suffix_length);
  out[prefix_length + suffix_length] = '\0';
  return true;
}

/** Appends `text` to `out` if it fits, advancing `written`. */
static bool append(char *out, size_t out_size, size_t *written, const char *text,
                   size_t text_length) {
  if (*written + text_length + 1u > out_size) {
    return false;
  }
  memcpy(out + *written, text, text_length);
  *written += text_length;
  return true;
}

int vg_identity_describe(char *out, size_t out_size, const char *serial,
                         const char *firmware_version) {
  static const char part_open[] = "{\"serial_number\":\"";
  static const char part_middle[] = "\",\"firmware_version\":\"";
  static const char part_close[] = "\"}";

  if (out == NULL || out_size == 0) {
    return -1;
  }
  if (!vg_identity_serial_is_valid(serial) ||
      !vg_identity_firmware_version_is_valid(firmware_version)) {
    return -1;
  }

  size_t written = 0;
  if (!append(out, out_size, &written, part_open, sizeof(part_open) - 1u) ||
      !append(out, out_size, &written, serial, strlen(serial)) ||
      !append(out, out_size, &written, part_middle, sizeof(part_middle) - 1u) ||
      !append(out, out_size, &written, firmware_version, strlen(firmware_version)) ||
      !append(out, out_size, &written, part_close, sizeof(part_close) - 1u)) {
    return -1;
  }

  out[written] = '\0';
  return (int)written;
}
