package app.worldwide

import android.app.Instrumentation
import android.content.*
import android.graphics.*
import android.net.Uri
import android.os.Bundle
import android.view.*
import android.view.accessibility.AccessibilityNodeInfo
import java.io.File
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicReference
import org.json.JSONObject

/** Only the disposable test package is installed or modified by this runner. */
class KotlinSmokeTests : Instrumentation() {
    private lateinit var args: Bundle
    private var activity: MainActivity? = null

    override fun onCreate(arguments: Bundle) {
        args = arguments
        start()
    }

    override fun onStart() {
        val result = Bundle()
        try {
            check(targetContext.packageName == "app.worldwide.nativetest")
            for (address in
                listOf(
                    "127.0.0.1",
                    "10.0.0.1",
                    "172.16.0.1",
                    "192.168.0.1",
                    "169.254.169.254",
                    "100.64.0.1",
                    "::1",
                    "fc00::1",
                    "fe80::1",
                    "2001:db8::1",
                )) check(
                !PublicPhotoDownload.publicAddress(java.net.InetAddress.getByName(address)),
                "Public imports reject private/reserved addresses",
            )
            check(
                PublicPhotoDownload.publicAddress(java.net.InetAddress.getByName("8.8.8.8")),
                "Public IPv4 imports remain allowed",
            )
            migrationAndStandalone()
            launch()
            OrientationSmokeTests.run(this, activity!!)
            val repo = activity!!.repository
            val first = repo.atlas().getJSONArray("photos").getJSONObject(0)
            check(
                first.getString("id") == "a73882ee-0188-4b88-95fe-d6ab6a3f3211",
                "Photo identity survived the old-to-Kotlin APK update",
            )
            check(first.getDouble("cropZoom") == 1.5, "Crop survived upgrade")
            check(
                repo.prefs.getString("album-owner-id", "") == args.getString("albumId"),
                "Stable computer identity survived upgrade",
            )
            check(
                repo.prefs.getString("cookie", "") == args.getString("cookie"),
                "Existing session survived upgrade",
            )
            check(
                repo
                    .photoFile(first.getString("id"))
                    .readBytes()
                    .contentEquals(File(targetContext.filesDir, "retention-photo.png").readBytes()),
                "Original photo bytes survived the in-place APK replacement",
            )
            onUi {
                val decor = activity!!.window.decorView
                check(countWebViews(decor) == 0, "Kotlin UI contains no WebView")
                check(
                    activity!!.mapView.width == (activity!!.mapView.parent as View).width &&
                        activity!!.mapView.height == (activity!!.mapView.parent as View).height,
                    "Map and water remain edge to edge",
                )
            }
            onUi {
                val map = activity!!.mapView
                val x = map.width * .54f
                val y = map.height * .33f
                val time = android.os.SystemClock.uptimeMillis()
                for ((offset, action) in
                    listOf(
                        0L to MotionEvent.ACTION_DOWN,
                        30L to MotionEvent.ACTION_UP,
                        90L to MotionEvent.ACTION_DOWN,
                        120L to MotionEvent.ACTION_UP,
                    )) {
                    val event = MotionEvent.obtain(time, time + offset, action, x, y, 0)
                    map.onTouchEvent(event)
                    event.recycle()
                }
            }
            Thread.sleep(500)
            check(
                activity!!.mapView.scene?.scope == "World",
                "Double tap zoom does not open a country",
            )
            onUi { activity!!.mapView.fit(false) }
            click("World")
            waitFor("place list") {
                uiAutomation.rootInActiveWindow
                    ?.findAccessibilityNodeInfosByText("Choose a place")
                    ?.isNotEmpty() == true
            }
            check(
                !hasClass(uiAutomation.rootInActiveWindow, "android.widget.EditText"),
                "World menu contains no search field or keyboard",
            )
            click("Italy")
            waitFor("native country scene") { activity!!.mapView.scene?.scope == "ITA" }
            val before = repo.atlas().getJSONArray("photos").length()
            val source = File(targetContext.cacheDir, "kotlin-import.png")
            val bitmap = Bitmap.createBitmap(100, 70, Bitmap.Config.ARGB_8888)
            bitmap.eraseColor(Color.rgb(70, 130, 100))
            source.outputStream().use { bitmap.compress(Bitmap.CompressFormat.PNG, 100, it) }
            bitmap.recycle()
            val receive =
                MainActivity::class
                    .java
                    .getDeclaredMethod(
                        "onActivityResult",
                        Int::class.javaPrimitiveType,
                        Int::class.javaPrimitiveType,
                        Intent::class.java,
                    )
                    .apply { isAccessible = true }
            onUi {
                receive.invoke(
                    activity,
                    10,
                    android.app.Activity.RESULT_OK,
                    Intent().setData(Uri.fromFile(source)),
                )
            }
            waitFor("native photo import") {
                repo.atlas().getJSONArray("photos").length() == before + 1
            }
            waitFor("visible native thumbnail") {
                onUi { hasThumbnail(activity!!.window.decorView) }
            }
            val imported =
                AlbumRepository.jsonObjects(repo.atlas().getJSONArray("photos"))
                    .first { it.getString("countryId") == "ITA" }
                    .getString("id")
            check(
                repo.originalFile(imported).readBytes().contentEquals(source.readBytes()),
                "Full-resolution original is preserved privately",
            )
            repo.patch(
                "/api/countries/HRV",
                JSONObject().put("note", "Edited by native Kotlin").put("visited", true),
            )
            repo.patch(
                "/api/photos/$imported",
                JSONObject().put("caption", "Kotlin memory").put("cropZoom", 1.7).put("cropX", .3),
            )
            repo.requestSync()
            waitFor("two-way native sync", 250) {
                repo.status().optBoolean("connected") && repo.status().getInt("pending") == 0
            }
            check(
                AlbumRepository.jsonObjects(repo.atlas().getJSONArray("visits")).any {
                    it.getString("countryId") == "JPN" &&
                        it.optString("note") == "Created on computer"
                },
                "Computer edits reach the native phone",
            )
            // Failed pairing must not replace the old session or discard the phone album.
            val identity = repo.prefs.getString("album-owner-id", "")
            try {
                repo.pair(args.getString("otherQr")!!)
                error("Different album was accepted")
            } catch (_: java.io.IOException) {}
            check(
                repo.prefs.getString("album-owner-id", "") == identity,
                "Different computer album remains separate",
            )
            repo.disconnect()
            repo.patch(
                "/api/countries/ITA",
                JSONObject().put("note", "Saved without an account").put("visited", true),
            )
            restart()
            val reopened = activity!!.repository
            check(
                reopened.account() == null &&
                    reopened.atlas().getJSONArray("photos").length() == before + 1,
                "Disconnected album and original photos survive restart",
            )
            check(
                AlbumRepository.jsonObjects(reopened.atlas().getJSONArray("visits")).any {
                    it.optString("note") == "Saved without an account"
                },
                "Standalone edit survives restart",
            )
            check(
                reopened.local.pending() > 0,
                "Unsynced standalone edits remain in the SQLite journal",
            )
            val qrBytes =
                android.util.Base64.decode(args.getString("qrPng"), android.util.Base64.DEFAULT)
            val qrBitmap = BitmapFactory.decodeByteArray(qrBytes, 0, qrBytes.size)
            val pixels = IntArray(qrBitmap.width * qrBitmap.height)
            qrBitmap.getPixels(pixels, 0, qrBitmap.width, 0, 0, qrBitmap.width, qrBitmap.height)
            val qrValue =
                com.google.zxing.qrcode
                    .QRCodeReader()
                    .decode(
                        com.google.zxing.BinaryBitmap(
                            com.google.zxing.common.HybridBinarizer(
                                com.google.zxing.RGBLuminanceSource(
                                    qrBitmap.width,
                                    qrBitmap.height,
                                    pixels,
                                )
                            )
                        )
                    )
                    .text
            qrBitmap.recycle()
            reopened.pair(qrValue)
            waitFor("QR reconnect and offline replay", 250) {
                reopened.status().optBoolean("connected") && reopened.local.pending() == 0
            }
            check(
                AlbumRepository.jsonObjects(reopened.atlas().getJSONArray("visits")).any {
                    it.optString("note") == "Saved without an account"
                },
                "Offline edit survives QR reconnection",
            )
            frameProof()
            val exported =
                activity!!.mapView.export(activity!!.mapView.scene!!, reopened.atlas(), reopened)
            check(
                exported.width == 4000 && exported.height == 2400,
                "Native map export retains full output resolution",
            )
            exported.recycle()
            onUi { activity!!.mapView.fit(false) }
            waitForIdleSync()
            Thread.sleep(500)
            screenshot(File(targetContext.cacheDir, "kotlin-world.png").path)
            result.putString(
                "stream",
                "PASS: native Kotlin UI, old APK upgrade retention, photo import/originals/crops, offline restart, two-way sync, identity separation, keyboard-free World menu, no WebView.\n",
            )
            finish(-1, result)
        } catch (error: Throwable) {
            result.putString(
                "stream",
                error.stackTraceToString() +
                    runCatching {
                            "\nFrame timings: " +
                                File(targetContext.cacheDir, "kotlin-frames.json").readText()
                        }
                        .getOrDefault(""),
            )
            finish(1, result)
        } finally {
            activity?.let { onUi { it.finish() } }
        }
    }

    private fun migrationAndStandalone() {
        val base = targetContext
        val root =
            File(base.cacheDir, "kotlin-storage-proof").apply {
                deleteRecursively()
                mkdirs()
            }
        val old = File(root, "old").apply { mkdirs() }
        val legacy =
            JSONObject()
                .put("photos", org.json.JSONArray())
                .put(
                    "visits",
                    org.json
                        .JSONArray()
                        .put(
                            JSONObject()
                                .put("countryId", "HRV")
                                .put("visited", 1)
                                .put("note", "Legacy note")
                                .put("coverId", JSONObject.NULL)
                                .put("visitDate", JSONObject.NULL)
                        ),
                )
        File(old, "atlas.json").writeText(legacy.toString())
        val migrated = LocalAlbum(old, false, setOf("HRV"))
        check(
            migrated.atlas().getJSONArray("visits").getJSONObject(0).getString("note") ==
                "Legacy note",
            "Legacy JSON migration",
        )
        check(migrated.pending() == 1, "Migrated unpaired edits queue once")
        migrated.close()
        val again = LocalAlbum(old, false, setOf("HRV"))
        check(again.pending() == 1, "Restart never duplicates migration queue")
        again.close()
        val wrapper =
            object : ContextWrapper(base) {
                override fun getFilesDir() = File(root, "standalone").apply { mkdirs() }

                override fun getSharedPreferences(name: String, mode: Int) =
                    base.getSharedPreferences("kotlin-standalone-$name", mode)

                override fun getApplicationContext(): Context = this
            }
        val fresh = AlbumRepository(wrapper)
        check(
            fresh.account() == null && fresh.atlas().getJSONArray("photos").length() == 0,
            "Fresh native album needs no account or computer",
        )
        fresh.patch(
            "/api/countries/HRV",
            JSONObject().put("visited", true).put("note", "Device owned"),
        )
        val cacheImage = Bitmap.createBitmap(640, 640, Bitmap.Config.ARGB_8888)
        val buffer = java.io.ByteArrayOutputStream()
        cacheImage.compress(Bitmap.CompressFormat.PNG, 100, buffer)
        cacheImage.recycle()
        fresh.local.savePhoto("cache-proof", "image/png", buffer.toByteArray())
        val cache = PhotoCache(fresh)
        val loaded = java.util.concurrent.atomic.AtomicInteger()
        onUi {
            repeat(2) {
                if (cache.get("cache-proof", 96) { loaded.incrementAndGet() } != null)
                    loaded.incrementAndGet()
            }
        }
        waitFor("shared photo decode notifies every visible consumer") { loaded.get() >= 2 }
        cache.close()
        val overlapping = AlbumRepository(wrapper)
        check(
            overlapping.local === fresh.local,
            "Overlapping activities share the same durable journal",
        )
        fresh.close()
        overlapping.patch("/api/countries/ITA", JSONObject().put("visited", true))
        overlapping.close()
        val resumed = AlbumRepository(wrapper)
        check(
            resumed.atlas().getJSONArray("visits").getJSONObject(0).getString("note") ==
                "Device owned"
        )
        check(
            AlbumRepository.jsonObjects(resumed.atlas().getJSONArray("visits")).any {
                it.optString("countryId") == "ITA"
            },
            "Closing one activity keeps the other activity's journal available",
        )
        resumed.close()
        root.deleteRecursively()
    }

    private fun launch() {
        onUi {}
        activity =
            startActivitySync(
                Intent(targetContext, MainActivity::class.java)
                    .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            )
                as MainActivity
        waitFor("Kotlin map") {
            runCatching { activity!!.mapView.scene?.shapes?.isNotEmpty() == true }
                .getOrDefault(false)
        }
    }

    private fun restart() {
        val old = activity!!
        onUi { old.finish() }
        waitForIdleSync()
        Thread.sleep(500)
        launch()
    }

    private fun <T> onUi(block: () -> T): T {
        val value = AtomicReference<T>()
        val failure = AtomicReference<Throwable>()
        runOnMainSync {
            try {
                value.set(block())
            } catch (e: Throwable) {
                failure.set(e)
            }
        }
        failure.get()?.let { throw it }
        return value.get()
    }

    private fun waitFor(label: String, attempts: Int = 150, test: () -> Boolean) {
        repeat(attempts) {
            if (runCatching { test() }.getOrDefault(false)) return
            Thread.sleep(100)
        }
        error("Timed out: $label")
    }

    private fun click(label: String) {
        waitFor("$label control") {
            val node =
                uiAutomation.rootInActiveWindow
                    ?.findAccessibilityNodeInfosByText(label)
                    ?.firstOrNull { it.text?.toString() == label }
            if (node != null) {
                var target: AccessibilityNodeInfo? = node
                while (target != null && !target.isClickable) target = target.parent
                target?.performAction(AccessibilityNodeInfo.ACTION_CLICK) == true
            } else {
                scrollList(uiAutomation.rootInActiveWindow)
                false
            }
        }
    }

    private fun scrollList(node: AccessibilityNodeInfo?): Boolean {
        if (node == null) return false
        if (node.className == "android.widget.ListView" && node.isScrollable)
            return node.performAction(AccessibilityNodeInfo.ACTION_SCROLL_FORWARD)
        for (index in 0 until node.childCount) if (scrollList(node.getChild(index))) return true
        return false
    }

    private fun hasClass(node: AccessibilityNodeInfo?, name: String): Boolean {
        if (node == null) return false
        if (node.className == name) return true
        for (i in 0 until node.childCount) if (hasClass(node.getChild(i), name)) return true
        return false
    }

    private fun hasThumbnail(view: View): Boolean {
        if (
            view is android.widget.ImageView &&
                view.contentDescription == "Memory from Italy" &&
                view.drawable is android.graphics.drawable.BitmapDrawable
        )
            return true
        return view is ViewGroup &&
            (0 until view.childCount).any { hasThumbnail(view.getChildAt(it)) }
    }

    private fun countWebViews(view: View): Int {
        if (view is android.webkit.WebView) return 1
        return if (view is ViewGroup)
            (0 until view.childCount).sumOf { countWebViews(view.getChildAt(it)) }
        else 0
    }

    private fun screenshot(path: String) {
        val screenshot = uiAutomation.takeScreenshot()
        File(path).parentFile?.mkdirs()
        File(path).outputStream().use { screenshot.compress(Bitmap.CompressFormat.PNG, 100, it) }
        screenshot.recycle()
    }

    private fun frameProof() {
        fun measure(visible: Boolean, total: Int): List<Double> {
            val latch = CountDownLatch(1)
            val samples = java.util.Collections.synchronizedList(mutableListOf<Long>())
            onUi {
                activity!!.mapView.visibility = if (visible) View.VISIBLE else View.INVISIBLE
                activity!!.mapView.fit(false)
            }
            waitForIdleSync()
            Thread.sleep(500)
            onUi {
                val callback =
                    object : Choreographer.FrameCallback {
                        var previous = 0L
                        var frame = 0

                        override fun doFrame(time: Long) {
                            if (previous != 0L) samples.add(time - previous)
                            previous = time
                            if (visible)
                                activity!!.mapView.zoomBy(if (frame < total / 2) 1.004f else .996f)
                            else (activity!!.mapView.parent as View).invalidate()
                            frame++
                            if (frame < total) Choreographer.getInstance().postFrameCallback(this)
                            else latch.countDown()
                        }
                    }
                Choreographer.getInstance().postFrameCallback(callback)
            }
            check(latch.await(40, TimeUnit.SECONDS), "Native map remains responsive")
            return samples.drop(24).map { it / 1000000.0 }.sorted()
        }
        val baseline = measure(false, 90)
        val frames = measure(true, 180)
        val backgroundMedian = baseline[baseline.size / 2]
        val median = frames[frames.size / 2]
        val p95 = frames[(frames.size * .95).toInt().coerceAtMost(frames.lastIndex)]
        val budget = maxOf(50.0, backgroundMedian + 16.67)
        File(targetContext.cacheDir, "kotlin-frames.json")
            .writeText(
                JSONObject()
                    .put("frames", frames.size)
                    .put("baselineMedianMs", backgroundMedian)
                    .put("medianMs", median)
                    .put("p95Ms", p95)
                    .put("budgetMs", budget)
                    .toString()
            )
        check(
            median <= budget,
            "Native map median ${median}ms exceeds ${budget}ms budget (host baseline ${backgroundMedian}ms, p95 ${p95}ms)",
        )
    }

    private fun check(value: Boolean, message: String = "Check failed") {
        if (!value) throw AssertionError(message)
    }
}
