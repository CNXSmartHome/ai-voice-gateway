# Pure C. No REQUIRES, because nothing here may depend on ESP-IDF: the same
# sources are compiled by the host test build in `test/host`, which has no
# ESP-IDF toolchain at all.
idf_component_register(
  SRCS "src/vg_provisioning.c" "src/vg_identity.c"
  INCLUDE_DIRS "include")

# Warnings are errors for code this project owns. ESP-IDF does not do this
# for application components by default, and a truncation or an
# uninitialised read here is a field failure rather than a build annoyance.
target_compile_options(${COMPONENT_LIB} PRIVATE -Wall -Wextra -Werror -Wshadow)
