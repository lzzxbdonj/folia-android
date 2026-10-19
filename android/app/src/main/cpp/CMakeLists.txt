cmake_minimum_required(VERSION 3.22.1)
project(folia_runtime LANGUAGES CXX)

# The distribution provides Android libraries and matching Node 18.20.4 headers.
if(NOT EXISTS "${NODEJS_MOBILE_DIR}/bin/${ANDROID_ABI}/libnode.so")
    message(FATAL_ERROR "Missing nodejs-mobile library for ${ANDROID_ABI}: set -PnodejsMobileDir=<distribution>")
endif()
add_library(node SHARED IMPORTED)
set_target_properties(node PROPERTIES IMPORTED_LOCATION "${NODEJS_MOBILE_DIR}/bin/${ANDROID_ABI}/libnode.so")
add_library(folia-runtime SHARED foliaRuntime.cpp)
target_compile_features(folia-runtime PRIVATE cxx_std_17)
target_include_directories(folia-runtime PRIVATE "${NODEJS_MOBILE_DIR}/include/node")
target_link_libraries(folia-runtime PRIVATE node android log)
# Android 15+ 16 KiB page-size compatibility (the supplied libnode is also 16 KiB aligned).
target_link_options(folia-runtime PRIVATE "-Wl,-z,max-page-size=16384" "-Wl,-z,common-page-size=16384")
