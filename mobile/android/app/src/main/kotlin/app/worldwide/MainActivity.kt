package app.worldwide

import android.app.*
import android.content.*
import android.content.pm.ActivityInfo
import android.content.res.Configuration
import android.graphics.*
import android.net.Uri
import android.os.*
import android.view.*
import android.widget.*
import com.journeyapps.barcodescanner.ScanIntentResult
import com.journeyapps.barcodescanner.ScanOptions
import java.io.File
import java.util.concurrent.Executors
import kotlin.math.*
import org.json.JSONArray
import org.json.JSONObject

/** Native Kotlin activity. Map gestures and controls never cross a JavaScript bridge. */
class MainActivity : Activity() {
    lateinit var repository: AlbumRepository
        private set

    lateinit var mapView: NativeMapView
        private set

    private lateinit var assetsMap: MapAssets
    private lateinit var photos: PhotoCache
    private lateinit var root: FrameLayout
    private lateinit var header: LinearLayout
    private lateinit var actions: LinearLayout
    private lateinit var navigation: LinearLayout
    private lateinit var zoomControls: LinearLayout
    private lateinit var mapActions: LinearLayout
    private var panel: ScrollView? = null
    private var dropPermission: android.view.DragAndDropPermissions? = null
    private var accountDialog: AlertDialog? = null
    private var statusText: TextView? = null
    private var selected: String? = null
    private var continent = "World"
    private var style = "natural-earth"
    private var album = JSONObject().put("photos", JSONArray()).put("visits", JSONArray())
    private var snapshot = ""
    private var photoRevision = -1
    private val noteDrafts = mutableMapOf<String, String>()
    private var leftInset = 0
    private var rightInset = 0
    private var cutouts = emptyList<Rect>()
    private var topInset = 0
    private var bottomInset = 0
    private val io = Executors.newSingleThreadExecutor()
    private val geometry = Executors.newSingleThreadExecutor()
    private val connections = Executors.newSingleThreadExecutor()
    private val refreshHandler = Handler(Looper.getMainLooper())
    private var sceneRevision = 0
    private var alive = true
    private var saving = false
    private var pendingExport: ((Uri) -> Unit)? = null
    private var dragPhoto: String? = null
    private var updater: AndroidUpdater? = null
    private var updateInfo: JSONObject? = null
    private var updateFile: File? = null
    private var installWhenAllowed = false
    private val refreshTask =
        object : Runnable {
            override fun run() {
                refresh()
                refreshHandler.postDelayed(this, 5000)
            }
        }

    fun dp(value: Float) = NativeStyle.dp(this, value)

    private fun text(value: String, size: Float = 14f, bold: Boolean = false) =
        NativeStyle.text(this, value, size, bold)

    private fun button(
        label: String,
        icon: String? = null,
        primary: Boolean = false,
        action: () -> Unit,
    ) = NativeStyle.button(this, label, icon, primary, action)

    private fun icon(name: String, label: String, action: () -> Unit) =
        NativeStyle.icon(this, name, label, action)

    private fun column() = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }

    private fun row() =
        LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
        }

    private fun LinearLayout.add(view: View, w: Int = -1, h: Int = -2, weight: Float = 0f) {
        addView(view, LinearLayout.LayoutParams(w, h, weight))
    }

    private fun space(parent: LinearLayout, height: Float) {
        parent.add(Space(this), -1, dp(height))
    }

    private fun field(hint: String, value: String = "", multiline: Boolean = false) =
        EditText(this).apply {
            this.hint = hint
            setText(value)
            textSize = 16f
            setTextColor(NativeStyle.ink)
            setSingleLine(!multiline)
            setPadding(dp(12f), dp(12f), dp(12f), dp(12f))
            background = NativeStyle.surface(Color.rgb(251, 252, 251), dp(10f).toFloat(), true)
            if (multiline) minLines = 3
        }

    override fun onCreate(state: Bundle?) {
        super.onCreate(state)
        if (Build.VERSION.SDK_INT >= 33)
            onBackInvokedDispatcher.registerOnBackInvokedCallback(
                android.window.OnBackInvokedDispatcher.PRIORITY_DEFAULT
            ) {
                navigateBack()
            }
        requestedOrientation = ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE
        root = FrameLayout(this)
        root.setBackgroundColor(Color.rgb(231, 239, 241))
        setContentView(root)
        val loading = text("Opening your world…", 22f, true)
        root.addView(loading, FrameLayout.LayoutParams(-2, -2, Gravity.CENTER))
        root.setOnApplyWindowInsetsListener { _, insets ->
            if (Build.VERSION.SDK_INT >= 30) {
                val bars = insets.getInsets(WindowInsets.Type.systemBars())
                leftInset = bars.left
                rightInset = bars.right
                topInset = max(bars.top, insets.displayCutout?.safeInsetTop ?: 0)
                bottomInset = max(bars.bottom, insets.displayCutout?.safeInsetBottom ?: 0)
            } else {
                leftInset = insets.systemWindowInsetLeft
                rightInset = insets.systemWindowInsetRight
                topInset = insets.systemWindowInsetTop
                bottomInset = insets.systemWindowInsetBottom
            }
            cutouts =
                if (Build.VERSION.SDK_INT >= 28) insets.displayCutout?.boundingRects ?: emptyList()
                else emptyList()
            if (::mapView.isInitialized) layoutChrome()
            insets
        }
        root.requestApplyInsets()
        root.setOnDragListener { _, event ->
            when (event.action) {
                DragEvent.ACTION_DRAG_STARTED -> selected != null && event.localState == null
                DragEvent.ACTION_DROP -> {
                    dropPermission = requestDragAndDropPermissions(event)
                    importClip(event.clipData)
                    true
                }
                DragEvent.ACTION_DRAG_ENDED -> {
                    if (!saving) {
                        dropPermission?.release()
                        dropPermission = null
                    }
                    true
                }
                else -> true
            }
        }
        io.execute {
            try {
                val maps = MapAssets(this)
                val repo = AlbumRepository(applicationContext)
                runOnUiThread {
                    if (!alive) {
                        Thread({ repo.close() }, "album-close").start()
                        return@runOnUiThread
                    }
                    assetsMap = maps
                    repository = repo
                    photos = PhotoCache(repo)
                    mapView = NativeMapView(this, photos)
                    mapView.onCountry = { openCountry(it) }
                    root.removeAllViews()
                    root.addView(mapView, FrameLayout.LayoutParams(-1, -1))
                    buildChrome()
                    root.addOnLayoutChangeListener { _, l, t, r, b, ol, ot, orr, ob ->
                        if (r - l != orr - ol || b - t != ob - ot) layoutChrome()
                    }
                    repo.onChanged = { runOnUiThread { if (alive) refresh() } }
                    updater =
                        AndroidUpdater(this) { percent, message ->
                            runOnUiThread { statusText?.text = "$message $percent%" }
                        }
                    refresh()
                    refreshHandler.postDelayed(refreshTask, 5000)
                    intent?.dataString?.let { pair(it) }
                }
            } catch (e: Exception) {
                runOnUiThread {
                    loading.text =
                        "Your album could not be opened. No files were removed.\n${e.message}"
                }
            }
        }
    }

    private fun buildChrome() {
        header = row()
        val logo =
            ImageView(this).apply {
                setImageResource(R.drawable.worldwide_icon)
                contentDescription = "Worldwide"
            }
        header.add(logo, dp(28f), dp(28f))
        header.add(text("Worldwide", 20f, true), -2, dp(44f))
        header.setOnClickListener {
            selected = null
            continent = "World"
            loadScene()
        }
        root.addView(header)
        actions = row()
        actions.add(icon("photos", "Photo albums") { showAlbums() }, dp(44f), dp(44f))
        actions.add(Space(this), dp(8f), 1)
        actions.add(icon("user", "Your account") { showAccount() }, dp(44f), dp(44f))
        root.addView(actions)
        navigation =
            row().apply {
                setPadding(dp(5f), dp(5f), dp(5f), dp(5f))
                background = NativeStyle.surface(radius = dp(28f).toFloat())
                elevation = dp(3f).toFloat()
            }
        root.addView(navigation)
        zoomControls =
            column().apply {
                background = NativeStyle.surface(radius = dp(26f).toFloat())
                elevation = dp(3f).toFloat()
                setPadding(dp(4f), dp(4f), dp(4f), dp(4f))
            }
        zoomControls.add(icon("plus", "Zoom in") { mapView.zoomBy(1.5f) }, dp(44f), dp(44f))
        zoomControls.add(icon("minus", "Zoom out") { mapView.zoomBy(1 / 1.5f) }, dp(44f), dp(44f))
        zoomControls.add(icon("fit", "Fit map") { mapView.fit() }, dp(44f), dp(44f))
        root.addView(zoomControls)
        mapActions = column().apply { background = NativeStyle.surface(radius = dp(24f).toFloat()) }
        mapActions.add(icon("map", "Choose map style") { chooseStyle() }, dp(44f), dp(44f))
        mapActions.add(icon("download", "Save map") { exportMap() }, dp(44f), dp(44f))
        root.addView(mapActions)
        rebuildNavigation()
        root.post { layoutChrome() }
    }

    private fun rebuildNavigation() {
        if (!::navigation.isInitialized) return
        navigation.removeAllViews()
        if (selected != null)
            navigation.add(
                icon("back", "Back to $continent") {
                    selected = null
                    loadScene()
                },
                dp(36f),
                dp(44f),
            )
        navigation.add(button(continent, "down") { choosePlace() }, -2, dp(44f))
        if (selected == null) {
            for ((value, title) in
                listOf(
                    "all" to "All",
                    "visited" to "Visited",
                    "unvisited" to "Not visited",
                )) navigation.add(
                button(title, primary = mapView.filter == value) {
                    mapView.filter = value
                    rebuildNavigation()
                },
                -2,
                dp(44f),
            )
        }
    }

    private fun layoutChrome() {
        if (!::header.isInitialized || root.width == 0) return
        val landscape = root.width > root.height
        val margin = dp(if (landscape) 12f else 16f)
        val top = max(margin + dp(8f), topInset + dp(4f))
        val bottom = max(margin, bottomInset + dp(4f))
        val origin = IntArray(2)
        root.getLocationOnScreen(origin)
        val blocked = cutouts.map { Rect(it).apply { offset(-origin[0], -origin[1]) } }
        fun sideMargin(left: Boolean, y: Int, height: Int): Int {
            var inset = if (left) leftInset else rightInset
            for (rect in blocked) {
                if (rect.top >= y + height || rect.bottom <= y) continue
                if (left && rect.left <= leftInset) inset = max(inset, rect.right)
                if (!left && rect.right >= root.width - rightInset)
                    inset = max(inset, root.width - rect.left)
            }
            return margin + inset
        }
        val panelTop = if (landscape) top + dp(56f) else root.height * 48 / 100
        val panelHeight =
            if (landscape) root.height - top - dp(56f) - bottom else root.height * 52 / 100
        val panelRight = sideMargin(false, panelTop, panelHeight)
        val zoomBottom =
            if (selected != null && !landscape) root.height * 52 / 100 + dp(16f)
            else if (!landscape) bottom + dp(74f) else bottom
        val controlsBottom = if (!landscape) bottom + dp(74f) else bottom
        val zoomRight = sideMargin(false, root.height - zoomBottom - dp(140f), dp(140f))
        fun place(
            view: View,
            w: Int,
            h: Int,
            gravity: Int,
            left: Int = 0,
            topMargin: Int = 0,
            right: Int = 0,
            bottomMargin: Int = 0,
        ) {
            view.layoutParams =
                FrameLayout.LayoutParams(w, h, gravity).apply {
                    setMargins(left, topMargin, right, bottomMargin)
                }
        }
        place(header, -2, dp(44f), Gravity.TOP or Gravity.LEFT, sideMargin(true, top, dp(44f)), top)
        place(
            actions,
            -2,
            dp(44f),
            Gravity.TOP or Gravity.RIGHT,
            0,
            top,
            sideMargin(false, top, dp(44f)),
        )
        val panelWidth =
            if (landscape) dp(300f).coerceAtMost(root.width * 48 / 100)
            else root.width - leftInset - rightInset
        panel?.let {
            place(
                it,
                panelWidth,
                panelHeight,
                Gravity.RIGHT or if (landscape) Gravity.TOP else Gravity.BOTTOM,
                0,
                if (landscape) top + dp(56f) else 0,
                if (landscape) panelRight else rightInset,
                if (landscape) bottom else 0,
            )
        }
        val hasPanel = selected != null
        navigation.visibility = if (hasPanel && !landscape) View.GONE else View.VISIBLE
        mapActions.visibility = if (hasPanel) View.GONE else View.VISIBLE
        navigation.measure(
            View.MeasureSpec.makeMeasureSpec(0, View.MeasureSpec.UNSPECIFIED),
            View.MeasureSpec.makeMeasureSpec(dp(54f), View.MeasureSpec.EXACTLY),
        )
        val navigationSpace =
            root.width -
                leftInset -
                rightInset -
                (if (hasPanel && landscape) panelWidth + margin else 0)
        place(
            navigation,
            -2,
            dp(54f),
            Gravity.BOTTOM or Gravity.LEFT,
            leftInset + max(margin, (navigationSpace - navigation.measuredWidth) / 2),
            0,
            0,
            bottom,
        )
        place(
            zoomControls,
            dp(52f),
            dp(140f),
            Gravity.BOTTOM or Gravity.RIGHT,
            0,
            0,
            if (hasPanel && landscape) panelWidth + panelRight + dp(12f) else zoomRight,
            zoomBottom,
        )
        place(
            mapActions,
            dp(44f),
            dp(96f),
            Gravity.BOTTOM or Gravity.LEFT,
            sideMargin(true, root.height - controlsBottom - dp(96f), dp(96f)),
            0,
            0,
            controlsBottom,
        )
        mapView.inspectorWidth =
            if (hasPanel && landscape) (panelWidth + panelRight + dp(24f)).toFloat() else 0f
        mapView.topClearance = if (landscape) 76f else 144f
    }

    private fun refresh() {
        if (!::repository.isInitialized || !alive) return
        io.execute {
            try {
                val next = repository.atlas()
                val signature = next.toString()
                val status = repository.status()
                val receivedPhotos = repository.photoRevision
                runOnUiThread {
                    if (!alive) return@runOnUiThread
                    statusText?.text = syncDescription(status)
                    if (signature != snapshot || receivedPhotos != photoRevision) {
                        photoRevision = receivedPhotos
                        val previousStyle = style
                        snapshot = signature
                        photos.retryMissing()
                        album = next
                        style = album.optString("mapStyle", "natural-earth")
                        mapView.album(next)
                        if (mapView.scene == null || style != previousStyle) loadScene()
                        else if (selected != null) renderPanel()
                    }
                }
            } catch (e: Exception) {
                runOnUiThread { message(e.message ?: "Couldn't open the album") }
            }
        }
    }

    private fun loadScene() {
        val request = ++sceneRevision
        val scope = selected ?: continent
        val currentStyle = style
        rebuildNavigation()
        if (selected == null) {
            panel?.let { root.removeView(it) }
            panel = null
        }
        layoutChrome()
        geometry.execute {
            try {
                val scene = assetsMap.load(scope, currentStyle)
                runOnUiThread {
                    if (alive && request == sceneRevision) {
                        mapView.setScene(scene)
                        mapView.album(album)
                        if (selected != null) renderPanel()
                        layoutChrome()
                        mapView.fit(false)
                    }
                }
            } catch (e: Exception) {
                runOnUiThread { message(e.message ?: "Couldn't load this map") }
            }
        }
    }

    fun openCountry(id: String) {
        if (saving) return
        if (selected != id) {
            panel?.let { root.removeView(it) }
            panel = null
        }
        selected = id
        loadScene()
    }

    private fun visit(id: String) =
        AlbumRepository.jsonObjects(album.getJSONArray("visits")).find {
            it.optString("countryId") == id
        }

    private fun countryPhotos(id: String) =
        AlbumRepository.jsonObjects(album.getJSONArray("photos")).filter {
            it.optString("countryId") == id
        }

    private fun edit(path: String, body: JSONObject, done: (() -> Unit)? = null) {
        io.execute {
            try {
                repository.patch(path, body)
                runOnUiThread {
                    refresh()
                    done?.invoke()
                }
            } catch (e: Exception) {
                runOnUiThread {
                    message(e.message ?: "Couldn't save your change")
                }
            }
        }
    }

    private fun choosePlace() {
        getSystemService(android.view.inputmethod.InputMethodManager::class.java)
            .hideSoftInputFromWindow(root.windowToken, 0)
        currentFocus?.clearFocus()
        val items =
            listOf(
                "World",
                "Europe",
                "Asia",
                "Africa",
                "North America",
                "South America",
                "Oceania",
                "Antarctica",
            ) + assetsMap.countries.map { it.name }
        val dialog =
            AlertDialog.Builder(this)
                .setTitle("Choose a place")
                .setItems(items.toTypedArray()) { _, index ->
                    if (index < 8) {
                        selected = null
                        continent = items[index]
                        loadScene()
                    } else openCountry(assetsMap.countries[index - 8].id)
                }
                .setNegativeButton("Cancel", null)
                .create()
        dialog.window?.setSoftInputMode(WindowManager.LayoutParams.SOFT_INPUT_STATE_ALWAYS_HIDDEN)
        dialog.show()
    }

    private fun chooseStyle() {
        AlertDialog.Builder(this)
            .setTitle("Map styles")
            .setSingleChoiceItems(
                assetsMap.styles.map { it.second }.toTypedArray(),
                assetsMap.styles.indexOfFirst { it.first == style },
            ) { dialog, index ->
                val id = assetsMap.styles[index].first
                edit("/api/preferences", JSONObject().put("mapStyle", id)) {
                    selected = null
                    continent = "World"
                    style = id
                    loadScene()
                }
                dialog.dismiss()
            }
            .setNegativeButton("Cancel", null)
            .show()
    }

    private fun renderPanel() {
        val id = selected ?: return
        val country = assetsMap.countries.find { it.id == id } ?: return
        val saved = visit(id)
        val list = countryPhotos(id)
        val oldScroll = panel?.scrollY ?: 0
        val thumbnails = ArrayList<Pair<ImageView, String>>()
        panel?.let { root.removeView(it) }
        val content = column().apply { setPadding(dp(18f), dp(18f), dp(18f), dp(20f)) }
        val title = row()
        title.add(text(country.name, 25f, true), 0, -2, 1f)
        title.add(icon("download", "Save country map") { exportMap() }, dp(44f), dp(44f))
        title.add(
            icon("close", "Close country album") {
                selected = null
                loadScene()
            },
            dp(44f),
            dp(44f),
        )
        content.add(title)
        space(content, 12f)
        val visited =
            CheckBox(this).apply {
                text = "Visited"
                textSize = 14f
                isChecked = saved?.optInt("visited") == 1
                buttonTintList = android.content.res.ColorStateList.valueOf(NativeStyle.green)
                setPadding(dp(10f), 0, 0, 0)
                background = NativeStyle.surface(Color.rgb(234, 243, 238), dp(14f).toFloat(), true)
                setOnCheckedChangeListener { _, checked ->
                    edit("/api/countries/$id", JSONObject().put("visited", checked))
                }
            }
        content.add(visited, -1, dp(44f))
        space(content, 16f)
        val heading = row()
        heading.add(text("Photos  ${list.size}", 16f, true), 0, dp(44f), 1f)
        saved
            ?.optString("coverId")
            ?.takeUnless { it == "null" || it.isEmpty() }
            ?.let { cover ->
                list
                    .find { it.optString("id") == cover }
                    ?.let { photo ->
                        heading.add(
                            icon("adjust", "Adjust photo") { crop(photo) },
                            dp(44f),
                            dp(44f),
                        )
                    }
            }
        content.add(heading)
        space(content, 10f)
        if (list.isEmpty()) {
            val empty =
                column().apply {
                    gravity = Gravity.CENTER
                    setPadding(dp(10f), dp(16f), dp(10f), dp(16f))
                    background =
                        NativeStyle.surface(Color.rgb(246, 249, 247), dp(15f).toFloat(), true)
                    contentDescription = "Add your first memory"
                    isClickable = true
                    isFocusable = true
                    setOnClickListener { choosePhotos() }
                    setOnLongClickListener {
                        pastePhoto()
                        true
                    }
                }
            empty.add(
                ImageView(this).apply {
                    setImageDrawable(IconDrawable(this@MainActivity, "camera", NativeStyle.green))
                },
                dp(28f),
                dp(28f),
            )
            empty.add(
                text("Add your first memory", 14f, true).apply { gravity = Gravity.CENTER },
                -1,
                dp(36f),
            )
            empty.add(
                text("Choose photos from your device", 12f).apply { gravity = Gravity.CENTER }
            )
            content.add(empty, -1, dp(140f))
        } else {
            val grid = android.widget.GridLayout(this).apply { columnCount = 2 }
            for (photo in list) {
                val photoId = photo.getString("id")
                val cell = FrameLayout(this)
                val image =
                    ImageView(this).apply {
                        scaleType = ImageView.ScaleType.CENTER_CROP
                        contentDescription =
                            photo.optString("caption").ifEmpty { "Memory from ${country.name}" }
                        background =
                            NativeStyle.surface(Color.rgb(229, 235, 231), dp(10f).toFloat())
                        clipToOutline = true
                        setOnClickListener { showPhoto(photoId) }
                        setOnLongClickListener {
                            dragPhoto = photoId
                            startDragAndDrop(
                                ClipData.newPlainText("Worldwide photo", photoId),
                                View.DragShadowBuilder(this),
                                photoId,
                                0,
                            )
                            true
                        }
                    }
                thumbnails.add(image to photoId)
                cell.addView(image, FrameLayout.LayoutParams(-1, -1))
                val remove = icon("close", "Delete photo") { deletePhoto(photoId) }
                cell.addView(
                    remove,
                    FrameLayout.LayoutParams(dp(38f), dp(38f), Gravity.TOP or Gravity.RIGHT).apply {
                        setMargins(0, dp(4f), dp(4f), 0)
                    },
                )
                if (saved?.optString("coverId") == photoId)
                    cell.addView(
                        text("★ Cover", 11f, true).apply {
                            setPadding(dp(8f), 0, dp(8f), 0)
                            background = NativeStyle.surface(radius = dp(8f).toFloat())
                        },
                        FrameLayout.LayoutParams(-2, dp(28f), Gravity.BOTTOM or Gravity.LEFT)
                            .apply { setMargins(dp(6f), 0, 0, dp(6f)) },
                    )
                cell.setOnDragListener { _, event ->
                    when (event.action) {
                        DragEvent.ACTION_DRAG_STARTED -> event.localState is String
                        DragEvent.ACTION_DROP -> {
                            val from = event.localState as? String
                            val ids = list.map { it.getString("id") }.toMutableList()
                            if (from != null && from != photoId && ids.remove(from)) {
                                ids.add(ids.indexOf(photoId).coerceAtLeast(0), from)
                                edit(
                                    "/api/photos/order",
                                    JSONObject().put("countryId", id).put("ids", JSONArray(ids)),
                                )
                            }
                            true
                        }
                        else -> true
                    }
                }
                grid.addView(
                    cell,
                    android.widget.GridLayout.LayoutParams().apply {
                        width = 0
                        height = dp(128f)
                        columnSpec =
                            android.widget.GridLayout.spec(android.widget.GridLayout.UNDEFINED, 1f)
                        setMargins(dp(3f), dp(3f), dp(3f), dp(3f))
                    },
                )
            }
            content.add(grid)
            space(content, 12f)
            content.add(
                button("Add more photos", "plus") { choosePhotos() }
                    .apply {
                        setOnLongClickListener {
                            pastePhoto()
                            true
                        }
                    },
                -1,
                dp(44f),
            )
        }
        space(content, 16f)
        val details = column().apply { visibility = View.GONE }
        content.add(
            button("Details", "down") {
                details.visibility =
                    if (details.visibility == View.VISIBLE) View.GONE else View.VISIBLE
            }
        )
        details.add(
            button(
                saved?.optString("visitDate")?.takeUnless { it == "null" || it.isEmpty() }
                    ?: "Visit date"
            ) {
                val now = java.time.LocalDate.now()
                DatePickerDialog(
                        this,
                        { _, y, m, d ->
                            edit(
                                "/api/countries/$id",
                                JSONObject()
                                    .put(
                                        "visitDate",
                                        String.format(
                                            java.util.Locale.ROOT,
                                            "%04d-%02d-%02d",
                                            y,
                                            m + 1,
                                            d,
                                        ),
                                    ),
                            )
                        },
                        now.year,
                        now.monthValue - 1,
                        now.dayOfMonth,
                    )
                    .show()
            }
        )
        val note = field("Add a note…", noteDrafts[id] ?: saved?.optString("note") ?: "", true)
        note.addTextChangedListener(
            object : android.text.TextWatcher {
                override fun beforeTextChanged(
                    s: CharSequence?,
                    start: Int,
                    count: Int,
                    after: Int,
                ) {}

                override fun onTextChanged(s: CharSequence?, start: Int, before: Int, count: Int) {
                    noteDrafts[id] = s.toString()
                }

                override fun afterTextChanged(s: android.text.Editable?) {}
            }
        )
        details.add(note)
        space(details, 8f)
        details.add(
            button("Save note", "check") {
                val savedNote = note.text.toString()
                edit("/api/countries/$id", JSONObject().put("note", savedNote)) {
                    if (noteDrafts[id] == savedNote) noteDrafts.remove(id)
                    message("Note saved.")
                }
            }
        )
        content.add(details)
        panel =
            ScrollView(this).apply {
                isFillViewport = false
                background = NativeStyle.surface(Color.WHITE, dp(22f).toFloat(), true)
                elevation = dp(8f).toFloat()
                clipToOutline = true
                addView(content)
            }
        root.addView(panel)
        layoutChrome()
        val scroller = panel!!
        if (thumbnails.isNotEmpty()) {
            fun bindVisible(view: ImageView, photoId: String) {
                if (!alive || panel !== scroller || !view.isAttachedToWindow) return
                if (!view.getGlobalVisibleRect(Rect())) {
                    view.setImageDrawable(null)
                    return
                }
                photos
                    .get(photoId, 256) { bindVisible(view, photoId) }
                    ?.let { view.setImageBitmap(it) }
            }
            var queued = false
            fun schedule() {
                if (queued) return
                queued = true
                scroller.postOnAnimation {
                    queued = false
                    for ((view, photoId) in thumbnails) bindVisible(view, photoId)
                }
            }
            scroller.viewTreeObserver.addOnScrollChangedListener { schedule() }
            scroller.addOnLayoutChangeListener { _, _, _, _, _, _, _, _, _ -> schedule() }
            scroller.post { schedule() }
        }
        scroller.post { scroller.scrollTo(0, oldScroll) }
    }

    private fun bindImage(view: ImageView, id: String, size: Int) {
        if (!alive) return
        photos.get(id, size) { bindImage(view, id, size) }?.let { view.setImageBitmap(it) }
    }

    private fun choosePhotos() {
        if (saving) return
        startActivityForResult(
            Intent(Intent.ACTION_OPEN_DOCUMENT).apply {
                addCategory(Intent.CATEGORY_OPENABLE)
                type = "image/*"
                putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true)
                addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
            },
            10,
        )
    }

    private fun importPhotos(uris: List<Uri>) {
        val country = selected ?: return
        if (saving) return
        if (uris.size > 30) {
            message("Please add up to 30 photos at a time.")
            return
        }
        saving = true
        val permission = dropPermission
        dropPermission = null
        io.execute {
            var count = 0
            try {
                for (uri in uris) {
                    val source = File.createTempFile("memory-", ".image", cacheDir)
                    try {
                        contentResolver.openInputStream(uri)?.use { input ->
                            PhotoImporter.copy(input, source)
                        } ?: throw java.io.IOException("Couldn't read this photo.")
                        PhotoImporter.import(repository, country, source)
                        count++
                    } finally {
                        source.delete()
                    }
                }
                runOnUiThread {
                    saving = false
                    refresh()
                    message("$count ${if(count==1)"photo" else "photos"} added.")
                }
            } catch (error: Exception) {
                runOnUiThread {
                    saving = false
                    refresh()
                    message(error.message ?: "Couldn't add your photo")
                }
            } finally {
                permission?.release()
            }
        }
    }

    private fun pastePhoto() {
        val clipboard = getSystemService(ClipboardManager::class.java)
        val clip = clipboard.primaryClip
        if (clip == null || clip.itemCount == 0) {
            message("Copy a photo or public image address first.")
            return
        }
        importClip(clip)
    }

    private fun importClip(clip: ClipData?) {
        if (clip == null || selected == null) return
        val uris = mutableListOf<Uri>()
        var remote: String? = null
        for (index in 0 until min(clip.itemCount, 30)) {
            val item = clip.getItemAt(index)
            val uri = item.uri
            if (uri?.scheme == "content") uris.add(uri)
            else {
                val value = (uri?.toString() ?: item.text?.toString())?.trim()
                if (value?.startsWith("https://") == true || value?.startsWith("http://") == true)
                    remote = value
            }
        }
        if (uris.isNotEmpty()) {
            importPhotos(uris)
            return
        }
        val address = remote
        if (address == null) {
            message("Copy a photo or a direct public image address.")
            return
        }
        val country = selected ?: return
        if (saving) return
        saving = true
        io.execute {
            val source = File.createTempFile("public-memory-", ".image", cacheDir)
            try {
                PublicPhotoDownload.download(address, source)
                PhotoImporter.import(repository, country, source)
                runOnUiThread {
                    refresh()
                    message("Photo added.")
                }
            } catch (error: Exception) {
                runOnUiThread { message(error.message ?: "Couldn't import this image.") }
            } finally {
                source.delete()
                runOnUiThread { saving = false }
            }
        }
    }

    override fun dispatchKeyEvent(event: KeyEvent): Boolean {
        if (
            event.action == KeyEvent.ACTION_DOWN &&
                event.isCtrlPressed &&
                event.keyCode == KeyEvent.KEYCODE_V &&
                selected != null &&
                currentFocus !is EditText
        ) {
            pastePhoto()
            return true
        }
        return super.dispatchKeyEvent(event)
    }

    private fun showAlbums() {
        val places = assetsMap.countries.filter { countryPhotos(it.id).isNotEmpty() }
        if (places.isEmpty()) {
            message("No albums yet. Choose a country to add your first memory.")
            return
        }
        AlertDialog.Builder(this)
            .setTitle("Photo albums")
            .setItems(
                places.map { "${it.name} · ${countryPhotos(it.id).size} photos" }.toTypedArray()
            ) { _, index ->
                openCountry(places[index].id)
            }
            .setNegativeButton("Close", null)
            .show()
    }

    private fun showPhoto(id: String) {
        val photo =
            AlbumRepository.jsonObjects(album.getJSONArray("photos")).find {
                it.optString("id") == id
            } ?: return
        val country = photo.getString("countryId")
        val list = countryPhotos(country)
        val content = column().apply { setPadding(dp(16f), dp(12f), dp(16f), dp(12f)) }
        val image =
            ImageView(this).apply {
                scaleType = ImageView.ScaleType.FIT_CENTER
                contentDescription = photo.optString("caption", "Travel memory")
            }
        content.add(image, -1, dp(190f))
        bindImage(image, id, 2048)
        val caption = field("Caption", photo.optString("caption"))
        content.add(caption)
        space(content, 8f)
        val controls = row()
        val dialog =
            AlertDialog.Builder(this)
                .setTitle(assetsMap.countries.find { it.id == country }?.name)
                .setView(ScrollView(this).apply { addView(content) })
                .setNegativeButton("Close", null)
                .create()
        controls.add(
            icon("back", "Previous photo") {
                dialog.dismiss()
                showPhoto(list[(list.indexOf(photo) - 1 + list.size) % list.size].getString("id"))
            },
            dp(44f),
            dp(44f),
        )
        controls.add(
            button("Use on map", "star") {
                edit("/api/countries/$country", JSONObject().put("coverId", id)) {
                    dialog.dismiss()
                    message("Map photo updated.")
                }
            },
            0,
            dp(44f),
            1f,
        )
        controls.add(
            icon("next", "Next photo") {
                dialog.dismiss()
                showPhoto(list[(list.indexOf(photo) + 1) % list.size].getString("id"))
            },
            dp(44f),
            dp(44f),
        )
        content.add(controls)
        content.add(
            button("Save caption", "check") {
                edit("/api/photos/$id", JSONObject().put("caption", caption.text.toString())) {
                    dialog.dismiss()
                }
            }
        )
        content.add(
            button("Adjust map photo", "adjust") {
                dialog.dismiss()
                crop(photo)
            }
        )
        content.add(
            button("Save photo", "download") {
                saveFile(
                    "worldwide-$country.${PhotoImporter.extension(repository.originalFile(id))}",
                    PhotoImporter.mime(repository.originalFile(id)),
                ) { uri ->
                    contentResolver.openOutputStream(uri)!!.use { out ->
                        repository.originalFile(id).inputStream().use { it.copyTo(out) }
                    }
                }
            }
        )
        content.add(
            button("Delete photo", "trash") {
                dialog.dismiss()
                deletePhoto(id)
            }
        )
        dialog.show()
    }

    private fun deletePhoto(id: String) {
        AlertDialog.Builder(this)
            .setTitle("Delete photo?")
            .setMessage("Remove this memory from the album?")
            .setNegativeButton("Cancel", null)
            .setPositiveButton("Delete") { _, _ ->
                io.execute {
                    try {
                        repository.request("/api/photos/$id", "DELETE")
                        photos.clear(id)
                        runOnUiThread { refresh() }
                    } catch (e: Exception) {
                        runOnUiThread { message(e.message ?: "Couldn't delete photo") }
                    }
                }
            }
            .show()
    }

    private fun crop(photo: JSONObject) {
        val country = photo.getString("countryId")
        geometry.execute {
            try {
                val shape = assetsMap.load(country, style).shapes.first()
                runOnUiThread {
                    if (!alive || isFinishing || isDestroyed) return@runOnUiThread
                    val copy = JSONObject(photo.toString())
                    val content = column().apply { setPadding(dp(16f), 0, dp(16f), 0) }
                    val preview = CropPreview(this, shape, photos, copy)
                    content.add(preview, -1, dp(190f))
                    val zoom =
                        SeekBar(this).apply {
                            max = 400
                            progress = ((copy.optDouble("cropZoom", 1.0) - 1) * 100).toInt()
                            contentDescription = "Photo zoom"
                            setOnSeekBarChangeListener(
                                object : SeekBar.OnSeekBarChangeListener {
                                    override fun onProgressChanged(
                                        bar: SeekBar,
                                        value: Int,
                                        user: Boolean,
                                    ) {
                                        if (user) {
                                            copy.put("cropZoom", 1 + value / 100.0)
                                            preview.invalidate()
                                        }
                                    }

                                    override fun onStartTrackingTouch(bar: SeekBar) {}

                                    override fun onStopTrackingTouch(bar: SeekBar) {}
                                }
                            )
                        }
                    preview.changed = {
                        zoom.progress = ((copy.optDouble("cropZoom", 1.0) - 1) * 100).toInt()
                    }
                    content.add(zoom)
                    content.add(
                        button("Reset position") {
                            copy.put("cropX", 0).put("cropY", 0).put("cropZoom", 1)
                            zoom.progress = 0
                            preview.invalidate()
                        }
                    )
                    AlertDialog.Builder(this)
                        .setTitle("Adjust map photo")
                        .setView(ScrollView(this).apply { addView(content) })
                        .setNegativeButton("Cancel", null)
                        .setPositiveButton("Save position") { _, _ ->
                            edit(
                                "/api/photos/" + photo.getString("id"),
                                JSONObject()
                                    .put("cropX", copy.optDouble("cropX", 0.0))
                                    .put("cropY", copy.optDouble("cropY", 0.0))
                                    .put("cropZoom", copy.optDouble("cropZoom", 1.0)),
                            )
                        }
                        .show()
                }
            } catch (e: Exception) {
                runOnUiThread { message(e.message ?: "Couldn't open photo adjustment") }
            }
        }
    }

    private fun syncDescription(status: JSONObject): String =
        if (!status.optBoolean("paired"))
            "Your album is saved on this phone. No account or computer is needed."
        else if (status.optBoolean("connected"))
            if (status.optInt("pending") == 0) "Connected to your computer."
            else "${status.optInt("pending")} changes waiting to sync."
        else
            "Your computer is unavailable. Keep using your album; changes stay saved on this phone."

    private fun showAccount() {
        if (accountDialog?.isShowing == true) return
        requestedOrientation = ActivityInfo.SCREEN_ORIENTATION_PORTRAIT
        val content = column().apply { setPadding(dp(20f), dp(12f), dp(20f), dp(20f)) }
        content.add(text("On this phone", 25f, true))
        space(content, 8f)
        content.add(text(repository.account()?.optString("email") ?: "Your private travel album"))
        space(content, 20f)
        statusText = text(syncDescription(repository.status()))
        content.add(statusText!!)
        space(content, 16f)
        content.add(button("Connect computer", "qr", true) { scan() })
        content.add(button("Enter computer address") { manualConnection() })
        if (repository.account() != null) {
            content.add(
                button("Sync now", "sync") {
                    repository.requestSync()
                    message("Sync started. You can keep using your album.")
                }
            )
            content.add(
                button("Change username") {
                    val input = field("Username", repository.account()?.optString("username") ?: "")
                    AlertDialog.Builder(this)
                        .setTitle("Computer username")
                        .setView(input)
                        .setNegativeButton("Cancel", null)
                        .setPositiveButton("Save") { _, _ ->
                            background {
                                repository.changeUsername(input.text.toString())
                                refresh()
                            }
                        }
                        .show()
                }
            )
            content.add(
                button("Disconnect") {
                    repository.disconnect()
                    accountDialog?.dismiss()
                    showAccount()
                }
            )
        }
        space(content, 20f)
        content.add(text("Saved on this phone", 16f, true))
        content.add(
            text("Photos, visits, notes, and photo positions stay available without a computer.")
        )
        space(content, 20f)
        content.add(text("App updates", 16f, true))
        content.add(text("Installed version ${BuildConfig.VERSION_NAME}"))
        val updateButton =
            button("Check for updates", "sync") {
                background {
                    val result = updater!!.check()
                    updateInfo = result
                    runOnUiThread {
                        if (!alive || isFinishing || isDestroyed) return@runOnUiThread
                        if (result.optBoolean("available")) {
                            AlertDialog.Builder(this)
                                .setTitle("Worldwide ${result.getString("version")}")
                                .setMessage(
                                    "Install this update over your existing app. Your photos stay saved."
                                )
                                .setNegativeButton("Later", null)
                                .setPositiveButton("Install update") { _, _ ->
                                    background {
                                        val file = updater!!.prepare()
                                        updateFile = file
                                        runOnUiThread {
                                            if (!alive || isFinishing || isDestroyed)
                                                return@runOnUiThread
                                            val status = AndroidUpdater.install(this, file)
                                            if (status == "permission-required") {
                                                installWhenAllowed = true
                                                message(
                                                    "Allow updates from Worldwide, then return to finish installing."
                                                )
                                            }
                                        }
                                    }
                                }
                                .show()
                        } else message("You have the latest version.")
                    }
                }
            }
        content.add(updateButton)
        updateFile?.let { file ->
            content.add(button("Install update", "download") { AndroidUpdater.install(this, file) })
        }
        val scroll = ScrollView(this).apply { addView(content) }
        accountDialog =
            AlertDialog.Builder(this)
                .setView(scroll)
                .setNegativeButton("Close", null)
                .create()
                .apply {
                    setOnDismissListener {
                        statusText = null
                        accountDialog = null
                        requestedOrientation = ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE
                    }
                    show()
                }
    }

    private fun scan() {
        val options =
            ScanOptions()
                .setDesiredBarcodeFormats(ScanOptions.QR_CODE)
                .setPrompt("Scan the QR code in Worldwide on your computer")
                .setBeepEnabled(false)
                .setBarcodeImageEnabled(false)
                .setOrientationLocked(false)
        startActivityForResult(options.createScanIntent(this), 12)
    }

    private fun manualConnection() {
        val content = column().apply { setPadding(dp(20f), 0, dp(20f), 0) }
        val address =
            field("http://192.168.1.20:3000", repository.prefs.getString("server", "") ?: "")
        address.inputType =
            android.text.InputType.TYPE_CLASS_TEXT or android.text.InputType.TYPE_TEXT_VARIATION_URI
        val user = field("Computer email or username")
        val password = field("Computer password")
        password.inputType =
            android.text.InputType.TYPE_CLASS_TEXT or
                android.text.InputType.TYPE_TEXT_VARIATION_PASSWORD
        content.add(address)
        space(content, 8f)
        content.add(user)
        space(content, 8f)
        content.add(password)
        AlertDialog.Builder(this)
            .setTitle("Optional computer sync")
            .setView(content)
            .setNegativeButton("Keep using this phone", null)
            .setPositiveButton("Connect") { _, _ ->
                background {
                    repository.login(
                        address.text.toString(),
                        user.text.toString().trim(),
                        password.text.toString(),
                    )
                    runOnUiThread {
                        password.text.clear()
                        accountDialog?.dismiss()
                        refresh()
                        message("Computer connected.")
                    }
                }
            }
            .show()
    }

    private fun pair(value: String) {
        if (!::repository.isInitialized) return
        background {
            repository.pair(value)
            runOnUiThread {
                accountDialog?.dismiss()
                refresh()
                message("Computer connected. Sync is optional; your album stays on this phone.")
            }
        }
    }

    private fun exportMap() {
        val scene = mapView.scene ?: return
        val snapshot = JSONObject(album.toString())
        saveFile("worldwide-${scene.scope.lowercase().replace(' ','-')}.png", "image/png") { uri ->
            val bitmap = mapView.export(scene, snapshot, repository)
            try {
                contentResolver.openOutputStream(uri)!!.use {
                    bitmap.compress(Bitmap.CompressFormat.PNG, 100, it)
                }
            } finally {
                bitmap.recycle()
            }
        }
    }

    private fun saveFile(name: String, mime: String, write: (Uri) -> Unit) {
        pendingExport = write
        startActivityForResult(
            Intent(Intent.ACTION_CREATE_DOCUMENT).apply {
                addCategory(Intent.CATEGORY_OPENABLE)
                type = mime
                putExtra(Intent.EXTRA_TITLE, name)
            },
            11,
        )
    }

    private fun background(action: () -> Unit) {
        connections.execute {
            try {
                action()
            } catch (e: Exception) {
                runOnUiThread { if (alive) message(e.message ?: "Please try again.") }
            }
        }
    }

    private fun message(value: String) {
        if (alive) Toast.makeText(this, value, Toast.LENGTH_LONG).show()
    }

    @Deprecated("Deprecated in Java")
    override fun onActivityResult(request: Int, result: Int, data: Intent?) {
        super.onActivityResult(request, result, data)
        if (result != RESULT_OK) return
        when (request) {
            10 -> {
                val uris = mutableListOf<Uri>()
                data?.clipData?.let {
                    for (i in 0 until it.itemCount) uris.add(it.getItemAt(i).uri)
                } ?: data?.data?.let { uris.add(it) }
                importPhotos(uris)
            }
            11 -> {
                val writer = pendingExport
                pendingExport = null
                data?.data?.let { uri ->
                    if (writer != null)
                        background {
                            writer(uri)
                            runOnUiThread { message("Saved.") }
                        }
                }
            }
            12 -> {
                val value = ScanIntentResult.parseActivityResult(result, data)?.contents
                if (!value.isNullOrEmpty()) pair(value)
            }
        }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        intent.dataString?.let { pair(it) }
    }

    override fun onConfigurationChanged(config: Configuration) {
        super.onConfigurationChanged(config)
        root.post { layoutChrome() }
    }

    override fun onResume() {
        super.onResume()
        if (installWhenAllowed && packageManager.canRequestPackageInstalls()) {
            installWhenAllowed = false
            updateFile?.let { AndroidUpdater.install(this, it) }
        }
    }

    private fun navigateBack() {
        if (selected != null) {
            selected = null
            loadScene()
        } else finish()
    }

    @Deprecated("Deprecated in Java")
    override fun onBackPressed() {
        navigateBack()
    }

    override fun onDestroy() {
        dropPermission?.release()
        dropPermission = null
        alive = false
        sceneRevision++
        refreshHandler.removeCallbacksAndMessages(null)
        accountDialog?.dismiss()
        if (::photos.isInitialized) photos.close()
        if (::repository.isInitialized) io.execute { repository.close() }
        io.shutdown()
        geometry.shutdownNow()
        connections.shutdownNow()
        super.onDestroy()
    }
}
