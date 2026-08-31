/* Host tests for VG-007 device identity. */
#include "vg_identity.h"

#include "vg_test.h"

/** Builds a serial of `length` repeated 'A' characters. */
static void make_serial(char *out, size_t length) {
  for (size_t i = 0; i < length; i++) {
    out[i] = 'A';
  }
  out[length] = '\0';
}

/* --- serial numbers ----------------------------------------------------- */

/*
 * These boundaries are VG-005's registration pattern, `^[A-Za-z0-9-]{4,64}$`.
 * A device that accepts a serial the cloud refuses would flash cleanly at
 * manufacture and fail at the customer's house.
 */
static void serials_the_cloud_accepts_are_accepted(void) {
  VG_CHECK(vg_identity_serial_is_valid("VG10"));
  VG_CHECK(vg_identity_serial_is_valid("VG100-000123"));
  VG_CHECK(vg_identity_serial_is_valid("abc-XYZ-0123456789"));
  VG_CHECK(vg_identity_serial_is_valid("----"));

  char at_maximum[VG_IDENTITY_SERIAL_MAX_LENGTH + 1u];
  make_serial(at_maximum, VG_IDENTITY_SERIAL_MAX_LENGTH);
  VG_CHECK(vg_identity_serial_is_valid(at_maximum));
}

static void serials_outside_the_length_bounds_are_rejected(void) {
  VG_CHECK(!vg_identity_serial_is_valid(""));
  VG_CHECK(!vg_identity_serial_is_valid("VG1"));

  char too_long[VG_IDENTITY_SERIAL_MAX_LENGTH + 2u];
  make_serial(too_long, VG_IDENTITY_SERIAL_MAX_LENGTH + 1u);
  VG_CHECK(!vg_identity_serial_is_valid(too_long));
}

static void serials_with_unexpected_characters_are_rejected(void) {
  VG_CHECK(!vg_identity_serial_is_valid("VG100_0001"));
  VG_CHECK(!vg_identity_serial_is_valid("VG100 0001"));
  VG_CHECK(!vg_identity_serial_is_valid("VG100.0001"));
  VG_CHECK(!vg_identity_serial_is_valid("VG100:0001"));
  VG_CHECK(!vg_identity_serial_is_valid("VG100/0001"));
  VG_CHECK(!vg_identity_serial_is_valid("VG100\"01"));
  VG_CHECK(!vg_identity_serial_is_valid("VG100\n001"));
  VG_CHECK(!vg_identity_serial_is_valid("VG100\xc3\xa9""01"));
  VG_CHECK(!vg_identity_serial_is_valid(NULL));
}

/* --- advertised name ---------------------------------------------------- */

static void the_advertised_name_carries_the_serial_tail(void) {
  char name[VG_IDENTITY_SERVICE_NAME_BUFFER_SIZE];

  VG_CHECK(vg_identity_service_name(name, sizeof(name), "VG100-000123"));
  VG_CHECK_STR(name, "VG100-00123");

  VG_CHECK(vg_identity_service_name(name, sizeof(name), "ABCDE"));
  VG_CHECK_STR(name, "VG100-ABCDE");
}

/* A four-character serial is legal, so the suffix has to be allowed to be
 * shorter than the budget rather than reading past the string. */
static void a_short_serial_yields_a_short_name(void) {
  char name[VG_IDENTITY_SERVICE_NAME_BUFFER_SIZE];

  VG_CHECK(vg_identity_service_name(name, sizeof(name), "AB12"));
  VG_CHECK_STR(name, "VG100-AB12");
  VG_CHECK_INT(strlen(name), 10);
}

static void the_advertised_name_never_exceeds_the_ble_budget(void) {
  char name[VG_IDENTITY_SERVICE_NAME_BUFFER_SIZE];
  char serial[VG_IDENTITY_SERIAL_MAX_LENGTH + 1u];

  for (size_t length = VG_IDENTITY_SERIAL_MIN_LENGTH; length <= VG_IDENTITY_SERIAL_MAX_LENGTH;
       length++) {
    make_serial(serial, length);
    VG_CHECK(vg_identity_service_name(name, sizeof(name), serial));
    VG_CHECK(strlen(name) <= VG_IDENTITY_SERVICE_NAME_MAX_LENGTH);
  }
}

static void an_unusable_request_leaves_the_buffer_alone(void) {
  char name[VG_IDENTITY_SERVICE_NAME_BUFFER_SIZE] = "untouched";

  VG_CHECK(!vg_identity_service_name(name, sizeof(name), "no"));
  VG_CHECK_STR(name, "untouched");

  VG_CHECK(!vg_identity_service_name(name, sizeof(name), NULL));
  VG_CHECK_STR(name, "untouched");

  VG_CHECK(!vg_identity_service_name(name, VG_IDENTITY_SERVICE_NAME_BUFFER_SIZE - 1u, "VG100-01"));
  VG_CHECK_STR(name, "untouched");

  VG_CHECK(!vg_identity_service_name(NULL, sizeof(name), "VG100-01"));
}

/* --- firmware version --------------------------------------------------- */

static void firmware_versions_are_bounded_and_printable(void) {
  VG_CHECK(vg_identity_firmware_version_is_valid("0.1.0"));
  VG_CHECK(vg_identity_firmware_version_is_valid("0.1.0-rc.1+build.7"));

  char at_maximum[VG_IDENTITY_FIRMWARE_VERSION_MAX_LENGTH + 1u];
  make_serial(at_maximum, VG_IDENTITY_FIRMWARE_VERSION_MAX_LENGTH);
  VG_CHECK(vg_identity_firmware_version_is_valid(at_maximum));

  char too_long[VG_IDENTITY_FIRMWARE_VERSION_MAX_LENGTH + 2u];
  make_serial(too_long, VG_IDENTITY_FIRMWARE_VERSION_MAX_LENGTH + 1u);
  VG_CHECK(!vg_identity_firmware_version_is_valid(too_long));

  VG_CHECK(!vg_identity_firmware_version_is_valid(""));
  VG_CHECK(!vg_identity_firmware_version_is_valid(NULL));
  VG_CHECK(!vg_identity_firmware_version_is_valid("0.1.0\n"));
  VG_CHECK(!vg_identity_firmware_version_is_valid("0.1.0\x7f"));
  VG_CHECK(!vg_identity_firmware_version_is_valid("say \"hello\""));
  VG_CHECK(!vg_identity_firmware_version_is_valid("back\\slash"));
}

/* --- identity endpoint -------------------------------------------------- */

static void the_identity_response_is_the_documented_json(void) {
  char body[VG_IDENTITY_DESCRIBE_BUFFER_SIZE];

  int written = vg_identity_describe(body, sizeof(body), "VG100-000123", "0.1.0");

  VG_CHECK_STR(body, "{\"serial_number\":\"VG100-000123\",\"firmware_version\":\"0.1.0\"}");
  VG_CHECK_INT(written, (int)strlen(body));
}

static void the_declared_buffer_size_fits_the_largest_response(void) {
  char serial[VG_IDENTITY_SERIAL_MAX_LENGTH + 1u];
  char version[VG_IDENTITY_FIRMWARE_VERSION_MAX_LENGTH + 1u];
  char body[VG_IDENTITY_DESCRIBE_BUFFER_SIZE];

  make_serial(serial, VG_IDENTITY_SERIAL_MAX_LENGTH);
  make_serial(version, VG_IDENTITY_FIRMWARE_VERSION_MAX_LENGTH);

  int written = vg_identity_describe(body, sizeof(body), serial, version);

  VG_CHECK(written > 0);
  VG_CHECK(written < (int)VG_IDENTITY_DESCRIBE_BUFFER_SIZE);
}

/*
 * The inputs are validated rather than escaped, so a value that would break
 * the JSON is refused. Anything else would let a bad factory write turn into
 * a malformed response the app has to guess about.
 */
static void unsafe_or_unusable_input_produces_nothing(void) {
  char body[VG_IDENTITY_DESCRIBE_BUFFER_SIZE];

  VG_CHECK_INT(vg_identity_describe(body, sizeof(body), "no", "0.1.0"), -1);
  VG_CHECK_INT(vg_identity_describe(body, sizeof(body), "VG100-01", "bad\"version"), -1);
  VG_CHECK_INT(vg_identity_describe(body, sizeof(body), NULL, "0.1.0"), -1);
  VG_CHECK_INT(vg_identity_describe(body, sizeof(body), "VG100-01", NULL), -1);
  VG_CHECK_INT(vg_identity_describe(NULL, sizeof(body), "VG100-01", "0.1.0"), -1);
  VG_CHECK_INT(vg_identity_describe(body, 0, "VG100-01", "0.1.0"), -1);
  VG_CHECK_INT(vg_identity_describe(body, 8, "VG100-01", "0.1.0"), -1);
}

int main(void) {
  VG_RUN(serials_the_cloud_accepts_are_accepted);
  VG_RUN(serials_outside_the_length_bounds_are_rejected);
  VG_RUN(serials_with_unexpected_characters_are_rejected);
  VG_RUN(the_advertised_name_carries_the_serial_tail);
  VG_RUN(a_short_serial_yields_a_short_name);
  VG_RUN(the_advertised_name_never_exceeds_the_ble_budget);
  VG_RUN(an_unusable_request_leaves_the_buffer_alone);
  VG_RUN(firmware_versions_are_bounded_and_printable);
  VG_RUN(the_identity_response_is_the_documented_json);
  VG_RUN(the_declared_buffer_size_fits_the_largest_response);
  VG_RUN(unsafe_or_unusable_input_produces_nothing);

  VG_TEST_MAIN_END("identity");
}
