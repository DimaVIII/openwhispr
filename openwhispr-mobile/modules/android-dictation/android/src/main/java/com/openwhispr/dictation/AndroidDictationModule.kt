package com.openwhispr.dictation

import android.content.Intent
import android.net.Uri
import android.os.PowerManager
import android.provider.Settings
import expo.modules.kotlin.Promise
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.kotlin.functions.Queues
import java.io.File
import java.security.MessageDigest

class AndroidDictationModule : Module() {
  private var recorder: WavRecorder? = null
  private val providerRuntime = lazy { ProviderTransport(context) }
  private val speechRuntime = lazy { ParakeetEngine(context) }
  private val providers by providerRuntime
  private val parakeet by speechRuntime
  private val context get() = requireNotNull(appContext.reactContext)
  private fun localFile(uri: String): File {
    val file = File(Uri.parse(uri).path ?: error("Invalid file URI")).canonicalFile
    require(listOf(context.filesDir, context.cacheDir).any { file.path.startsWith(it.canonicalPath + "/") }) { "File is outside app storage." }
    return file
  }
  override fun definition() = ModuleDefinition {
    Name("AndroidDictation")
    Events("onStart", "onRecording", "onError", "onCancel", "onOpenResult", "onStatusChange")
    OnCreate { DictationService.emit = { event, data -> sendEvent(event, data) } }
    OnDestroy {
      appContext.reactContext?.let { it.stopService(Intent(it, DictationService::class.java)) }
      if (providerRuntime.isInitialized()) providers.close()
      if (speechRuntime.isInitialized()) parakeet.close()
      recorder?.close(); DictationService.emit = null
    }
    AsyncFunction("transcribeParakeet") { uri: String, modelDirectory: String, promise: Promise ->
      parakeet.transcribe(localFile(uri), localFile(modelDirectory), promise)
    }
    Function("cancelParakeet") { parakeet.cancel() }
    AsyncFunction("releaseParakeet") { promise: Promise -> parakeet.release(promise) }
    AsyncFunction("requestProvider") { options: Map<String, Any?> -> providers.request(options) }
    Function("cancelProviderRequest") { id: String -> providers.cancel(id) }
    Function("getStatus") {
      mapOf("overlay" to Settings.canDrawOverlays(context), "accessibility" to (InsertionService.instance != null),
        "enabled" to (DictationService.instance != null),
        "microphone" to (context.checkSelfPermission(android.Manifest.permission.RECORD_AUDIO) == android.content.pm.PackageManager.PERMISSION_GRANTED),
        "batteryExempt" to (context.getSystemService(PowerManager::class.java).isIgnoringBatteryOptimizations(context.packageName)))
    }
    Function("openSettings") { kind: String ->
      val intent = when(kind) {
        "overlay" -> Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION, Uri.parse("package:${context.packageName}"))
        "accessibility" -> Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS)
        "battery" -> Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS)
        else -> Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:${context.packageName}"))
      }
      context.startActivity(intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
    }
    Function("setEnabled") { enabled: Boolean, size: Int ->
      if (enabled) {
        check(android.os.Build.VERSION.SDK_INT >= 26) { "The floating bubble needs Android 8 or newer." }
        check(Settings.canDrawOverlays(context)) { "Allow display over other apps first." }
        context.startForegroundService(Intent(context, DictationService::class.java).putExtra("size", size))
      } else context.stopService(Intent(context, DictationService::class.java))
    }
    AsyncFunction("setStatus") { value: String -> DictationService.instance?.status(value) }.runOnQueue(Queues.MAIN)
    AsyncFunction("setBubbleOptions") { options: Map<String, String> ->
      val editor = context.getSharedPreferences("bubble", android.content.Context.MODE_PRIVATE).edit()
      options.forEach { (key, value) -> if (key != "mode") editor.putString(key, value) }
      editor.apply()
      DictationService.instance?.refreshOptions()
    }.runOnQueue(Queues.MAIN)
    AsyncFunction("insert") { text: String, promise: Promise ->
      val service = InsertionService.instance
      if (service == null) promise.resolve(false) else service.insert(text) { promise.resolve(it) }
    }.runOnQueue(Queues.MAIN)
    AsyncFunction("startRecording") {
      check(recorder == null) { "A recording is already active." }
      val next = WavRecorder(context)
      try { next.start(); recorder = next } catch (error: Exception) { next.close(); throw error }
    }
    AsyncFunction("stopRecording") { cancel: Boolean ->
      val active = recorder ?: error("No recording is active.")
      try { active.stop(cancel) } finally { active.close(); recorder = null }
    }
    AsyncFunction("decodeAudio") { uri: String -> AudioDecoder.decode(context, localFile(uri)) }
    AsyncFunction("sha256") { uri: String ->
      val digest = MessageDigest.getInstance("SHA-256")
      localFile(uri).inputStream().buffered().use { input ->
        val buffer = ByteArray(1024 * 1024)
        while (true) { val count = input.read(buffer); if (count < 0) break; digest.update(buffer, 0, count) }
      }
      digest.digest().joinToString("") { "%02x".format(it) }
    }
  }
}
