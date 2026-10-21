package app.worldwide

import android.app.*
import android.appwidget.*
import android.content.*
import android.graphics.*
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.provider.Settings
import android.text.*
import android.util.SizeF
import android.util.TypedValue
import android.view.View
import android.widget.RemoteViews
import androidx.core.graphics.PathParser
import java.io.File
import java.util.concurrent.Executors
import kotlin.math.*
import org.json.JSONObject

/** Offline home-screen view. Album files never leave the app's private storage. */
class MapWidgetProvider : AppWidgetProvider() {
    class Country(value: JSONObject) {
        @JvmField val id = value.getString("id")
        @JvmField val name = value.getString("name")
        @JvmField val path = PathParser.createPathFromPathData(value.getString("path"))!!
        @JvmField
        val bounds =
            value.getJSONArray("bounds").let {
                RectF(
                    it.getDouble(0).toFloat(),
                    it.getDouble(1).toFloat(),
                    it.getDouble(2).toFloat(),
                    it.getDouble(3).toFloat(),
                )
            }
    }

    override fun onReceive(context: Context, intent: Intent) {
        val manager = AppWidgetManager.getInstance(context)
        when (intent.action) {
            ACTION -> {
                val id = intent.getIntExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, -1)
                if (
                    id in
                        manager.getAppWidgetIds(
                            ComponentName(context, MapWidgetProvider::class.java)
                        )
                )
                    enqueue(context, intArrayOf(id), intent.getStringExtra("tap"))
            }
            Intent.ACTION_WALLPAPER_CHANGED ->
                enqueue(
                    context,
                    manager.getAppWidgetIds(ComponentName(context, MapWidgetProvider::class.java)),
                    null,
                )
            else -> super.onReceive(context, intent)
        }
    }

    private fun enqueue(context: Context, ids: IntArray, action: String?) {
        val app = context.applicationContext
        val pending = goAsync()
        worker.execute {
            try {
                for (id in ids) {
                    if (action != null) select(app, id, action)
                    update(app, id)
                }
            } finally {
                pending?.finish()
            }
        }
    }

    override fun onUpdate(context: Context, manager: AppWidgetManager, ids: IntArray) =
        enqueue(context, ids, null)

    override fun onAppWidgetOptionsChanged(
        context: Context,
        manager: AppWidgetManager,
        id: Int,
        options: Bundle,
    ) = enqueue(context, intArrayOf(id), null)

    override fun onDeleted(context: Context, ids: IntArray) {
        state(context).edit().apply { for (id in ids) remove(key(id)).remove("photo-$id") }.apply()
    }

    companion object {
        const val COLS = 24
        const val ROWS = 12
        private const val ACTION = "app.worldwide.WIDGET_TAP"
        private val worker = Executors.newSingleThreadExecutor()
        private var cachedCountries: List<Country>? = null
        private val refreshing = java.util.concurrent.atomic.AtomicBoolean()
        private val refreshRevision = java.util.concurrent.atomic.AtomicInteger()

        @JvmStatic
        fun requestRefresh(context: Context) {
            refreshRevision.incrementAndGet()
            if (!refreshing.compareAndSet(false, true)) return
            val app = context.applicationContext
            worker.execute {
                var done = 0
                try {
                    do {
                        done = refreshRevision.get()
                        refresh(app)
                    } while (done != refreshRevision.get())
                } finally {
                    refreshing.set(false)
                    if (done != refreshRevision.get()) requestRefresh(app)
                }
            }
        }

        @JvmStatic
        @Synchronized
        fun countries(context: Context): List<Country> {
            cachedCountries?.let {
                return it
            }
            val values =
                JSONObject(
                        context.assets.open("widget-world.json").bufferedReader().use {
                            it.readText()
                        }
                    )
                    .getJSONArray("countries")
            return (0 until values.length())
                .map { Country(values.getJSONObject(it)) }
                .also { cachedCountries = it }
        }

        @JvmStatic
        fun state(context: Context): SharedPreferences =
            context.getSharedPreferences("map-widgets", 0)

        @JvmStatic fun key(id: Int) = "country-$id"

        @JvmStatic
        fun album(context: Context): JSONObject = runCatching {
            JSONObject(File(context.filesDir, "album/atlas.json").readText())
        }
            .getOrElse { JSONObject() }

        @JvmStatic
        fun photos(album: JSONObject, country: String?): List<JSONObject> {
            val result =
                objects(album, "photos")
                    .filter { it.optString("countryId") == country }
                    .toMutableList()
            for (visit in objects(album, "visits")) {
                if (visit.optString("countryId") != country) continue
                val at = result.indexOfFirst {
                    it.optString("id") == visit.optString("coverId", "")
                }
                if (at >= 0) result.add(0, result.removeAt(at))
            }
            return result
        }

        private fun photoFile(context: Context, item: JSONObject): File {
            val id = item.getString("id")
            require(id.matches(Regex("[a-zA-Z0-9_-]+")))
            return File(context.filesDir, "album/${LocalAlbum.key("/api/photos/$id")}.photo")
        }

        @JvmStatic
        fun photoExists(context: Context, item: JSONObject) = runCatching {
            photoFile(context, item).isFile
        }
            .getOrDefault(false)

        @JvmStatic
        fun photo(context: Context, item: JSONObject): Bitmap? = runCatching {
            val path = photoFile(context, item).path
            val options = BitmapFactory.Options().apply { inJustDecodeBounds = true }
            BitmapFactory.decodeFile(path, options)
            if (options.outWidth <= 0 || options.outHeight <= 0) return@runCatching null
            options.inSampleSize = 1
            while (max(options.outWidth, options.outHeight) / options.inSampleSize > 640) options
                .inSampleSize *= 2
            options.inJustDecodeBounds = false
            BitmapFactory.decodeFile(path, options)
        }
            .getOrNull()

        private fun tap(context: Context, id: Int, action: String): PendingIntent {
            val intent =
                Intent(context, MapWidgetProvider::class.java)
                    .setAction(ACTION)
                    .setData(Uri.parse("worldwide-widget://$id/$action"))
                    .putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, id)
                    .putExtra("tap", action)
            return PendingIntent.getBroadcast(
                context,
                0,
                intent,
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
            )
        }

        @JvmStatic
        @Synchronized
        fun select(context: Context, id: Int, action: String?) {
            if (action == null) return
            runCatching {
                val prefs = state(context)
                var selected = prefs.getString(key(id), "") ?: ""
                if (action == "photo") {
                    prefs
                        .edit()
                        .putInt(
                            "photo-$id",
                            (prefs.getInt("photo-$id", 0) + 1) %
                                max(1, photos(album(context), selected).size),
                        )
                        .apply()
                    return
                }
                selected =
                    when (action) {
                        "world" -> ""
                        "next" -> {
                            val all = countries(context)
                            val data = album(context)
                            val available = all.filter { photos(data, it.id).isNotEmpty() }
                            val cached = available.filter { country ->
                                photos(data, country.id).any { photoExists(context, it) }
                            }
                            val choices = cached.ifEmpty { available }.ifEmpty { all }
                            choices[(choices.indexOfFirst { it.id == selected } + 1) % choices.size]
                                .id
                        }
                        else -> {
                            if (countries(context).none { it.id == action }) return
                            action
                        }
                    }
                prefs.edit().putString(key(id), selected).putInt("photo-$id", 0).apply()
            }
        }

        @JvmStatic
        @Synchronized
        fun refresh(context: Context) {
            for (id in
                AppWidgetManager.getInstance(context)
                    .getAppWidgetIds(ComponentName(context, MapWidgetProvider::class.java))) update(
                context,
                id,
            )
        }

        @JvmStatic
        @Synchronized
        fun clear(context: Context) {
            state(context).edit().clear().commit()
            refresh(context)
        }

        @JvmStatic
        @Synchronized
        fun update(context: Context, id: Int) {
            try {
                AppWidgetManager.getInstance(context).updateAppWidget(id, responsive(context, id))
            } catch (error: Exception) {
                android.util.Log.e("WorldwideWidget", "Could not draw map", error)
                val fallback = RemoteViews(context.packageName, R.layout.map_widget_static)
                fallback.setTextViewText(R.id.widget_title, "Earth")
                fallback.setOnClickPendingIntent(R.id.widget_next, tap(context, id, "next"))
                AppWidgetManager.getInstance(context).updateAppWidget(id, fallback)
            }
        }

        @JvmStatic
        fun motionEnabled(context: Context) = runCatching {
            Settings.Global.getFloat(
                context.contentResolver,
                Settings.Global.ANIMATOR_DURATION_SCALE,
                1f,
            ) > 0 &&
                Settings.Global.getFloat(
                    context.contentResolver,
                    Settings.Global.TRANSITION_ANIMATION_SCALE,
                    1f,
                ) > 0
        }
            .getOrDefault(false)

        private fun lightInk(context: Context): Boolean {
            if (Build.VERSION.SDK_INT >= 31)
                runCatching {
                    WallpaperManager.getInstance(context)
                        .getWallpaperColors(WallpaperManager.FLAG_SYSTEM)
                        ?.let {
                            return it.colorHints and WallpaperColors.HINT_SUPPORTS_DARK_TEXT == 0
                        }
                }
            return true
        }

        private fun responsive(context: Context, id: Int): RemoteViews {
            val options = AppWidgetManager.getInstance(context).getAppWidgetOptions(id)
            if (Build.VERSION.SDK_INT >= 31) {
                @Suppress("DEPRECATION")
                val sizes =
                    options.getParcelableArrayList<SizeF>(AppWidgetManager.OPTION_APPWIDGET_SIZES)
                val layouts = LinkedHashMap<SizeF, RemoteViews>()
                for (size in sizes.orEmpty()) {
                    if (layouts.size == 4) break
                    if (size.width > 0 && size.height > 0)
                        layouts[size] =
                            renderForSize(
                                context,
                                id,
                                size.width.roundToInt(),
                                size.height.roundToInt(),
                            )
                }
                if (layouts.isNotEmpty()) return RemoteViews(layouts)
            }
            val minWidth = options.getInt(AppWidgetManager.OPTION_APPWIDGET_MIN_WIDTH, 320)
            val maxHeight = options.getInt(AppWidgetManager.OPTION_APPWIDGET_MAX_HEIGHT, 300)
            val maxWidth = options.getInt(AppWidgetManager.OPTION_APPWIDGET_MAX_WIDTH, minWidth)
            val minHeight = options.getInt(AppWidgetManager.OPTION_APPWIDGET_MIN_HEIGHT, maxHeight)
            val portrait = renderForSize(context, id, minWidth, maxHeight)
            return if (minWidth == maxWidth && minHeight == maxHeight) portrait
            else RemoteViews(renderForSize(context, id, maxWidth, minHeight), portrait)
        }

        @JvmStatic
        @Synchronized
        fun render(context: Context, id: Int): RemoteViews {
            val options = AppWidgetManager.getInstance(context).getAppWidgetOptions(id)
            return renderForSize(
                context,
                id,
                options.getInt(AppWidgetManager.OPTION_APPWIDGET_MIN_WIDTH, 320),
                options.getInt(AppWidgetManager.OPTION_APPWIDGET_MAX_HEIGHT, 300),
            )
        }

        @JvmStatic
        @Synchronized
        fun renderForSize(context: Context, id: Int, widthDp: Int, heightDp: Int): RemoteViews =
            renderForSize(context, id, widthDp, heightDp, lightInk(context))

        @JvmStatic
        @Synchronized
        fun renderForSize(
            context: Context,
            id: Int,
            widthDp: Int,
            heightDp: Int,
            lightInk: Boolean,
        ): RemoteViews {
            val w = widthDp.coerceIn(140, 1000)
            val h = heightDp.coerceIn(140, 1000)
            val all = countries(context)
            val data = album(context)
            val selected = state(context).getString(key(id), "") ?: ""
            val focus = all.find { it.id == selected }
            val images = photos(data, selected)
            var index = Math.floorMod(state(context).getInt("photo-$id", 0), max(1, images.size))
            var picture = images.getOrNull(index)?.let { photo(context, it) }
            if (picture == null)
                for (offset in 1 until images.size) {
                    val candidate = (index + offset) % images.size
                    val cached = photo(context, images[candidate])
                    if (cached != null) {
                        index = candidate
                        picture = cached
                        state(context).edit().putInt("photo-$id", index).apply()
                        break
                    }
                }
            val saved = objects(data, "photos").map { it.optString("countryId") }.toSet()
            val visited =
                objects(data, "visits")
                    .filter { it.optInt("visited") == 1 || it.optBoolean("visited") }
                    .map { it.optString("countryId") }
                    .toSet()
            val compact = h < 250 || w < 250
            val title = focus?.name ?: "Earth"
            val titleSp = if (compact) 22f else 26f
            val density = context.resources.displayMetrics.density
            val text =
                TextPaint(Paint.ANTI_ALIAS_FLAG).apply {
                    typeface = Typeface.create("sans-serif-medium", Typeface.NORMAL)
                    textSize = titleSp * density * context.resources.configuration.fontScale
                    letterSpacing = -.02f
                }
            val lines =
                StaticLayout.Builder.obtain(
                        title,
                        0,
                        title.length,
                        text,
                        max(1, ((w - 80) * density).roundToInt()),
                    )
                    .setIncludePad(false)
                    .setEllipsize(TextUtils.TruncateAt.END)
                    .setMaxLines(if (compact) 1 else 2)
                    .setAlignment(Layout.Alignment.ALIGN_NORMAL)
                    .build()
            val bodyWidth = max(1f, w - 24f)
            val bodyHeight =
                max(
                    1f,
                    h -
                        24f -
                        (if (compact && Build.VERSION.SDK_INT >= 31) 16 else 24) -
                        max(48f, lines.height / density),
                )
            var scale = min(2f, min(600 / bodyWidth, 480 / bodyHeight))
            val screen = context.resources.displayMetrics
            scale =
                min(
                    scale,
                    sqrt(
                            screen.widthPixels.toDouble() * screen.heightPixels * .16 /
                                (bodyWidth * bodyHeight)
                        )
                        .toFloat(),
                )
            val width = max(1, (bodyWidth * scale).roundToInt())
            val height = max(1, (bodyHeight * scale).roundToInt())
            val map = WidgetArtwork.world(all, saved, visited, width, height, lightInk)
            if (focus == null)
                for (country in all) for (item in photos(data, country.id)) {
                    val cover = photo(context, item) ?: continue
                    WidgetArtwork.addCover(map, country, cover, item)
                    cover.recycle()
                    break
                }
            val view =
                RemoteViews(
                    context.packageName,
                    if (motionEnabled(context)) R.layout.map_widget else R.layout.map_widget_static,
                )
            view.setInt(R.id.widget_header, "setMinimumHeight", (48 * density).roundToInt())
            if (Build.VERSION.SDK_INT >= 31 && compact) {
                view.setViewLayoutMargin(
                    R.id.widget_stage,
                    RemoteViews.MARGIN_TOP,
                    8f,
                    TypedValue.COMPLEX_UNIT_DIP,
                )
                view.setViewLayoutMargin(
                    R.id.widget_stage,
                    RemoteViews.MARGIN_BOTTOM,
                    8f,
                    TypedValue.COMPLEX_UNIT_DIP,
                )
            }
            if (!lightInk)
                view.setImageViewResource(R.id.widget_next, R.drawable.widget_chevron_right_dark)
            view.setInt(R.id.widget_title, "setMaxWidth", ((w - 72) * density).roundToInt())
            view.setTextViewText(R.id.widget_title, title)
            view.setInt(R.id.widget_title, "setMaxLines", if (compact) 1 else 2)
            view.setTextViewTextSize(R.id.widget_title, TypedValue.COMPLEX_UNIT_SP, titleSp)
            view.setTextColor(
                R.id.widget_title,
                if (lightInk) 0xfff4f7f5.toInt() else 0xff1e352b.toInt(),
            )
            view.setTextColor(
                R.id.widget_empty_text,
                if (lightInk) 0xffd2ded7.toInt() else 0xff405a4c.toInt(),
            )
            view.setOnClickPendingIntent(R.id.widget_title, tap(context, id, "world"))
            view.setContentDescription(
                R.id.widget_title,
                if (focus == null) "Earth" else "$title. Back to Earth",
            )
            view.setImageViewBitmap(R.id.widget_map, map.bitmap)
            view.setOnClickPendingIntent(R.id.widget_next, tap(context, id, "next"))
            view.setContentDescription(
                R.id.widget_next,
                if (saved.isEmpty()) "Explore next country" else "Next country with photos",
            )
            view.setOnClickPendingIntent(R.id.widget_photo, tap(context, id, "photo"))
            view.setContentDescription(
                R.id.widget_photo,
                "$title, photo ${index + 1} of ${images.size}" +
                    if (images.size > 1) ". Tap for next photo" else "",
            )
            view.setViewVisibility(
                R.id.widget_photo,
                if (picture == null) View.GONE else View.VISIBLE,
            )
            view.setViewVisibility(
                R.id.widget_photo_scrim,
                if (picture == null) View.GONE else View.VISIBLE,
            )
            view.setViewVisibility(
                R.id.widget_country_inset,
                if (picture == null || bodyHeight < 64) View.GONE else View.VISIBLE,
            )
            view.setViewVisibility(
                R.id.widget_empty_map,
                if (focus != null && picture == null) View.VISIBLE else View.GONE,
            )
            view.setViewVisibility(R.id.widget_empty_text, View.GONE)
            view.setImageViewBitmap(
                R.id.widget_photo,
                picture?.let {
                    WidgetArtwork.photograph(it, images[index], width, height, 24 * scale)
                },
            )
            view.setImageViewBitmap(
                R.id.widget_country_map,
                focus?.let { WidgetArtwork.country(it, 144, 144, true) },
            )
            view.setViewPadding(R.id.widget_empty_map, 0, 0, 0, 0)
            view.setImageViewBitmap(
                R.id.widget_empty_map,
                if (focus == null || picture != null) null
                else WidgetArtwork.country(focus, width, height, lightInk),
            )
            view.setTextViewText(
                R.id.widget_empty_text,
                if (images.isEmpty()) "No photos yet" else "Open Worldwide to save photos",
            )
            view.setContentDescription(
                R.id.widget_country_map,
                focus?.let { "${it.name} fitted to view" } ?: "",
            )
            view.setContentDescription(
                R.id.widget_country_inset,
                focus?.let { "${it.name} map" } ?: "",
            )
            if (Build.VERSION.SDK_INT >= 31) {
                val inset = if (compact) 48f else 72f
                view.setViewLayoutWidth(
                    R.id.widget_country_inset,
                    inset,
                    TypedValue.COMPLEX_UNIT_DIP,
                )
                view.setViewLayoutHeight(
                    R.id.widget_country_inset,
                    inset,
                    TypedValue.COMPLEX_UNIT_DIP,
                )
            }
            view.removeAllViews(R.id.widget_grid)
            for (row in 0 until ROWS) {
                val line = RemoteViews(context.packageName, R.layout.map_widget_row)
                for (col in 0 until COLS) {
                    val cell = RemoteViews(context.packageName, R.layout.map_widget_cell)
                    val target = hit(map.regions, width, height, col, row)
                    if (target >= 0) {
                        val country = all[target]
                        cell.setContentDescription(R.id.widget_cell, country.name)
                        cell.setOnClickPendingIntent(R.id.widget_cell, tap(context, id, country.id))
                    }
                    line.addView(R.id.widget_row, cell)
                }
                view.addView(R.id.widget_grid, line)
            }
            view.setDisplayedChild(R.id.widget_stage, if (focus == null) 0 else 1)
            picture?.recycle()
            return view
        }

        private fun objects(value: JSONObject, key: String): List<JSONObject> =
            value.optJSONArray(key)?.let { list ->
                (0 until list.length()).mapNotNull { list.optJSONObject(it) }
            } ?: emptyList()

        @JvmStatic
        fun hit(regions: List<Region>, width: Int, height: Int, col: Int, row: Int): Int {
            for ((x, y) in
                listOf(.5f to .5f, .25f to .25f, .75f to .25f, .25f to .75f, .75f to .75f)) {
                val px = ((col + x) * width / COLS).toInt()
                val py = ((row + y) * height / ROWS).toInt()
                for (i in regions.indices.reversed()) if (regions[i].contains(px, py)) return i
            }
            return -1
        }
    }
}
