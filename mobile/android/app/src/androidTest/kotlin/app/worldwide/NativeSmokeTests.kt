package app.worldwide

import android.app.Instrumentation
import android.os.Bundle

/** Dedicated widget/update runners. The native app suite is tests/kotlin-native.mjs. */
class NativeSmokeTests : Instrumentation() {
    private lateinit var args: Bundle

    override fun onCreate(arguments: Bundle) {
        args = arguments
        start()
    }

    override fun onStart() {
        val report = Bundle()
        var result = -1
        try {
            val message =
                when {
                    args.getString("widgetOnly") == "true" -> {
                        WidgetSmokeTests.run(this)
                        "Transparent atlas widget: taps, photo cycling, responsive layouts, wallpaper previews and privacy passed."
                    }
                    args.getString("releaseRetention") == "true" -> {
                        ReleaseRetentionProof.run(this, args)
                        "Signed Worldwide release retained account settings and offline photo."
                    }
                    args.getString("updateOnly") == "true" -> {
                        UpdateSmokeTests.run(this, args)
                        "Android updater validation and data retention passed."
                    }
                    else ->
                        error("Use npm run test:android for the native Kotlin application suite.")
                }
            report.putString("stream", message + "\n")
        } catch (error: Throwable) {
            result = 1
            report.putString("stream", error.stackTraceToString())
        }
        finish(result, report)
    }
}
