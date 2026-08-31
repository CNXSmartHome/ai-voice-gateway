/*
 * A test harness small enough to read in one sitting.
 *
 * The firmware needs host-runnable tests for its pure C, and vendoring a
 * framework to get four assertion macros would be more code than the tests.
 * Each test file is its own executable with its own `main`, registered
 * individually with CTest, so a crash names the file it happened in.
 */
#ifndef VG_TEST_H
#define VG_TEST_H

#include <stdio.h>
#include <string.h>

static int vg_test_failures = 0;
static const char *vg_test_case = "";

#define VG_FAIL(...)                                                    \
  do {                                                                  \
    vg_test_failures++;                                                 \
    fprintf(stderr, "FAIL %s (%s:%d): ", vg_test_case, __FILE__, __LINE__); \
    fprintf(stderr, __VA_ARGS__);                                       \
    fprintf(stderr, "\n");                                              \
  } while (0)

#define VG_CHECK(condition)                     \
  do {                                          \
    if (!(condition)) {                         \
      VG_FAIL("expected %s", #condition);       \
    }                                           \
  } while (0)

#define VG_CHECK_INT(actual, expected)                                            \
  do {                                                                            \
    long vg_actual = (long)(actual);                                              \
    long vg_expected = (long)(expected);                                          \
    if (vg_actual != vg_expected) {                                               \
      VG_FAIL("%s: expected %ld, got %ld", #actual, vg_expected, vg_actual);      \
    }                                                                             \
  } while (0)

#define VG_CHECK_STR(actual, expected)                                              \
  do {                                                                              \
    const char *vg_actual = (actual);                                               \
    const char *vg_expected = (expected);                                           \
    if (vg_actual == NULL || strcmp(vg_actual, vg_expected) != 0) {                 \
      VG_FAIL("%s: expected \"%s\", got \"%s\"", #actual, vg_expected,              \
              vg_actual == NULL ? "(null)" : vg_actual);                            \
    }                                                                               \
  } while (0)

#define VG_RUN(test_function)   \
  do {                          \
    vg_test_case = #test_function; \
    test_function();            \
    vg_test_case = "";          \
  } while (0)

#define VG_TEST_MAIN_END(suite_name)                                     \
  do {                                                                   \
    if (vg_test_failures == 0) {                                         \
      printf("%s: all checks passed\n", suite_name);                     \
      return 0;                                                          \
    }                                                                    \
    fprintf(stderr, "%s: %d failed check(s)\n", suite_name, vg_test_failures); \
    return 1;                                                            \
  } while (0)

#endif /* VG_TEST_H */
