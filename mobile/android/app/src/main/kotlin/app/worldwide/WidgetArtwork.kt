package app.worldwide

import android.graphics.*
import java.util.Collections
import java.util.WeakHashMap
import kotlin.math.*
import org.json.JSONObject

/** Transparent, bounded artwork for RemoteViews. Original geography stays unchanged. */
object WidgetArtwork {
    private val worldBounds = RectF(0f, 0f, 1200f, 580f)
    private val markers =
        Collections.synchronizedMap(WeakHashMap<MapWidgetProvider.Country, PointF>())
    private val drawings =
        Collections.synchronizedMap(WeakHashMap<MapWidgetProvider.Country, RectF>())

    class MapImage(@JvmField val bitmap: Bitmap, @JvmField val regions: List<Region>)

    @JvmStatic
    fun world(
        all: List<MapWidgetProvider.Country>,
        saved: Set<String>?,
        visited: Set<String>?,
        width: Int,
        height: Int,
        lightInk: Boolean,
    ): MapImage {
        val w = size(width)
        val h = size(height)
        val bitmap = Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888)
        val canvas = Canvas(bitmap)
        val matrix = fit(worldBounds, w, h, 8f)
        val paint = Paint(Paint.ANTI_ALIAS_FLAG)
        val clip = Region(0, 0, w, h)
        val regions = ArrayList<Region>(all.size)
        for (country in all) {
            val path = Path()
            country.path.transform(matrix, path)
            regions.add(Region().apply { setPath(path, clip) })
            paint.style = Paint.Style.FILL
            paint.color =
                when {
                    saved?.contains(country.id) == true ->
                        if (lightInk) 0xff4f8b6a.toInt() else 0xff497e60.toInt()
                    visited?.contains(country.id) == true ->
                        if (lightInk) 0xffa7bcac.toInt() else 0xff9db5a4.toInt()
                    else -> if (lightInk) 0xe8e5ecea.toInt() else 0xe8dce5e2.toInt()
                }
            canvas.drawPath(path, paint)
            paint.style = Paint.Style.STROKE
            paint.strokeJoin = Paint.Join.ROUND
            paint.strokeWidth = max(.55f, min(w, h) / 520f)
            paint.color = if (lightInk) 0x88798e85.toInt() else 0x9965786f.toInt()
            canvas.drawPath(path, paint)
        }
        paint.style = Paint.Style.FILL
        for (country in all) {
            if (saved?.contains(country.id) != true) continue
            val anchor = marker(country) ?: continue
            val point = floatArrayOf(anchor.x, anchor.y)
            matrix.mapPoints(point)
            val radius = max(2f, min(3f, w / 200f))
            paint.color = 0x55405849
            canvas.drawCircle(point[0], point[1] + .4f, radius + .8f, paint)
            paint.color = 0xfff5faf6.toInt()
            canvas.drawCircle(point[0], point[1], radius, paint)
            paint.color = 0xff446d55.toInt()
            canvas.drawCircle(point[0], point[1], radius * .43f, paint)
        }
        return MapImage(bitmap, regions)
    }

    @JvmStatic
    fun addCover(
        map: MapImage,
        country: MapWidgetProvider.Country,
        source: Bitmap,
        photo: JSONObject,
    ) {
        val path = Path()
        country.path.transform(fit(worldBounds, map.bitmap.width, map.bitmap.height, 8f), path)
        val bounds = RectF()
        path.computeBounds(bounds, true)
        if (bounds.width() < 1 || bounds.height() < 1) return
        val cropped =
            photograph(
                source,
                photo,
                max(1, bounds.width().roundToInt()),
                max(1, bounds.height().roundToInt()),
                0f,
            )
        val canvas = Canvas(map.bitmap)
        canvas.save()
        canvas.clipPath(path)
        canvas.drawBitmap(
            cropped,
            null,
            bounds,
            Paint(Paint.ANTI_ALIAS_FLAG or Paint.FILTER_BITMAP_FLAG),
        )
        canvas.restore()
        cropped.recycle()
        canvas.drawPath(
            path,
            Paint(Paint.ANTI_ALIAS_FLAG).apply {
                style = Paint.Style.STROKE
                color = 0xcce8f1e9.toInt()
                strokeWidth = .75f
            },
        )
    }

    @JvmStatic
    fun country(
        country: MapWidgetProvider.Country?,
        width: Int,
        height: Int,
        lightInk: Boolean,
    ): Bitmap {
        val w = size(width)
        val h = size(height)
        val bitmap = Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888)
        if (country == null) return bitmap
        val path = Path()
        country.path.transform(fit(countryBounds(country), w, h, max(7f, min(w, h) * .09f)), path)
        val canvas = Canvas(bitmap)
        val paint =
            Paint(Paint.ANTI_ALIAS_FLAG).apply {
                color = if (lightInk) 0xff9db9a5.toInt() else 0xff7d9f87.toInt()
                setShadowLayer(2.5f, 0f, 1.5f, 0x19304537)
            }
        canvas.drawPath(path, paint)
        paint.clearShadowLayer()
        paint.style = Paint.Style.STROKE
        paint.strokeJoin = Paint.Join.ROUND
        paint.strokeWidth = .85f
        paint.color = if (lightInk) 0xcce8f1e9.toInt() else 0xbbe0ede2.toInt()
        canvas.drawPath(path, paint)
        return bitmap
    }

    private fun countryBounds(country: MapWidgetProvider.Country): RectF {
        drawings[country]?.let {
            return it
        }
        val measure = PathMeasure(country.path, true)
        val contours = ArrayList<RectF>()
        var largest: RectF? = null
        var largestArea = 0f
        do {
            val length = measure.length
            if (length <= 0) continue
            val path = Path()
            if (!measure.getSegment(0f, length, path, true)) continue
            path.close()
            val bounds = RectF()
            path.computeBounds(bounds, true)
            contours.add(bounds)
            val area = bounds.width() * bounds.height()
            if (area > largestArea) {
                largestArea = area
                largest = bounds
            }
        } while (measure.nextContour())
        val focus =
            if (
                largest != null &&
                    largestArea < country.bounds.width() * country.bounds.height() * .12f
            ) {
                val neighbour =
                    RectF(largest).apply { inset(-largest.width() * .5f, -largest.height() * .5f) }
                RectF(largest).apply {
                    for (contour in contours) if (
                        neighbour.contains(contour.centerX(), contour.centerY())
                    )
                        union(contour)
                }
            } else country.bounds
        drawings[country] = focus
        return focus
    }

    /** Positive crop coordinates move the image right/down, matching the app. */
    @JvmStatic
    fun photograph(
        source: Bitmap?,
        photo: JSONObject?,
        width: Int,
        height: Int,
        radius: Float,
    ): Bitmap {
        val w = size(width)
        val h = size(height)
        val bitmap = Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888)
        if (source == null || source.isRecycled) return bitmap
        val scale =
            max(w.toFloat() / source.width, h.toFloat() / source.height) *
                number(photo, "cropZoom", 1f, 1f, 5f)
        val x = (source.width * scale - w) / 2
        val y = (source.height * scale - h) / 2
        val matrix =
            Matrix().apply {
                setScale(scale, scale)
                postTranslate(
                    -x + number(photo, "cropX", 0f, -1f, 1f) * x,
                    -y + number(photo, "cropY", 0f, -1f, 1f) * y,
                )
            }
        val paint =
            Paint(Paint.ANTI_ALIAS_FLAG or Paint.FILTER_BITMAP_FLAG).apply {
                shader =
                    BitmapShader(source, Shader.TileMode.CLAMP, Shader.TileMode.CLAMP).apply {
                        setLocalMatrix(matrix)
                    }
            }
        val corner = if (radius.isNaN()) 0f else radius.coerceIn(0f, min(w, h) / 2f)
        Canvas(bitmap).drawRoundRect(RectF(0f, 0f, w.toFloat(), h.toFloat()), corner, corner, paint)
        return bitmap
    }

    private fun size(value: Int) = value.coerceIn(1, 640)

    private fun number(
        photo: JSONObject?,
        key: String,
        fallback: Float,
        minimum: Float,
        maximum: Float,
    ): Float {
        val value = photo?.optDouble(key, fallback.toDouble()) ?: fallback.toDouble()
        return if (value.isFinite()) value.toFloat().coerceIn(minimum, maximum) else fallback
    }

    private fun fit(bounds: RectF, width: Int, height: Int, padding: Float): Matrix {
        val inset = min(padding, max(0f, (min(width, height) - 1) / 2f))
        val scale =
            min(
                (width - inset * 2) / max(.01f, bounds.width()),
                (height - inset * 2) / max(.01f, bounds.height()),
            )
        return Matrix().apply {
            setScale(scale, scale)
            postTranslate(
                width / 2f - bounds.centerX() * scale,
                height / 2f - bounds.centerY() * scale,
            )
        }
    }

    private fun marker(country: MapWidgetProvider.Country): PointF? {
        markers[country]?.let {
            return it
        }
        val path = Path()
        country.path.transform(Matrix().apply { setScale(4f, 4f) }, path)
        val region = Region().apply { setPath(path, Region(0, 0, 4800, 2320)) }
        val iterator = RegionIterator(region)
        val rect = Rect()
        val best = Rect()
        var score = -1f
        while (iterator.next(rect)) {
            val next = rect.width() * max(1, rect.height()).toFloat()
            if (next > score) {
                score = next
                best.set(rect)
            }
        }
        if (score < 0) return null
        return PointF(best.exactCenterX() / 4f, best.exactCenterY() / 4f).also {
            markers[country] = it
        }
    }
}
