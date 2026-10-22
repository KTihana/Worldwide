package app.worldwide

import android.app.AlertDialog
import android.app.Instrumentation
import android.content.Intent
import android.content.pm.ActivityInfo
import android.os.Bundle
import android.view.View
import android.view.WindowInsets

/** Native orientation and header clearance checks, only in a disposable app. */
class OrientationSmokeTests : Instrumentation() {
    override fun onCreate(args: Bundle) {
        super.onCreate(args)
        start()
    }

    override fun onStart() {
        val report = Bundle()
        var activity: MainActivity? = null
        var code = -1
        try {
            check(targetContext.packageName != "app.worldwide")
            activity =
                startActivitySync(
                    Intent(targetContext, MainActivity::class.java)
                        .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                )
                    as MainActivity
            await { runCatching { activity.mapView.scene != null }.getOrDefault(false) }
            run(this, activity)
            report.putString(
                "stream",
                "Native landscape map, header-only clearance, portrait account and landscape return passed.\n",
            )
        } catch (error: Throwable) {
            code = 1
            report.putString("stream", error.stackTraceToString())
        } finally {
            activity?.let { runOnMainSync { it.finish() } }
        }
        finish(code, report)
    }

    companion object {
        private fun await(test: () -> Boolean) {
            repeat(150) {
                if (test()) return
                Thread.sleep(100)
            }
            error("Native orientation check timed out")
        }

        @JvmStatic
        fun run(test: Instrumentation, activity: MainActivity) {
            check(test.targetContext.packageName != "app.worldwide")
            await {
                activity.requestedOrientation == ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE &&
                    activity.resources.configuration.orientation ==
                        android.content.res.Configuration.ORIENTATION_LANDSCAPE
            }
            test.runOnMainSync {
                val map = activity.mapView
                val root = map.parent as View
                check(map.width == root.width && map.height == root.height && map.paddingTop == 0) {
                    "Map and water remain edge to edge"
                }
                val header =
                    MainActivity::class
                        .java
                        .getDeclaredField("header")
                        .apply { isAccessible = true }
                        .get(activity) as View
                val actions =
                    MainActivity::class
                        .java
                        .getDeclaredField("actions")
                        .apply { isAccessible = true }
                        .get(activity) as View
                val top =
                    if (android.os.Build.VERSION.SDK_INT >= 30)
                        root.rootWindowInsets.getInsets(WindowInsets.Type.systemBars()).top
                    else root.rootWindowInsets.systemWindowInsetTop
                for (control in listOf(header, actions)) {
                    val location = IntArray(2)
                    control.getLocationOnScreen(location)
                    check(location[1] >= top) { "Only header controls clear the status bar" }
                }
                if (android.os.Build.VERSION.SDK_INT >= 30) {
                    val bars = root.rootWindowInsets.getInsets(WindowInsets.Type.systemBars())
                    for (name in
                        listOf("header", "actions", "zoomControls", "mapActions", "navigation")) {
                        val control =
                            MainActivity::class
                                .java
                                .getDeclaredField(name)
                                .apply { isAccessible = true }
                                .get(activity) as View
                        val point = IntArray(2)
                        control.getLocationOnScreen(point)
                        val rect =
                            android.graphics.Rect(
                                point[0],
                                point[1],
                                point[0] + control.width,
                                point[1] + control.height,
                            )
                        for (cutout in
                            root.rootWindowInsets.displayCutout?.boundingRects.orEmpty()) check(
                            !android.graphics.Rect.intersects(rect, cutout)
                        ) {
                            "$name avoids the camera cutout"
                        }
                        check(
                            point[0] >= bars.left &&
                                point[0] + control.width <=
                                    activity.window.decorView.width - bars.right
                        ) {
                            "$name clears side system bars"
                        }
                    }
                }
                MainActivity::class
                    .java
                    .getDeclaredMethod("showAccount")
                    .apply { isAccessible = true }
                    .invoke(activity)
            }
            await {
                activity.requestedOrientation == ActivityInfo.SCREEN_ORIENTATION_PORTRAIT &&
                    activity.resources.configuration.orientation ==
                        android.content.res.Configuration.ORIENTATION_PORTRAIT
            }
            test.waitForIdleSync()
            test.runOnMainSync {
                (MainActivity::class
                        .java
                        .getDeclaredField("accountDialog")
                        .apply { isAccessible = true }
                        .get(activity) as AlertDialog)
                    .dismiss()
            }
            await {
                activity.requestedOrientation == ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE &&
                    activity.resources.configuration.orientation ==
                        android.content.res.Configuration.ORIENTATION_LANDSCAPE
            }
        }
    }
}
