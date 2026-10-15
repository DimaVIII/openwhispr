package com.openwhispr.dictation

import android.content.Context
import android.media.AudioFormat
import android.media.AudioRecord
import android.media.MediaRecorder
import java.io.File
import java.io.RandomAccessFile
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.util.concurrent.Executors
import java.util.concurrent.Future
import java.util.concurrent.atomic.AtomicBoolean
import kotlin.math.abs

class WavRecorder(private val context: Context) {
  companion object { private val microphoneInUse = AtomicBoolean(false) }
  private var ownsMicrophone = false
  private val executor = Executors.newSingleThreadExecutor()
  @Volatile private var recording = false
  private var recorder: AudioRecord? = null
  private var task: Future<*>? = null
  private var file: File? = null
  private var peak = 0
  private var samples = 0L

  @Synchronized fun start() {
    check(!recording) { "A recording is already active." }
    check(microphoneInUse.compareAndSet(false, true)) { "Finish your current recording first." }
    ownsMicrophone = true
    try {
    val size = maxOf(4096, AudioRecord.getMinBufferSize(16000, AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT))
    val audio = AudioRecord(MediaRecorder.AudioSource.VOICE_RECOGNITION, 16000,
      AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT, size)
    check(audio.state == AudioRecord.STATE_INITIALIZED) { audio.release(); "Microphone could not start." }
    val destination = File(context.cacheDir, "dictation-${System.nanoTime()}.wav")
    file = destination; recorder = audio; peak = 0; samples = 0
    audio.startRecording(); recording = true
    task = executor.submit {
      RandomAccessFile(destination, "rw").use { out ->
        out.write(ByteArray(44))
        val buffer = ShortArray(size / 2)
        while (recording && samples < 16000L * 300) {
          val count = audio.read(buffer, 0, buffer.size)
          if (count < 0 && !recording) break
          check(count >= 0) { "Microphone interrupted ($count)." }
          val bytes = ByteBuffer.allocate(count * 2).order(ByteOrder.LITTLE_ENDIAN)
          for (i in 0 until count) { bytes.putShort(buffer[i]); peak = maxOf(peak, abs(buffer[i].toInt())) }
          out.write(bytes.array()); samples += count
        }
        val dataSize = (samples * 2).toInt()
        val header = ByteBuffer.allocate(44).order(ByteOrder.LITTLE_ENDIAN)
        header.put("RIFF".toByteArray()).putInt(dataSize + 36).put("WAVEfmt ".toByteArray())
        header.putInt(16).putShort(1).putShort(1).putInt(16000).putInt(32000).putShort(2).putShort(16)
        header.put("data".toByteArray()).putInt(dataSize)
        out.seek(0); out.write(header.array())
      }
    }
    } catch (error: Exception) { close(); throw error }
  }

  @Synchronized fun stop(cancel: Boolean): Map<String, Any> {
    check(recorder != null) { "No recording is active." }
    recording = false
    try {
      recorder?.stop(); task?.get()
      val result = mapOf("uri" to "file://${file!!.absolutePath}", "durationMs" to samples * 1000 / 16000,
        "noSpeech" to (samples < 4000 || peak < 180))
      if (cancel) file?.delete()
      return result
    } catch (error: Exception) { file?.delete(); throw error }
    finally { recorder?.release(); recorder = null; task = null; file = null; freeMicrophone() }
  }

  private fun freeMicrophone() { if (ownsMicrophone) { ownsMicrophone = false; microphoneInUse.set(false) } }
  fun close() { if (recorder != null) runCatching { stop(true) }; freeMicrophone(); executor.shutdown() }
}
