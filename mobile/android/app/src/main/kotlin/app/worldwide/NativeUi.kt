package app.worldwide

import android.content.Context
import android.graphics.*
import android.graphics.drawable.Drawable
import android.graphics.drawable.GradientDrawable
import android.view.*
import android.widget.*
import androidx.core.graphics.PathParser
import kotlin.math.*
import org.json.JSONObject

object NativeStyle {
    val ink = Color.rgb(32, 51, 45)
    val green = Color.rgb(40, 99, 77)
    val muted = Color.rgb(102, 119, 111)

    fun dp(context: Context, value: Float) =
        (value * context.resources.displayMetrics.density).roundToInt()

    fun surface(
        color: Int = Color.argb(244, 255, 255, 255),
        radius: Float = 24f,
        stroke: Boolean = false,
    ) =
        GradientDrawable().apply {
            setColor(color)
            cornerRadius = radius
            if (stroke) setStroke(1, Color.rgb(215, 225, 219))
        }

    fun text(context: Context, value: String, size: Float = 14f, bold: Boolean = false) =
        TextView(context).apply {
            text = value
            textSize = size
            setTextColor(ink)
            if (bold) typeface = Typeface.create("sans-serif-medium", Typeface.NORMAL)
            gravity = Gravity.CENTER_VERTICAL
        }

    fun button(
        context: Context,
        label: String,
        icon: String? = null,
        primary: Boolean = false,
        action: () -> Unit,
    ) =
        Button(context).apply {
            text = label
            isAllCaps = false
            textSize = 13f
            typeface = Typeface.create("sans-serif-medium", Typeface.NORMAL)
            setTextColor(if (primary) Color.WHITE else green)
            minHeight = dp(context, 44f)
            minimumHeight = minHeight
            minWidth = dp(context, 44f)
            minimumWidth = minWidth
            setPadding(dp(context, 14f), 0, dp(context, 14f), 0)
            background =
                surface(
                    if (primary) green else Color.argb(242, 255, 255, 255),
                    dp(context, 24f).toFloat(),
                    !primary,
                )
            stateListAnimator = null
            if (icon != null) {
                val d = IconDrawable(context, icon, if (primary) Color.WHITE else green)
                setCompoundDrawablesRelativeWithIntrinsicBounds(d, null, null, null)
                compoundDrawablePadding = dp(context, 8f)
            }
            setOnClickListener { action() }
        }

    fun icon(context: Context, name: String, label: String, action: () -> Unit) =
        ImageButton(context).apply {
            contentDescription = label
            setImageDrawable(
                if (name == "globe") context.getDrawable(R.drawable.worldwide_icon)
                else IconDrawable(context, name, green)
            )
            scaleType = ImageView.ScaleType.CENTER_INSIDE
            setPadding(dp(context, 12f), dp(context, 12f), dp(context, 12f), dp(context, 12f))
            background = surface(radius = dp(context, 24f).toFloat())
            elevation = dp(context, 3f).toFloat()
            setOnClickListener { action() }
        }
}

class IconDrawable(private val context: Context, name: String, private val color: Int) :
    Drawable() {
    private val paint =
        Paint(Paint.ANTI_ALIAS_FLAG).apply {
            style = Paint.Style.STROKE
            strokeWidth = 1.8f
            strokeCap = Paint.Cap.ROUND
            strokeJoin = Paint.Join.ROUND
        }
    private val path =
        PathParser.createPathFromPathData(
            when (name) {
                "plus" -> "M12 5v14M5 12h14"
                "minus" -> "M5 12h14"
                "close" -> "M6 6l12 12M18 6 6 18"
                "back" -> "M15 5l-7 7 7 7"
                "next" -> "M9 5l7 7-7 7"
                "down" -> "M6 9l6 6 6-6"
                "fit" -> "M8 3H3v5M16 3h5v5M3 16v5h5M16 21h5v-5"
                "search" -> "M21 21l-4.3-4.3M19 11a8 8 0 1 1-16 0 8 8 0 0 1 16 0"
                "user" -> "M20 21v-2a7 7 0 0 0-14 0v2M16 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0"
                "photos" -> "M6 3h15v15H6zM3 6v15h15M6 14l4-4 4 4 3-2 4 4M17 7h.01"
                "camera" -> "M14.5 4h-5L7 7H3v14h18V7h-4zM16 13a4 4 0 1 1-8 0 4 4 0 0 1 8 0"
                "download" -> "M12 3v12M7 10l5 5 5-5M4 17v4h16v-4"
                "check" -> "M5 12l4 4L19 6"
                "star" -> "M12 3l3 6 7 1-5 5 1 7-6-3-6 3 1-7-5-5 7-1z"
                "trash" -> "M3 6h18M8 6V3h8v3M5 6l1 15h12l1-15M10 10v7M14 10v7"
                "adjust" -> "M4 6h6M14 6h6M10 3v6M4 12h10M18 12h2M14 9v6M4 18h2M10 18h10M6 15v6"
                "map" -> "M3 6l6-3 6 3 6-3v15l-6 3-6-3-6 3zM9 3v15M15 6v15"
                "qr" -> "M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h3v3h4v4h-7z"
                "sync" -> "M3 10a9 9 0 0 1 15-6l3 3M21 2v5h-5M21 14a9 9 0 0 1-15 6l-3-3M3 22v-5h5"
                else -> "M12 3v18M3 12h18"
            }
        )!!

    override fun draw(canvas: Canvas) {
        canvas.save()
        canvas.translate(bounds.left.toFloat(), bounds.top.toFloat())
        canvas.scale(bounds.width() / 24f, bounds.height() / 24f)
        paint.color = color
        canvas.drawPath(path, paint)
        canvas.restore()
    }

    override fun getIntrinsicWidth() = NativeStyle.dp(context, 20f)

    override fun getIntrinsicHeight() = NativeStyle.dp(context, 20f)

    override fun setAlpha(alpha: Int) {
        paint.alpha = alpha
    }

    override fun setColorFilter(filter: ColorFilter?) {
        paint.colorFilter = filter
    }

    @Deprecated("Deprecated in Java") override fun getOpacity() = PixelFormat.TRANSLUCENT
}

class CropPreview(
    context: Context,
    private val shape: MapShape,
    private val cache: PhotoCache,
    val photo: JSONObject,
) : View(context) {
    var changed: (() -> Unit)? = null
    private val paint = Paint(Paint.ANTI_ALIAS_FLAG or Paint.FILTER_BITMAP_FLAG)
    private val matrix = Matrix()
    private var factor = 1f
    private var lastX = 0f
    private var lastY = 0f
    private val detector =
        ScaleGestureDetector(
            context,
            object : ScaleGestureDetector.SimpleOnScaleGestureListener() {
                override fun onScale(d: ScaleGestureDetector): Boolean {
                    photo.put(
                        "cropZoom",
                        (photo.optDouble("cropZoom", 1.0) * d.scaleFactor).coerceIn(1.0, 5.0),
                    )
                    invalidate()
                    changed?.invoke()
                    return true
                }
            },
        )

    init {
        contentDescription = "Drag the map photo to adjust its crop. Pinch to zoom."
        isClickable = true
        setBackgroundColor(Color.rgb(231, 239, 241))
    }

    override fun onDraw(canvas: Canvas) {
        super.onDraw(canvas)
        val b = shape.focus
        factor = min(width * .88f / b.width(), height * .88f / b.height())
        matrix.setValues(
            floatArrayOf(
                factor,
                0f,
                width / 2f - b.centerX() * factor,
                0f,
                factor,
                height / 2f - b.centerY() * factor,
                0f,
                0f,
                1f,
            )
        )
        canvas.save()
        canvas.concat(matrix)
        paint.style = Paint.Style.FILL
        paint.color = Color.rgb(183, 207, 164)
        canvas.drawPath(shape.path, paint)
        cache
            .get(photo.getString("id"), 1024) { invalidate() }
            ?.let {
                canvas.save()
                canvas.clipPath(shape.path)
                paint.color = Color.WHITE
                canvas.drawBitmap(it, null, PhotoFraming.placement(shape.bounds, it, photo), paint)
                canvas.restore()
            }
        paint.style = Paint.Style.STROKE
        paint.strokeWidth = 1f / factor
        paint.color = NativeStyle.green
        canvas.drawPath(shape.outline, paint)
        canvas.restore()
    }

    override fun onTouchEvent(event: MotionEvent): Boolean {
        detector.onTouchEvent(event)
        when (event.actionMasked) {
            MotionEvent.ACTION_DOWN -> {
                lastX = event.x
                lastY = event.y
                parent.requestDisallowInterceptTouchEvent(true)
            }
            MotionEvent.ACTION_MOVE -> {
                if (!detector.isInProgress) {
                    cache
                        .get(photo.getString("id"), 1024) { invalidate() }
                        ?.let {
                            val frame = PhotoFraming.placement(shape.bounds, it, photo)
                            val ox = (frame.width() - shape.bounds.width()) / 2 * factor
                            val oy = (frame.height() - shape.bounds.height()) / 2 * factor
                            if (ox > .1)
                                photo.put(
                                    "cropX",
                                    (photo.optDouble("cropX", 0.0) + (event.x - lastX) / ox)
                                        .coerceIn(-1.0, 1.0),
                                )
                            if (oy > .1)
                                photo.put(
                                    "cropY",
                                    (photo.optDouble("cropY", 0.0) + (event.y - lastY) / oy)
                                        .coerceIn(-1.0, 1.0),
                                )
                            invalidate()
                            changed?.invoke()
                        }
                }
                lastX = event.x
                lastY = event.y
            }
            MotionEvent.ACTION_UP -> {
                performClick()
                parent.requestDisallowInterceptTouchEvent(false)
            }
        }
        return true
    }

    override fun performClick(): Boolean {
        super.performClick()
        return true
    }
}
