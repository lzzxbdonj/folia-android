#include <jni.h>
#include <node.h>
#include <atomic>
#include <cstdlib>
#include <cstring>
#include <string>
#include <vector>
#include <fcntl.h>
#include <unistd.h>

// Starts nodejs-mobile exactly once; Node owns argv memory until its event loop exits.
namespace {
std::atomic<bool> started{false};

std::string fromJava(JNIEnv* env, jstring value) {
    if (env->ExceptionCheck() || value == nullptr) return {};
    const char* bytes = env->GetStringUTFChars(value, nullptr);
    if (bytes == nullptr) return {};
    std::string result(bytes);
    env->ReleaseStringUTFChars(value, bytes);
    return result;
}
}

extern "C" JNIEXPORT jint JNICALL
Java_top_izuna_folia_androidport_FoliaNodeRuntime_nativeStart(
    JNIEnv* env, jclass, jstring script, jstring secret, jstring project, jstring data, jstring temp) {
    if (started.exchange(true)) return -2;
    const std::string scriptPath = fromJava(env, script);
    const std::string token = fromJava(env, secret);
    const std::string projectPath = fromJava(env, project);
    const std::string dataPath = fromJava(env, data);
    const std::string tempPath = fromJava(env, temp);
    if (env->ExceptionCheck()) return -3;
    if (chdir(projectPath.c_str()) != 0) return -4;
    if (setenv("HOME", dataPath.c_str(), 1) != 0 ||
        setenv("FOLIA_DATA_DIR", dataPath.c_str(), 1) != 0 ||
        setenv("TMPDIR", tempPath.c_str(), 1) != 0 ||
        setenv("NODE_ENV", "production", 1) != 0) return -5;

    // Sends Node's own stdout/stderr to a private file; app logs are often withheld on Android.
    const std::string logPath = dataPath + "/node.log";
    int log = open(logPath.c_str(), O_WRONLY | O_CREAT | O_TRUNC, 0600);
    if (log >= 0) {
        dup2(log, STDOUT_FILENO);
        dup2(log, STDERR_FILENO);
        if (log > STDERR_FILENO) close(log);
    }

    // A "debug" marker file in the private data directory enables verbose backend stacks.
    const std::string debugMarker = dataPath + "/debug";
    if (access(debugMarker.c_str(), F_OK) == 0) setenv("FOLIA_BACKEND_DEBUG", "1", 1);

    // Node may mutate argv, so keep one contiguous writable backing allocation.
    std::vector<char> buffer(5 + scriptPath.size() + 1 + token.size() + 1);
    char* argv[4] = {buffer.data(), nullptr, nullptr, nullptr};
    std::memcpy(argv[0], "node", 5);
    argv[1] = argv[0] + 5;
    std::memcpy(argv[1], scriptPath.c_str(), scriptPath.size() + 1);
    argv[2] = argv[1] + scriptPath.size() + 1;
    std::memcpy(argv[2], token.c_str(), token.size() + 1);
    return node::Start(3, argv);
}
