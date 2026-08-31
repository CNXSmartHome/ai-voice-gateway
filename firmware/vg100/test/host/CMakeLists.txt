# Host build for the pure-C firmware components.
#
# ESP-IDF can run tests on target hardware, and none of that is available to
# CI or to anyone reviewing a pull request. Everything worth asserting about
# provisioning policy is arithmetic and branching, so it is kept free of
# ESP-IDF and compiled here with a stock compiler instead. The ESP-IDF build
# compiles these same sources; see `../../components/vg_core`.
cmake_minimum_required(VERSION 3.16)
project(vg100_host_tests C)

set(CMAKE_C_STANDARD 11)
set(CMAKE_C_STANDARD_REQUIRED ON)
set(CMAKE_C_EXTENSIONS OFF)

if(NOT MSVC)
  # Warnings are errors here. The same sources are cross-compiled for a
  # device where a truncation or an uninitialised read is a field failure.
  add_compile_options(-Wall -Wextra -Werror -Wshadow -Wpedantic -Wvla)
endif()

set(VG_CORE_DIR ${CMAKE_CURRENT_SOURCE_DIR}/../../components/vg_core)

add_library(vg_core STATIC
  ${VG_CORE_DIR}/src/vg_provisioning.c
  ${VG_CORE_DIR}/src/vg_identity.c)
target_include_directories(vg_core PUBLIC ${VG_CORE_DIR}/include)

enable_testing()

foreach(suite provisioning identity)
  add_executable(test_${suite} test_${suite}.c)
  target_link_libraries(test_${suite} PRIVATE vg_core)
  add_test(NAME ${suite} COMMAND test_${suite})
endforeach()
