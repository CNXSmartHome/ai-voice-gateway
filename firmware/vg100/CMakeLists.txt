cmake_minimum_required(VERSION 3.16)

# Fixed here rather than derived from `git describe`, because this string is
# reported to the cloud on every heartbeat (VG-006) and read by the app over
# the provisioning session. A build from a shallow CI checkout must not
# report a different version from the same commit built locally.
set(PROJECT_VER "0.1.0")

include($ENV{IDF_PATH}/tools/cmake/project.cmake)
project(vg100)
