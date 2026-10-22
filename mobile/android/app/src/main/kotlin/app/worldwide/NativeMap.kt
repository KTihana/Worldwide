package app.worldwide

import android.animation.ValueAnimator
import android.content.Context
import android.graphics.*
import android.view.*
import androidx.core.graphics.PathParser
import java.util.concurrent.Executors
import kotlin.math.*
import org.json.JSONObject

data class Country(val id: String, val name: String, val continent: String)

data class MapShape(
    val country: Country,
    val path: Path,
    val outline: Path,
    val bounds: RectF,
    val focus: RectF,
)

data class MapScene(
    val scope: String,
    val style: String,
    val shapes: List<MapShape>,
    val terrain: Bitmap,
    val grid: Path?,
    val land: Path,
) {
    // Paint the terrain directly into vector paths, avoiding a giant per-frame clip mask.
    val terrainShader =
        BitmapShader(terrain, Shader.TileMode.CLAMP, Shader.TileMode.CLAMP).apply {
            setLocalMatrix(
                Matrix().apply { setScale(1200f / terrain.width, 590f / terrain.height) }
            )
        }
}

class MapAssets(private val context: Context) {
    val countries =
        AlbumRepository.jsonArray(text("map/countries.json")).map {
            Country(it.getString("id"), it.getString("name"), it.getString("continent"))
        }
    val styles =
        AlbumRepository.jsonArray(text("map/map-styles.json")).map {
            it.getString("id") to it.getString("name")
        }
    private val catalogue = countries.associateBy { it.id }
    private val cache = android.util.LruCache<String, MapScene>(4)

    private fun text(path: String) =
        context.assets.open(path).bufferedReader().use { it.readText() }

    private fun bounds(json: JSONObject, key: String): RectF {
        val v = json.optJSONArray(key) ?: json.getJSONArray("bounds")
        return RectF(
            v.getDouble(0).toFloat(),
            v.getDouble(1).toFloat(),
            v.getDouble(2).toFloat(),
            v.getDouble(3).toFloat(),
        )
    }

    @Synchronized
    fun load(scope: String, style: String): MapScene {
        val key = "$scope:$style"
        cache.get(key)?.let {
            return it
        }
        val selected = catalogue.containsKey(scope)
        val source =
            when {
                selected -> JSONObject().put(scope, JSONObject(text("map/geography/$scope.json")))
                scope == "World" -> JSONObject(text("map/projections/$style.json"))
                else ->
                    JSONObject(text("map/geography/regions/${scope.replace(' ', '-')}.json"))
                        .getJSONObject("shapes")
            }
        val shapes =
            source
                .keys()
                .asSequence()
                .mapNotNull { id ->
                    catalogue[id]?.let { country ->
                        val value = source.getJSONObject(id)
                        MapShape(
                            country,
                            PathParser.createPathFromPathData(value.getString("path"))!!,
                            PathParser.createPathFromPathData(
                                value.optString("outline", value.getString("path"))
                            )!!,
                            bounds(value, "bounds"),
                            bounds(value, "focusBounds"),
                        )
                    }
                }
                .toList()
        val name =
            when {
                selected -> "country-$scope"
                scope == "World" -> "world-$style"
                else -> "region-${scope.replace(' ', '-')}"
            }
        val terrain =
            context.assets.open("map/terrain/$name.webp").use { BitmapFactory.decodeStream(it) }
                ?: error("Map colors could not be loaded")
        val grid =
            if (scope == "World")
                PathParser.createPathFromPathData(
                    JSONObject(text("map/graticules.json")).getString(style)
                )
            else null
        val land = Path()
        shapes.filter { it.country.id != "ATA" }.forEach { land.addPath(it.path) }
        return MapScene(scope, style, shapes, terrain, grid, land).also { cache.put(key, it) }
    }
}

/** Sized decodes run off the UI thread. Drawing never reads files or reparses SVG. */
class PhotoCache(private val repo: AlbumRepository) : AutoCloseable {
    private val worker = Executors.newFixedThreadPool(2)
    private val loading = java.util.concurrent.ConcurrentHashMap.newKeySet<String>()
    private val waiters =
        java.util.concurrent.ConcurrentHashMap<
            String,
            java.util.concurrent.CopyOnWriteArrayList<() -> Unit>,
        >()
    private val failed = java.util.concurrent.ConcurrentHashMap.newKeySet<String>()
    private val cache =
        object : android.util.LruCache<String, Bitmap>(32 * 1024 * 1024) {
            override fun sizeOf(key: String, value: Bitmap) = value.allocationByteCount
        }
    @Volatile private var closed = false

    fun get(id: String, pixels: Int, changed: () -> Unit): Bitmap? {
        val size =
            when {
                pixels <= 96 -> 96
                pixels <= 256 -> 256
                pixels <= 512 -> 512
                pixels <= 1024 -> 1024
                else -> 2048
            }
        val key = "$id:$size"
        cache.get(key)?.let {
            return it
        }
        if (!closed && !failed.contains(key)) {
            waiters
                .computeIfAbsent(key) { java.util.concurrent.CopyOnWriteArrayList() }
                .add(changed)
            if (loading.add(key))
                worker.execute {
                    try {
                        val file = repo.originalFile(id)
                        if (file.isFile) {
                            val opts = BitmapFactory.Options().apply { inJustDecodeBounds = true }
                            BitmapFactory.decodeFile(file.path, opts)
                            opts.inSampleSize = 1
                            while (
                                max(opts.outWidth, opts.outHeight) / opts.inSampleSize > size
                            ) opts.inSampleSize *= 2
                            opts.inJustDecodeBounds = false
                            opts.inPreferredConfig = Bitmap.Config.ARGB_8888
                            BitmapFactory.decodeFile(file.path, opts)?.let { decoded ->
                                var bitmap = decoded
                                if (file.name.endsWith(".original"))
                                    try {
                                        val exif = android.media.ExifInterface(file.path)
                                        val m = Matrix()
                                        when (
                                            exif.getAttributeInt(
                                                android.media.ExifInterface.TAG_ORIENTATION,
                                                1,
                                            )
                                        ) {
                                            2 -> m.setScale(-1f, 1f)
                                            3 -> m.setRotate(180f)
                                            4 -> m.setScale(1f, -1f)
                                            5 -> {
                                                m.setRotate(90f)
                                                m.postScale(-1f, 1f)
                                            }
                                            6 -> m.setRotate(90f)
                                            7 -> {
                                                m.setRotate(270f)
                                                m.postScale(-1f, 1f)
                                            }
                                            8 -> m.setRotate(270f)
                                        }
                                        if (!m.isIdentity) {
                                            bitmap =
                                                Bitmap.createBitmap(
                                                    decoded,
                                                    0,
                                                    0,
                                                    decoded.width,
                                                    decoded.height,
                                                    m,
                                                    true,
                                                )
                                            if (bitmap !== decoded) decoded.recycle()
                                        }
                                    } catch (_: Exception) {}
                                if (!closed) cache.put(key, bitmap)
                            }
                        }
                        if (cache.get(key) == null) failed.add(key)
                    } catch (_: Exception) {
                        failed.add(key)
                    } finally {
                        loading.remove(key)
                        val ready = waiters.remove(key).orEmpty()
                        if (!closed)
                            android.os.Handler(android.os.Looper.getMainLooper()).post {
                                if (!closed) ready.forEach { it() }
                            }
                    }
                }
        }
        for (fallback in listOf(512, 256, 96, 1024, 2048)) cache.get("$id:$fallback")?.let {
            return it
        }
        return null
    }

    fun retryMissing() {
        failed.clear()
    }

    fun clear(id: String) {
        for (size in listOf(96, 256, 512, 1024, 2048)) cache.remove("$id:$size")
    }

    override fun close() {
        closed = true
        worker.shutdownNow()
        waiters.clear()
        cache.evictAll()
    }
}

object PhotoFraming {
    fun placement(bounds: RectF, bitmap: Bitmap, photo: JSONObject): RectF {
        val aspect = bitmap.width.toFloat() / bitmap.height
        val zoom = photo.optDouble("cropZoom", 1.0).toFloat().coerceIn(1f, 5f)
        val w = max(bounds.width(), bounds.height() * aspect) * zoom
        val h = w / aspect
        val x =
            bounds.left +
                (bounds.width() - w) / 2 +
                photo.optDouble("cropX", 0.0).toFloat().coerceIn(-1f, 1f) * (w - bounds.width()) / 2
        val y =
            bounds.top +
                (bounds.height() - h) / 2 +
                photo.optDouble("cropY", 0.0).toFloat().coerceIn(-1f, 1f) * (h - bounds.height()) /
                    2
        return RectF(x, y, x + w, y + h)
    }
}

class NativeMapView(context: Context, private val photos: PhotoCache) : View(context) {
    var onCountry: ((String) -> Unit)? = null
    var scene: MapScene? = null
        private set

    private var visits = emptyMap<String, JSONObject>()
    private var coverPhotos = emptyMap<String, JSONObject>()
    var filter = "all"
        set(value) {
            field = value
            invalidate()
        }

    private val paint = Paint(Paint.ANTI_ALIAS_FLAG or Paint.FILTER_BITMAP_FLAG)
    private val transform = Matrix()
    private val inverse = Matrix()
    private val viewBox = RectF()
    private val visible = RectF()
    private val tempRect = RectF()
    private val mutedTerrain =
        ColorMatrixColorFilter(
            ColorMatrix().apply {
                setSaturation(.74f)
                postConcat(
                    ColorMatrix(
                        floatArrayOf(
                            1.025f,
                            0f,
                            0f,
                            0f,
                            0f,
                            0f,
                            1.025f,
                            0f,
                            0f,
                            0f,
                            0f,
                            0f,
                            1.025f,
                            0f,
                            0f,
                            0f,
                            0f,
                            0f,
                            1f,
                            0f,
                        )
                    )
                )
            }
        )
    private var water: Shader? = null
    private val points = FloatArray(2)
    private var zoom = 1f
    private var offsetX = 0f
    private var offsetY = 0f
    private var base = 1f
    private var baseX = 0f
    private var baseY = 0f
    private var downX = 0f
    private var downY = 0f
    private var lastX = 0f
    private var lastY = 0f
    private var moved = false
    private var animation: ValueAnimator? = null
    var inspectorWidth = 0f
    var topClearance = 76f
    private val density = resources.displayMetrics.density
    private val scaleDetector =
        ScaleGestureDetector(
            context,
            object : ScaleGestureDetector.SimpleOnScaleGestureListener() {
                override fun onScale(detector: ScaleGestureDetector): Boolean {
                    animation?.cancel()
                    changeZoom(detector.scaleFactor, detector.focusX, detector.focusY)
                    moved = true
                    return true
                }
            },
        )
    private val gestures =
        GestureDetector(
            context,
            object : GestureDetector.SimpleOnGestureListener() {
                override fun onDown(e: android.view.MotionEvent) = true

                override fun onSingleTapConfirmed(e: MotionEvent): Boolean {
                    performClick()
                    hit(e.x, e.y)
                    return true
                }

                override fun onDoubleTap(e: android.view.MotionEvent): Boolean {
                    changeZoom(1.8f, e.x, e.y)
                    return true
                }
            },
        )

    init {
        contentDescription = "World map. Pinch to zoom, drag to pan, or choose a country."
        isClickable = true
        importantForAccessibility = IMPORTANT_FOR_ACCESSIBILITY_YES
        setLayerType(LAYER_TYPE_HARDWARE, null)
    }

    fun setScene(value: MapScene) {
        animation?.cancel()
        scene = value
        fit(false)
        invalidate()
    }

    fun album(value: JSONObject) {
        visits =
            AlbumRepository.jsonObjects(value.getJSONArray("visits")).associateBy {
                it.getString("countryId")
            }
        coverPhotos =
            AlbumRepository.jsonObjects(value.getJSONArray("photos")).associateBy {
                it.getString("id")
            }
        invalidate()
    }

    override fun onSizeChanged(w: Int, h: Int, oldw: Int, oldh: Int) {
        super.onSizeChanged(w, h, oldw, oldh)
        if (w == 0 || h == 0) return
        water =
            RadialGradient(
                w * .52f,
                h * .42f,
                max(w, h) * .75f,
                intArrayOf(
                    Color.rgb(245, 249, 249),
                    Color.rgb(234, 241, 242),
                    Color.rgb(220, 231, 235),
                ),
                floatArrayOf(0f, .52f, 1f),
                Shader.TileMode.CLAMP,
            )
        val unitHeight = if (h.toFloat() / w > .9f) 680f else max(640f, 1200f * h / w)
        base = h / unitHeight
        baseX = (w - 1200f * base) / 2
        baseY = (h - 590f * base) / 2
        fit(false)
    }

    fun fit(animate: Boolean = true) {
        val value = scene ?: return
        if (width == 0 || height == 0) return
        if (value.scope == "World") {
            val k = min(1f, min(width / (1200f * base), height / (590f * base)))
            camera(k, 600f * (1 - k), 295f * (1 - k), animate)
            return
        }
        val bounds = RectF(value.shapes.first().focus)
        if (value.shapes.size > 1) value.shapes.drop(1).forEach { bounds.union(it.focus) }
        val left = 24 * density
        val right = width - max(24 * density, inspectorWidth)
        val top = topClearance * density
        val bottom = height - 76 * density
        val k =
            (min(
                    (right - left) / base / max(1f, bounds.width()),
                    max(48 * density, bottom - top) / base / max(1f, bounds.height()),
                ) * .9f)
                .coerceIn(.15f, 14f)
        camera(
            k,
            ((left + right) / 2 - baseX) / base - bounds.centerX() * k,
            ((top + bottom) / 2 - baseY) / base - bounds.centerY() * k,
            animate,
        )
    }

    fun zoomBy(factor: Float) = changeZoom(factor, width / 2f, height / 2f)

    private fun changeZoom(factor: Float, x: Float, y: Float) {
        val k =
            (zoom * factor).coerceIn(
                if (scene?.scope == "World") min(1f, width / (1200f * base)) else .15f,
                14f,
            )
        val ux = (x - baseX) / base
        val uy = (y - baseY) / base
        offsetX = ux + (offsetX - ux) * k / zoom
        offsetY = uy + (offsetY - uy) * k / zoom
        zoom = k
        clamp()
        invalidate()
    }

    private fun clamp() {
        if (scene?.scope != "World") return
        fun axis(value: Float, start: Float, length: Float, size: Float): Float =
            if (size * zoom <= length) start + (length - size * zoom) / 2
            else value.coerceIn(start + length - size * zoom - 16, start + 16)
        offsetX = axis(offsetX, -baseX / base, width / base, 1200f)
        offsetY = axis(offsetY, -baseY / base, height / base, 590f)
    }

    private fun camera(k: Float, x: Float, y: Float, animate: Boolean) {
        animation?.cancel()
        if (!animate) {
            zoom = k
            offsetX = x
            offsetY = y
            invalidate()
            return
        }
        val oldK = zoom
        val oldX = offsetX
        val oldY = offsetY
        animation =
            ValueAnimator.ofFloat(0f, 1f).apply {
                duration = 220
                addUpdateListener {
                    val v = it.animatedValue as Float
                    zoom = oldK + (k - oldK) * v
                    offsetX = oldX + (x - oldX) * v
                    offsetY = oldY + (y - oldY) * v
                    invalidate()
                }
                start()
            }
    }

    private fun matrix() {
        transform.reset()
        transform.setValues(
            floatArrayOf(
                base * zoom,
                0f,
                baseX + base * offsetX,
                0f,
                base * zoom,
                baseY + base * offsetY,
                0f,
                0f,
                1f,
            )
        )
        transform.invert(inverse)
        viewBox.set(0f, 0f, width.toFloat(), height.toFloat())
        inverse.mapRect(visible, viewBox)
    }

    override fun onDraw(canvas: Canvas) {
        super.onDraw(canvas)
        paint.reset()
        paint.isAntiAlias = true
        paint.isFilterBitmap = true
        paint.shader = water
        canvas.drawRect(0f, 0f, width.toFloat(), height.toFloat(), paint)
        paint.shader = null
        val value = scene ?: return
        matrix()
        canvas.save()
        canvas.concat(transform)
        paint.style = Paint.Style.STROKE
        paint.strokeWidth = .5f
        paint.color = Color.argb(92, 155, 179, 186)
        value.grid?.let { canvas.drawPath(it, paint) }
        paint.style = Paint.Style.FILL
        for (shape in value.shapes) {
            if (!RectF.intersects(shape.bounds, visible)) continue
            val visit = visits[shape.country.id]
            val visited = visit?.optInt("visited") == 1
            val photo = if (visited) coverPhotos[visit?.optString("coverId")] else null
            if (shape.country.id == "ATA") {
                paint.color = Color.rgb(245, 247, 246)
                canvas.drawPath(shape.path, paint)
            } else {
                paint.color = Color.WHITE
                paint.shader = value.terrainShader
                paint.colorFilter =
                    if (value.scope == "World" || value.shapes.size > 1) mutedTerrain else null
                canvas.drawPath(shape.path, paint)
                paint.shader = null
                paint.colorFilter = null
            }
            if (photo != null) {
                val pixels =
                    (max(shape.bounds.width(), shape.bounds.height()) * base * zoom)
                        .toInt()
                        .coerceAtMost(2048)
                photos
                    .get(photo.getString("id"), pixels) { postInvalidateOnAnimation() }
                    ?.let { bitmap ->
                        canvas.save()
                        canvas.clipPath(shape.path)
                        paint.color = Color.WHITE
                        canvas.drawBitmap(
                            bitmap,
                            null,
                            PhotoFraming.placement(shape.bounds, bitmap, photo),
                            paint,
                        )
                        canvas.restore()
                    }
            } else if (visited) {
                paint.color = Color.argb(87, 75, 142, 98)
                canvas.drawPath(shape.path, paint)
            }
            val dim = filter == "visited" && !visited || filter == "unvisited" && visited
            if (dim) {
                paint.color = Color.argb(214, 231, 239, 241)
                canvas.drawPath(shape.path, paint)
            }
            paint.style = Paint.Style.STROKE
            paint.strokeJoin = Paint.Join.ROUND
            paint.strokeCap = Paint.Cap.ROUND
            paint.strokeWidth = (if (visited) 1f else .6f) * density / (base * zoom)
            paint.color =
                if (shape.country.id == "ATA") Color.rgb(168, 181, 184)
                else if (visited) Color.rgb(63, 116, 91) else Color.rgb(137, 155, 144)
            if (dim) paint.alpha = 60
            canvas.drawPath(shape.outline, paint)
            paint.alpha = 255
            paint.style = Paint.Style.FILL
        }
        canvas.restore()
    }

    override fun onTouchEvent(event: MotionEvent): Boolean {
        scaleDetector.onTouchEvent(event)
        gestures.onTouchEvent(event)
        when (event.actionMasked) {
            MotionEvent.ACTION_DOWN -> {
                animation?.cancel()
                downX = event.x
                downY = event.y
                lastX = event.x
                lastY = event.y
                moved = false
                parent?.requestDisallowInterceptTouchEvent(true)
            }
            MotionEvent.ACTION_MOVE -> {
                if (!scaleDetector.isInProgress && event.pointerCount == 1) {
                    val dx = event.x - lastX
                    val dy = event.y - lastY
                    if (hypot(event.x - downX, event.y - downY) > 8 * density) moved = true
                    if (moved) {
                        offsetX += dx / base
                        offsetY += dy / base
                        clamp()
                        postInvalidateOnAnimation()
                    }
                }
                lastX = event.x
                lastY = event.y
            }
            MotionEvent.ACTION_POINTER_DOWN -> moved = true
            MotionEvent.ACTION_UP -> {
                parent?.requestDisallowInterceptTouchEvent(false)
            }
            MotionEvent.ACTION_CANCEL -> parent?.requestDisallowInterceptTouchEvent(false)
        }
        return true
    }

    override fun performClick(): Boolean {
        super.performClick()
        return true
    }

    private fun hit(x: Float, y: Float) {
        matrix()
        points[0] = x
        points[1] = y
        inverse.mapPoints(points)
        val px = points[0]
        val py = points[1]
        val touch = 10 * density / (base * zoom)
        val values = scene?.shapes ?: return
        // Exact path hit testing; tiny islands receive a small alternative target.
        var nearest: MapShape? = null
        var distance = Float.MAX_VALUE
        for (shape in values) {
            tempRect.set(shape.bounds)
            tempRect.inset(-touch, -touch)
            if (!tempRect.contains(px, py)) continue
            val clip =
                Region(
                    floor(shape.bounds.left).toInt() - 1,
                    floor(shape.bounds.top).toInt() - 1,
                    ceil(shape.bounds.right).toInt() + 1,
                    ceil(shape.bounds.bottom).toInt() + 1,
                )
            val region = Region()
            region.setPath(shape.path, clip)
            if (region.contains(px.toInt(), py.toInt())) {
                onCountry?.invoke(shape.country.id)
                return
            }
            val d = hypot(shape.bounds.centerX() - px, shape.bounds.centerY() - py)
            if (max(shape.bounds.width(), shape.bounds.height()) < touch * 2 && d < distance) {
                nearest = shape
                distance = d
            }
        }
        nearest?.let { onCountry?.invoke(it.country.id) }
    }

    fun export(scene: MapScene, album: JSONObject, repository: AlbumRepository): Bitmap {
        val output = Bitmap.createBitmap(4000, 2400, Bitmap.Config.ARGB_8888)
        val canvas = Canvas(output)
        canvas.drawColor(Color.rgb(231, 239, 241))
        val bounds = RectF(scene.shapes.first().bounds)
        scene.shapes.forEach { bounds.union(it.bounds) }
        val scale = min(3760f / bounds.width(), 2160f / bounds.height())
        canvas.translate(2000 - bounds.centerX() * scale, 1200 - bounds.centerY() * scale)
        canvas.scale(scale, scale)
        val p = Paint(Paint.ANTI_ALIAS_FLAG or Paint.FILTER_BITMAP_FLAG)
        canvas.save()
        canvas.clipPath(scene.land)
        canvas.drawBitmap(scene.terrain, null, RectF(0f, 0f, 1200f, 590f), p)
        canvas.restore()
        val visits =
            AlbumRepository.jsonObjects(album.getJSONArray("visits")).associateBy {
                it.getString("countryId")
            }
        val all =
            AlbumRepository.jsonObjects(album.getJSONArray("photos")).associateBy {
                it.getString("id")
            }
        for (shape in scene.shapes) {
            val visit = visits[shape.country.id]
            val photo = if (visit?.optInt("visited") == 1) all[visit.optString("coverId")] else null
            if (shape.country.id == "ATA") {
                p.color = Color.rgb(245, 247, 246)
                canvas.drawPath(shape.path, p)
            }
            if (photo != null) {
                val opts = BitmapFactory.Options().apply { inSampleSize = 2 }
                BitmapFactory.decodeFile(repository.photoFile(photo.getString("id")).path, opts)
                    ?.let {
                        canvas.save()
                        canvas.clipPath(shape.path)
                        p.color = Color.WHITE
                        canvas.drawBitmap(
                            it,
                            null,
                            PhotoFraming.placement(shape.bounds, it, photo),
                            p,
                        )
                        canvas.restore()
                        it.recycle()
                    }
            } else if (visit?.optInt("visited") == 1) {
                p.color = Color.argb(87, 75, 142, 98)
                canvas.drawPath(shape.path, p)
            }
            p.color = Color.rgb(135, 147, 138)
            p.style = Paint.Style.STROKE
            p.strokeWidth = .6f
            canvas.drawPath(shape.outline, p)
            p.style = Paint.Style.FILL
        }
        return output
    }
}
